import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { env } from "./config/env.js";
import { attachUser } from "./middleware/auth.js";
import { registerErrorHandler } from "./middleware/error-handler.js";
import { backendLogLevel, logRedactionPaths } from "./utils/logger.js";
import { authRoutes } from "./routes/auth.routes.js";
import { dashboardRoutes } from "./routes/dashboard.routes.js";
import { submissionsRoutes } from "./routes/submissions.routes.js";
import { portalsRoutes } from "./routes/portals.routes.js";
import { portalTemplatesRoutes } from "./routes/portal-templates.routes.js";
import { escalationsRoutes } from "./routes/escalations.routes.js";
import { usersRoutes } from "./routes/users.routes.js";
import { auditRoutes } from "./routes/audit.routes.js";
import { internalRoutes } from "./routes/internal.routes.js";
import { notificationsRoutes } from "./routes/notifications.routes.js";
import { configRoutes } from "./routes/config.routes.js";
import { integrationsRoutes } from "./routes/integrations.routes.js";
import { agentDomRoutes } from "./routes/agent-dom.routes.js";
import { observationRoutes } from "./routes/observation.routes.js";
import { jobsRoutes } from "./routes/jobs.routes.js";
import { documentsRoutes } from "./routes/documents.routes.js";
import { submissionDataRoutes } from "./routes/submission-data.routes.js";
import { metricsRoutes } from "./routes/metrics.routes.js";
import { masterDataRoutes } from "./routes/master-data.routes.js";
import { registerJobStatusWebSocket } from "./realtime/job-status.websocket.js";

export async function buildApp() {
  const app = Fastify({
    bodyLimit: env.DOCUMENT_MAX_UPLOAD_BYTES,
    logger: {
      level: backendLogLevel(),
      redact: logRedactionPaths
    }
  });

  await app.register(cors, {
    origin: env.FRONTEND_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Accept", "Authorization", "Content-Type", "X-Refresh-Token"]
  });
  await app.register(helmet);
  await app.register(rateLimit, { max: env.RATE_LIMIT_MAX, timeWindow: env.RATE_LIMIT_WINDOW });
  registerJobStatusWebSocket(app);

  app.addHook("preHandler", attachUser);

  const healthResponse = async () => ({
    status: "ok",
    service: "rpa-backend",
    timestamp: new Date().toISOString()
  });

  app.get("/health", healthResponse);
  app.get("/api/health", healthResponse);

  await app.register(authRoutes, { prefix: "/api" });
  await app.register(dashboardRoutes, { prefix: "/api" });
  await app.register(submissionsRoutes, { prefix: "/api" });
  await app.register(submissionDataRoutes, { prefix: "/api" });
  await app.register(documentsRoutes, { prefix: "/api" });
  await app.register(jobsRoutes, { prefix: "/api" });
  await app.register(portalsRoutes, { prefix: "/api" });
  await app.register(portalTemplatesRoutes, { prefix: "/api" });
  await app.register(escalationsRoutes, { prefix: "/api" });
  await app.register(usersRoutes, { prefix: "/api" });
  await app.register(auditRoutes, { prefix: "/api" });
  await app.register(notificationsRoutes, { prefix: "/api" });
  await app.register(configRoutes, { prefix: "/api" });
  await app.register(integrationsRoutes, { prefix: "/api" });
  await app.register(agentDomRoutes, { prefix: "/api" });
  await app.register(observationRoutes, { prefix: "/api" });
  await app.register(metricsRoutes, { prefix: "/api" });
  await app.register(masterDataRoutes, { prefix: "/api" });
  await app.register(internalRoutes, { prefix: "/api" });

  registerErrorHandler(app);

  return app;
}
