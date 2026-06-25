import { initializeDatabase } from "../db/index.js";
import { sequelize } from "../db/sequelize.js";
import { runNightlyDashboardAggregation, upsertDailyStats } from "../services/dashboard-aggregation.service.js";

const statDateArg = process.argv.find((arg) => arg.startsWith("--date="))?.slice("--date=".length);

try {
  await initializeDatabase();
  const result = statDateArg ? await upsertDailyStats(statDateArg) : await runNightlyDashboardAggregation();
  console.log(JSON.stringify({ ok: true, data: result }));
  await sequelize.close();
} catch (error) {
  console.error(error);
  await sequelize.close();
  process.exit(1);
}
