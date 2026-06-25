import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { createJobQuotePdfUpload, createJobScreenshotUpload } from "../services/cloudinary.service.js";
import { readPortalCredentialsForAgent } from "../services/credentials.service.js";
import { getJob, markJobFailure, markJobProcessing, recordAgentAction, recordQuote } from "../services/jobs.service.js";
import { getInsurerWorkflow, getMemberData, getPublishedExecutionMapping, getPublishedPortalMapping } from "../services/member-data.service.js";
import { getSubmissionData } from "../services/submission-data.service.js";
import { getDomSnapshot } from "../services/agent-dom.service.js";
import { handleValueDriftReport } from "../services/escalations.service.js";

const failureSchema = z.object({
  error: z.string().min(1).optional(),
  terminal: z.boolean().optional(),
  status: z.enum(["failed", "escalated"]).optional()
});

const startedSchema = z.object({
  step: z.string().min(1).max(120).optional()
});

const agentActionSchema = z.object({
  actionType: z.string().min(1).max(100),
  confidenceScore: z.number().min(0).max(100),
  actionPayload: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(["success", "failed", "escalated", "processing", "skipped"]),
  executedBy: z.string().min(1).max(100).optional(),
  beforeScreenshotUrl: z.string().max(2048).nullable().optional(),
  afterScreenshotUrl: z.string().max(2048).nullable().optional()
});

const quoteSchema = z.object({
  premium: z.number().nonnegative(),
  currency: z.string().min(3).max(3),
  quoteReference: z.string().min(1).max(255).nullable().optional(),
  quotePayload: z.record(z.string(), z.unknown()).default({}),
  memberId: z.string().min(1).max(32).nullable().optional(),
  quotePdfUrl: z.string().url().nullable().optional(),
  quotePdfPublicId: z.string().min(1).max(255).nullable().optional(),
  status: z.string().min(1).max(50).optional()
});

const screenshotUploadSchema = z.object({
  stage: z.enum(["before", "after"]),
  publicId: z.string().min(1).max(255).optional()
});

const quotePdfUploadSchema = z.object({
  publicId: z.string().min(1).max(255).optional(),
  resourceType: z.enum(["image", "raw", "auto"]).optional()
});

const valueDriftSchema = z.object({
  portalId: z.string().optional(),
  portalName: z.string().optional(),
  jobId: z.string().optional(),
  mappingVersion: z.number().optional(),
  snapshotId: z.string().optional(),
  hasDrift: z.boolean(),
  isBlocking: z.boolean(),
  driftedFields: z.array(z.object({
    normalizedTarget: z.string().min(1),
    fieldType: z.string().optional(),
    selector: z.unknown().optional(),
    approvedValues: z.array(z.string()).optional(),
    approvedValueMap: z.record(z.string(), z.string()).optional(),
    liveValues: z.array(z.string()).optional(),
    missingFromPortal: z.array(z.string()).optional(),
    newOnPortal: z.array(z.string()).optional(),
    severity: z.enum(["blocking", "warning"]).default("blocking")
  }).passthrough()).default([]),
  uncheckedFields: z.array(z.unknown()).default([]),
  checkErrors: z.array(z.unknown()).default([])
}).passthrough();

function requireInternalToken(request: { headers: { authorization?: string } }) {
  const token = request.headers.authorization?.replace("Bearer ", "");
  return Boolean(env.INTERNAL_AGENT_TOKEN && token === env.INTERNAL_AGENT_TOKEN);
}

export async function internalRoutes(app: FastifyInstance) {
  app.get("/internal/portals/:id/credentials", async (request, reply) => {
    if (!requireInternalToken(request)) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    const { id } = request.params as { id: string };
    const credentials = await readPortalCredentialsForAgent(id, { actor: "agent-worker", action: "portal_credentials_read" });
    if (!credentials) {
      return reply.code(404).send({ error: "CREDENTIALS_NOT_FOUND" });
    }
    return { data: credentials };
  });

  app.get("/internal/submissions/:id/data", async (request, reply) => {
    if (!requireInternalToken(request)) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    const { id } = request.params as { id: string };
    const data = await getSubmissionData(id);
    if (!data) {
      return reply.code(404).send({ error: "SUBMISSION_DATA_NOT_FOUND" });
    }
    return { data };
  });

  app.get("/internal/jobs/:id/member-data", async (request, reply) => {
    if (!requireInternalToken(request)) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }
    const { id } = request.params as { id: string };
    const job = await getJob(id);
    if (!job) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    const payload = (job.payload ?? {}) as { memberId?: unknown };
    const memberId = typeof payload.memberId === "string" ? payload.memberId : undefined;
    if (!memberId) return reply.code(404).send({ error: "MEMBER_NOT_LINKED_TO_JOB" });
    const member = await getMemberData(memberId);
    if (!member) return reply.code(404).send({ error: "MEMBER_NOT_FOUND" });
    const submissionData = await getSubmissionData(job.submissionId);
    const coverageType = submissionData?.policyDetails?.coverageType ? String(submissionData.policyDetails.coverageType) : "";
    const mapping = job.portalId && coverageType ? await getPublishedPortalMapping(job.portalId, coverageType) : null;
    const workflow = job.portalId && coverageType ? await getInsurerWorkflow(job.portalId, coverageType) : null;
    return { data: { member, submissionData, mapping, workflow } };
  });

  app.get("/internal/jobs/:id/execution-mapping", async (request, reply) => {
    if (!requireInternalToken(request)) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }
    const { id } = request.params as { id: string };
    const query = z.object({ domSnapshotId: z.string().min(1).max(32) }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: query.error.issues });

    const job = await getJob(id);
    if (!job || !job.portalId) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    const submissionData = await getSubmissionData(job.submissionId);
    const coverageType = submissionData?.policyDetails?.coverageType ? String(submissionData.policyDetails.coverageType) : "";
    if (!coverageType) return reply.code(409).send({ error: "COVERAGE_TYPE_REQUIRED", message: "Submission coverage type is required before mapping execution." });

    const snapshot = await getDomSnapshot(query.data.domSnapshotId);
    if (!snapshot) return reply.code(404).send({ error: "DOM_SNAPSHOT_NOT_FOUND" });
    if (snapshot.status !== "approved") return reply.code(409).send({ error: "DOM_NOT_APPROVED", message: "DOM snapshot must be approved before portal submission." });
    if (snapshot.portalId !== job.portalId) return reply.code(409).send({ error: "DOM_PORTAL_MISMATCH", message: "DOM snapshot does not belong to the job portal." });

    const mapping = await getPublishedExecutionMapping({ portalId: job.portalId, coverageType, domSnapshotId: snapshot.id });
    if (!mapping) return reply.code(409).send({ error: "MAPPING_REQUIRED", message: "Published field mapping is required before portal submission." });
    return { data: { mapping, snapshot, coverageType } };
  });

  app.post("/internal/jobs/:id/failure", async (request, reply) => {
    if (!requireInternalToken(request)) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    const body = failureSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
    }

    const { id } = request.params as { id: string };
    const job = await markJobFailure({
      id,
      error: body.data.error ?? "Worker failure",
      actor: "agent-worker",
      terminal: body.data.terminal,
      status: body.data.status
    });
    if (!job) {
      return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    }
    return { data: job };
  });

  app.post("/internal/jobs/:id/value-drift", async (request, reply) => {
    if (!requireInternalToken(request)) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    const body = valueDriftSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
    }

    const { id } = request.params as { id: string };
    const escalation = await handleValueDriftReport(id, body.data);
    if (!escalation) {
      return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    }
    return reply.code(201).send({
      data: {
        escalationId: escalation.id,
        status: escalation.status,
        message: "Value drift escalation created. Advisory mapping suggestion is running in the background."
      }
    });
  });

  app.post("/internal/jobs/:id/started", async (request, reply) => {
    if (!requireInternalToken(request)) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    const body = startedSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
    }

    const { id } = request.params as { id: string };
    const job = await markJobProcessing({ id, step: body.data.step, actor: "agent-worker" });
    if (!job) {
      return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    }
    return { data: job };
  });

  app.post("/internal/jobs/:id/actions", async (request, reply) => {
    if (!requireInternalToken(request)) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    const body = agentActionSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
    }

    const { id } = request.params as { id: string };
    const action = await recordAgentAction({
      portalJobId: id,
      ...body.data
    });
    if (!action) {
      return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    }
    return { data: action };
  });

  app.post("/internal/jobs/:id/quotes", async (request, reply) => {
    if (!requireInternalToken(request)) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    const body = quoteSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
    }

    const { id } = request.params as { id: string };
    const quote = await recordQuote({
      portalJobId: id,
      ...body.data
    });
    if (!quote) {
      return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    }
    return { data: quote };
  });

  app.post("/internal/jobs/:id/screenshots/sign-upload", async (request, reply) => {
    if (!requireInternalToken(request)) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    const body = screenshotUploadSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
    }

    const { id } = request.params as { id: string };
    const job = await getJob(id);
    if (!job) {
      return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    }
    return { data: createJobScreenshotUpload({ jobId: id, ...body.data }) };
  });

  app.post("/internal/jobs/:id/quote-pdf/sign-upload", async (request, reply) => {
    if (!requireInternalToken(request)) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    const body = quotePdfUploadSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
    }

    const { id } = request.params as { id: string };
    const job = await getJob(id);
    if (!job) {
      return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    }
    return { data: createJobQuotePdfUpload({ jobId: id, ...body.data }) };
  });
}
