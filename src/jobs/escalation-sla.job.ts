import { initializeDatabase } from "../db/index.js";
import { sequelize } from "../db/sequelize.js";
import { notifyEscalationSlaBreaches } from "../services/escalation-sla.service.js";

const minutesArg = process.argv.find((arg) => arg.startsWith("--minutes="))?.slice("--minutes=".length);
const slaMinutes = minutesArg ? Number(minutesArg) : 30;

try {
  await initializeDatabase();
  const result = await notifyEscalationSlaBreaches(Number.isFinite(slaMinutes) ? slaMinutes : 30);
  console.log(JSON.stringify({ ok: true, data: result }));
  await sequelize.close();
} catch (error) {
  console.error(error);
  await sequelize.close();
  process.exit(1);
}
