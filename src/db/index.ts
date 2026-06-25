import "./models.js";
import { env } from "../config/env.js";
import { sequelize } from "./sequelize.js";

export async function initializeDatabase() {
  if (!env.DB_CONNECT_ON_START) {
    return { connected: false, synced: false, reason: "DB_CONNECT_ON_START is false" };
  }

  await sequelize.authenticate();

  if (env.DB_SYNC_ON_START) {
    await sequelize.sync({ alter: env.NODE_ENV === "development" });
    return { connected: true, synced: true };
  }

  return { connected: true, synced: false };
}

export function getRegisteredModelNames() {
  return Object.keys(sequelize.models).sort();
}
