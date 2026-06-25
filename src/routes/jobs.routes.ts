import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../middleware/auth.js";
import { permissions } from "../permissions/permissions.js";
import { deadLetterJobs, getJobDetail, JobNotRetryableError, JobRetryLimitError, listJobs, retryJob, type JobListFilters } from "../services/jobs.service.js";
import { auditLog } from "../data/demo-data.js";
import type { JobStatus } from "../data/demo-data.js";
import { idParamSchema, paginationQuerySchema } from "../validation/common.schemas.js";

const jobStatuses = ["queued", "processing", "completed", "escalated", "failed", "cancelled"] as const;
const listQuerySchema = paginationQuerySchema.extend({
  status: z.enum(jobStatuses).optional(),
  portalId: z.string().min(1).optional(),
  submissionId: z.string().min(1).optional()
});

export async function jobsRoutes(app: FastifyInstance) {
  app.get(
    "/jobs",
    { preHandler: [requirePermission(permissions.dashboardView)] },
    async (request, reply) => {
      const query = listQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: query.error.issues });
      }
      const data = await listJobs(query.data as JobListFilters & { status?: JobStatus });
      return {
        data,
        pagination: query.data.page && query.data.limit ? {
          page: query.data.page,
          limit: query.data.limit,
          count: data.length
        } : undefined
      };
    }
  );

  app.get(
    "/jobs/dead-letter",
    { preHandler: [requirePermission(permissions.dashboardView)] },
    async () => ({ data: await deadLetterJobs() })
  );

  app.get(
    "/jobs/:id",
    { preHandler: [requirePermission(permissions.dashboardView)] },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      }
      const { id } = params.data;
      const job = await getJobDetail(id);
      if (!job) {
        return reply.code(404).send({ error: "JOB_NOT_FOUND" });
      }
      return {
        data: {
          ...job,
          audit: auditLog.filter((record) => record.target === id)
        }
      };
    }
  );

  app.post(
    "/jobs/:id/retry",
    { preHandler: [requirePermission(permissions.submissionsEdit)] },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      }
      const { id } = params.data;
      try {
        const job = await retryJob(id, request.user!.id);
        if (!job) {
          return reply.code(404).send({ error: "JOB_NOT_FOUND" });
        }
        return { data: job };
      } catch (error) {
        if (error instanceof JobNotRetryableError) {
          return reply.code(409).send({ error: "JOB_NOT_RETRYABLE", message: "Only failed jobs can be retried." });
        }
        if (error instanceof JobRetryLimitError) {
          return reply.code(409).send({ error: "JOB_RETRY_LIMIT_REACHED", message: "Job has reached the retry limit." });
        }
        throw error;
      }
    }
  );
}
