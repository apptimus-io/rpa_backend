import { env } from "../config/env.js";

export function shouldUseDatabase() {
  return env.DB_CONNECT_ON_START;
}

export function canFallbackFromDatabaseError() {
  return !env.DB_CONNECT_ON_START || (env.NODE_ENV !== "production" && env.DB_ALLOW_DEMO_FALLBACK);
}
