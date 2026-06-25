import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sequelize } from "./sequelize.js";

const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), "migrations");

async function ensureMigrationTable() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

async function executedMigrations() {
  const [rows] = await sequelize.query("SELECT name FROM schema_migrations ORDER BY name ASC;");
  return new Set((rows as Array<{ name: string }>).map((row) => row.name));
}

async function run() {
  await ensureMigrationTable();
  const executed = await executedMigrations();
  const files = (await readdir(migrationDirectory)).filter((file) => file.endsWith(".sql")).sort();

  for (const file of files) {
    if (executed.has(file)) {
      continue;
    }

    const sql = await readFile(join(migrationDirectory, file), "utf8");
    await sequelize.transaction(async (transaction) => {
      for (const statement of sql.split(/^-- statement-break$/m).map((part) => part.trim()).filter(Boolean)) {
        try {
          await sequelize.query(statement, { transaction });
        } catch (error) {
          if (!isDuplicateSchemaError(error)) {
            throw error;
          }
          console.log(`Skipped already-applied schema statement in ${file}`);
        }
      }
      await sequelize.query("INSERT INTO schema_migrations (name) VALUES (?);", {
        replacements: [file],
        transaction
      });
    });
    console.log(`Applied ${file}`);
  }
}

function isDuplicateSchemaError(error: unknown) {
  const code = (error as { parent?: { errno?: number; code?: string }; original?: { errno?: number; code?: string } }).parent?.errno
    ?? (error as { original?: { errno?: number } }).original?.errno;
  const namedCode = (error as { parent?: { code?: string }; original?: { code?: string } }).parent?.code
    ?? (error as { original?: { code?: string } }).original?.code;

  return code === 1050
    || code === 1060
    || code === 1061
    || namedCode === "ER_TABLE_EXISTS_ERROR"
    || namedCode === "ER_DUP_FIELDNAME"
    || namedCode === "ER_DUP_KEYNAME";
}

try {
  await run();
  await sequelize.close();
} catch (error) {
  console.error(error);
  await sequelize.close();
  process.exit(1);
}
