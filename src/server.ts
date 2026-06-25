import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { initializeDatabase } from "./db/index.js";
import { closeDatabase } from "./db/sequelize.js";
import { safeLogError } from "./utils/logger.js";

const app = await buildApp();

try {
  const database = await initializeDatabase();
  if (database.connected) {
    app.log.info({ synced: database.synced }, "Database connection initialized");
  }
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error({ error: safeLogError(error) }, "Backend startup failed");
  process.exit(1);
}

const shutdown = async () => {
  await app.close();
  await closeDatabase();
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
