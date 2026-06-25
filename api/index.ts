import "mysql2";
import type { IncomingMessage, ServerResponse } from "node:http";
import { buildApp } from "../src/http-app.js";
import { initializeDatabase } from "../src/db/index.js";

let appPromise: Promise<Awaited<ReturnType<typeof buildApp>>> | undefined;

async function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      const app = await buildApp();
      const database = await initializeDatabase();
      if (database.connected) {
        app.log.info({ synced: database.synced }, "Database connection initialized");
      }
      await app.ready();
      return app;
    })();
  }
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  app.server.emit("request", req, res);
}
