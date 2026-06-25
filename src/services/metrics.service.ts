import { env } from "../config/env.js";
import { shouldUseDatabase } from "../db/runtime.js";
import { listQueuedPortalJobs } from "../queue/portal-jobs.queue.js";

function metricHelp(name: string, help: string, type: "gauge" | "counter" = "gauge") {
  return [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`];
}

function booleanValue(value: boolean) {
  return value ? 1 : 0;
}

export function renderMetrics() {
  const lines = [
    ...metricHelp("brokerflow_build_info", "Static build/runtime information."),
    `brokerflow_build_info{service="backend",environment="${env.NODE_ENV}"} 1`,
    ...metricHelp("brokerflow_database_mode", "Whether the backend is configured to use MySQL on startup."),
    `brokerflow_database_mode ${booleanValue(shouldUseDatabase())}`,
    ...metricHelp("brokerflow_demo_fallback_enabled", "Whether demo fallback is allowed after DB errors."),
    `brokerflow_demo_fallback_enabled ${booleanValue(env.DB_ALLOW_DEMO_FALLBACK)}`,
    ...metricHelp("brokerflow_portal_jobs_queue_depth", "Current in-process portal job queue depth."),
    `brokerflow_portal_jobs_queue_depth ${listQueuedPortalJobs().length}`,
    ...metricHelp("brokerflow_integration_configured", "Whether optional integrations are configured.", "gauge"),
    `brokerflow_integration_configured{integration="redis"} ${booleanValue(Boolean(env.REDIS_URL))}`,
    `brokerflow_integration_configured{integration="cloudinary"} ${booleanValue(Boolean((env.CLOUDINARY_URL || env.CLOUDINARY_CLOUD_NAME) && env.CLOUDINARY_API_KEY))}`,
    `brokerflow_integration_configured{integration="gemini"} ${booleanValue(Boolean(env.GEMINI_API_KEY))}`,
    `brokerflow_integration_configured{integration="smtp"} ${booleanValue(Boolean((env.SMTP_HOST || env.MAIL_HOST) && (env.NOTIFICATION_FROM_EMAIL || env.MAIL_FROM_ADDRESS)))}`
  ];
  return `${lines.join("\n")}\n`;
}
