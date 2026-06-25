import { Sequelize } from "sequelize";
import mysql2 from "mysql2";
import { env } from "../config/env.js";

function databaseUrl() {
  if (env.DATABASE_URL) {
    return env.DATABASE_URL;
  }

  const user = encodeURIComponent(env.DB_USER);
  const password = encodeURIComponent(env.DB_PASSWORD);
  const credentials = password ? `${user}:${password}` : user;
  return `mysql://${credentials}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`;
}

export const sequelize = new Sequelize(databaseUrl(), {
    dialect: "mysql",
    dialectModule: mysql2,
    logging: env.NODE_ENV === "development" ? false : false,
    dialectOptions: {
      connectTimeout: env.DB_CONNECT_TIMEOUT_MS
    },
    pool: {
      max: 10,
      min: 0,
      acquire: env.DB_CONNECT_TIMEOUT_MS,
      idle: 10_000
    }
  });

export async function closeDatabase() {
  await sequelize.close();
}
