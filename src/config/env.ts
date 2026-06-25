import { z } from "zod";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), "../../.env") });

const envBoolean = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }
  if (["true", "1", "yes", "on"].includes(value.toLowerCase())) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(value.toLowerCase())) {
    return false;
  }
  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:3000"),
  API_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  AUTH_RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  UPLOAD_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  UPLOAD_RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  DOCUMENT_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  DATABASE_URL: z.string().optional(),
  DB_HOST: z.string().default("localhost"),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().default("rpa_db"),
  DB_USER: z.string().default("root"),
  DB_PASSWORD: z.string().default(""),
  DB_CONNECT_ON_START: envBoolean.default(false),
  DB_SYNC_ON_START: envBoolean.default(false),
  DB_ALLOW_DEMO_FALLBACK: envBoolean.default(false),
  DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  REDIS_URL: z.string().optional(),
  ACCESS_TOKEN_SECRET: z.string().optional(),
  ACCESS_TOKEN_TTL: z.string().default("8h"),
  REFRESH_TOKEN_SECRET: z.string().optional(),
  PASSWORD_RESET_TOKEN_SECRET: z.string().optional(),
  CREDENTIAL_ENCRYPTION_KEY: z.string().optional(),
  INTERNAL_AGENT_TOKEN: z.string().optional(),
  AGENT_AUTO_RUN: envBoolean.default(false),
  AGENT_WORKDIR: z.string().optional(),
  AGENT_PYTHON_PATH: z.string().optional(),
  METRICS_TOKEN: z.string().optional(),
  CLOUDINARY_URL: z.string().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_UPLOAD_PRESET: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3-flash-preview"),
  GEMINI_VISION_MODEL: z.string().optional(),
  GEMINI_VLM_ENABLED: envBoolean.default(true),
  MAIL_MAILER: z.string().default("smtp"),
  MAIL_HOST: z.string().optional(),
  MAIL_PORT: z.coerce.number().int().positive().optional(),
  MAIL_USERNAME: z.string().optional(),
  MAIL_PASSWORD: z.string().optional(),
  MAIL_ENCRYPTION: z.string().optional(),
  MAIL_FROM_ADDRESS: z.string().email().optional(),
  MAIL_FROM_NAME: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  NOTIFICATION_FROM_EMAIL: z.string().email().optional(),
  SEED_ADMIN_EMAIL: z.string().email().default("admin@example.test"),
  SEED_ADMIN_PASSWORD: z.string().min(8).optional()
}).superRefine((value, context) => {
  if (value.NODE_ENV !== "production") {
    return;
  }

  const requiredInProduction: Array<keyof typeof value> = [
    "DATABASE_URL",
    "REDIS_URL",
    "ACCESS_TOKEN_SECRET",
    "REFRESH_TOKEN_SECRET",
    "PASSWORD_RESET_TOKEN_SECRET",
    "CREDENTIAL_ENCRYPTION_KEY",
    "INTERNAL_AGENT_TOKEN",
    "METRICS_TOKEN"
  ];

  for (const key of requiredInProduction) {
    if (!value[key]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is required in production`
      });
    }
  }
});

export const env = envSchema.parse(process.env);
