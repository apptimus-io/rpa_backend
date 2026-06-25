import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { permissions } from "../permissions/permissions.js";
import { requirePermission } from "../middleware/auth.js";
import { listJobs } from "../services/jobs.service.js";
import { listPortals } from "../services/portals.service.js";
import { listSubmissions } from "../services/submissions.service.js";
import { listEscalations } from "../services/escalations.service.js";
import { findEscalationSlaBreaches } from "../services/escalation-sla.service.js";

async function dashboardDataset() {
  const [submissions, jobs, portals, escalations] = await Promise.all([
    listSubmissions(),
    listJobs(),
    listPortals(),
    listEscalations()
  ]);
  const completed = submissions.filter((item) => item.status === "completed").length;
  return {
    submissions,
    jobs,
    portals,
    escalations,
    kpis: {
      submissionsToday: submissions.length,
      successRate: submissions.length ? Math.round((completed / submissions.length) * 100) : 0,
      averageMinutes: 3.8,
      escalationsPending: escalations.filter((item) => item.status === "pending").length
    }
  };
}

function dayKey(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

export const trendQuerySchema = z.object({
  range: z.coerce.number().int().refine((value) => value === 7 || value === 30, "range must be 7 or 30").default(7)
});

export async function dashboardRoutes(app: FastifyInstance) {
  app.get(
    "/dashboard",
    { preHandler: [requirePermission(permissions.dashboardView)] },
    async () => {
      const { kpis, jobs, portals } = await dashboardDataset();
      return {
        kpis,
        jobs,
        portals
      };
    }
  );

  app.get(
    "/dashboard/kpis",
    { preHandler: [requirePermission(permissions.dashboardView)] },
    async () => {
      const { kpis } = await dashboardDataset();
      return { data: kpis };
    }
  );

  app.get(
    "/dashboard/trends",
    { preHandler: [requirePermission(permissions.dashboardView)] },
    async (request, reply) => {
      const query = trendQuerySchema.safeParse(request.query ?? {});
      if (!query.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: query.error.issues });
      }
      const { submissions, jobs } = await dashboardDataset();
      const slaBreaches = await findEscalationSlaBreaches();
      const today = new Date();
      const days = Array.from({ length: query.data.range }, (_, index) => {
        const date = new Date(today);
        date.setDate(today.getDate() - (query.data.range - 1 - index));
        const key = date.toISOString().slice(0, 10);
        const daySubmissions = submissions.filter((submission) => dayKey(submission.createdAt) === key);
        return {
          date: key,
          submissions: daySubmissions.length,
          completed: daySubmissions.filter((submission) => submission.status === "completed").length,
          escalated: daySubmissions.filter((submission) => submission.status === "escalated").length
        };
      });
      const operatorStats = Object.values(submissions.reduce<Record<string, { operatorId: string; submissions: number; completed: number }>>((acc, submission) => {
        const operatorId = submission.createdBy ?? "unknown";
        acc[operatorId] ??= { operatorId, submissions: 0, completed: 0 };
        acc[operatorId].submissions += 1;
        if (submission.status === "completed") acc[operatorId].completed += 1;
        return acc;
      }, {}));
      return {
        data: {
          range: query.data.range,
          days,
          operatorStats,
          deadLetterCount: jobs.filter((job) => job.status === "failed").length,
          escalationSlaBreachCount: slaBreaches.length
        }
      };
    }
  );

  app.get(
    "/dashboard/portal-health",
    { preHandler: [requirePermission(permissions.dashboardView)] },
    async () => {
      const { portals, jobs } = await dashboardDataset();
      return {
        data: portals.map((portal) => ({
          id: portal.id,
          name: portal.name,
          health: portal.health,
          successRate: portal.successRate,
          lastHealthCheck: portal.lastHealthCheck,
          activeJobs: jobs.filter((job) => job.portalId === portal.id && ["queued", "processing"].includes(job.status)).length,
          failedJobs: jobs.filter((job) => job.portalId === portal.id && job.status === "failed").length
        }))
      };
    }
  );
}
