import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { permissions } from "../permissions/permissions.js";
import { requirePermission } from "../middleware/auth.js";
import { cancelSubmission, createSubmission, CustomerRecordNotVerifiedError, getSubmissionDetail, InvalidCoverageTypeError, listSubmissions, SubmissionNotCancellableError, type SubmissionListFilters } from "../services/submissions.service.js";
import { recordAudit } from "../services/audit.service.js";
import type { SubmissionStatus } from "../data/demo-data.js";
import { idParamSchema, paginationQuerySchema, withDateRange } from "../validation/common.schemas.js";

const createSubmissionSchema = z.object({
  customer: z.union([
    z.string().min(2),
    z.object({
      fullName: z.string().min(2),
      dateOfBirth: z.string().date().optional(),
      email: z.string().email().optional(),
      phone: z.string().min(7).max(50).optional(),
      address: z.string().min(2).max(2000).optional()
    }).strict()
  ]),
  coverageType: z.string().min(2),
  riskDetails: z.record(z.unknown()).optional(),
  portalIds: z.array(z.string()).min(1),
  documentCount: z.number().int().min(0).default(0),
  customerDataId: z.string().min(1).optional(),
  memberIds: z.array(z.string().min(1)).optional(),
  quoteGroupBy: z.enum(["location", "category", "salaryBand", "nationality"]).optional(),
  submissionData: z.object({
    source: z.enum(["broker_entry", "excel_upload", "public_form"]).default("broker_entry"),
    sourceFilename: z.string().max(255).nullable().optional(),
    companyDetails: z.record(z.unknown()).default({}),
    contactDetails: z.record(z.unknown()).default({}),
    policyDetails: z.record(z.unknown()).default({}),
    censusMembers: z.array(z.record(z.unknown())).default([])
  }).optional()
}).strict();

const statusValues = ["queued", "processing", "completed", "escalated", "failed", "cancelled"] as const;

const listSubmissionQuerySchema = withDateRange({
  ...paginationQuerySchema.shape,
  status: z.enum(statusValues).optional(),
  portalId: z.string().min(1).optional()
});

const updateSubmissionSchema = z.object({
  action: z.literal("cancel")
});

const feedbackSchema = z.object({
  sentiment: z.enum(["positive", "negative"]),
  note: z.string().max(500).optional()
}).strict();

export async function submissionsRoutes(app: FastifyInstance) {
  app.get(
    "/submissions",
    { preHandler: [requirePermission(permissions.submissionsView)] },
    async (request, reply) => {
      const query = listSubmissionQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: query.error.issues });
      }
      const data = await listSubmissions(query.data as SubmissionListFilters & { status?: SubmissionStatus });
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
    "/submissions/:id",
    { preHandler: [requirePermission(permissions.submissionsView)] },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      }
      const { id } = params.data;
      const submission = await getSubmissionDetail(id);
      if (!submission) {
        return reply.code(404).send({ error: "NOT_FOUND" });
      }
      return { data: submission };
    }
  );

  app.post(
    "/submissions/:id/feedback",
    { preHandler: [requirePermission(permissions.submissionsView)] },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      }
      const body = feedbackSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      }
      const submission = await getSubmissionDetail(params.data.id);
      if (!submission) {
        return reply.code(404).send({ error: "NOT_FOUND" });
      }
      const audit = recordAudit({
        actor: request.user!.id,
        action: `submission_feedback_${body.data.sentiment}`,
        target: params.data.id,
        status: "success"
      });
      return { data: { sentiment: body.data.sentiment, auditId: audit.id } };
    }
  );

  app.post(
    "/submissions",
    { preHandler: [requirePermission(permissions.submissionsCreate)] },
    async (request, reply) => {
      const body = createSubmissionSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      }

      try {
        const result = await createSubmission({ ...body.data, actor: request.user!.id });
        if ("error" in result) {
          return reply.code(400).send({
            error: result.error,
            message: "One or more selected portals are missing, inactive, or offline."
          });
        }
        return reply.code(201).send(result);
      } catch (error) {
        if (error instanceof InvalidCoverageTypeError) {
          return reply.code(400).send({ error: "INVALID_COVERAGE_TYPE", message: "Coverage type must be selected from master data." });
        }
        if (error instanceof CustomerRecordNotVerifiedError) {
          return reply.code(409).send({ error: "CUSTOMER_RECORD_NOT_VERIFIED", message: error.message });
        }
        throw error;
      }
    }
  );

  app.patch(
    "/submissions/:id",
    { preHandler: [requirePermission(permissions.submissionsEdit)] },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      }
      const { id } = params.data;
      const body = updateSubmissionSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      }

      try {
        const submission = await cancelSubmission(id, request.user!.id);
        if (!submission) {
          return reply.code(404).send({ error: "NOT_FOUND" });
        }
        return { data: submission };
      } catch (error) {
        if (error instanceof SubmissionNotCancellableError) {
          return reply.code(409).send({ error: "SUBMISSION_NOT_CANCELLABLE", message: "Only queued or escalated submissions can be cancelled." });
        }
        throw error;
      }
    }
  );
}
