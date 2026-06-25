import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { getRegisteredModelNames } from "../db/index.js";
import { requirePermission } from "../middleware/auth.js";
import { permissions } from "../permissions/permissions.js";

export async function configRoutes(app: FastifyInstance) {
  app.get(
    "/config/runtime",
    { preHandler: [requirePermission(permissions.settingsManage)] },
    async () => ({
      data: {
        environment: env.NODE_ENV,
        apiPublicUrl: env.API_PUBLIC_URL,
        frontendOrigin: env.FRONTEND_ORIGIN,
        features: {
          redisConfigured: Boolean(env.REDIS_URL),
          databaseConfigured: Boolean(env.DATABASE_URL || (process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER)),
          cloudinaryConfigured: Boolean((env.CLOUDINARY_URL || env.CLOUDINARY_CLOUD_NAME) && env.CLOUDINARY_API_KEY),
          geminiConfigured: Boolean(env.GEMINI_API_KEY),
          smtpConfigured: Boolean((env.SMTP_HOST || env.MAIL_HOST) && (env.NOTIFICATION_FROM_EMAIL || env.MAIL_FROM_ADDRESS))
        },
        database: {
          connectOnStart: env.DB_CONNECT_ON_START,
          syncOnStart: env.DB_SYNC_ON_START,
          allowDemoFallback: env.DB_ALLOW_DEMO_FALLBACK,
          dataSource: env.DB_CONNECT_ON_START ? "database" : "demo",
          models: getRegisteredModelNames()
        }
      }
    })
  );
}
