import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { requirePermission } from "../middleware/auth.js";
import { permissions } from "../permissions/permissions.js";
import { idParamSchema } from "../validation/common.schemas.js";
import {
  checkCensusTemplateForJob,
  clonePortalTemplate,
  getCensusTemplateRecord,
  getPortalTemplate,
  getPublishedExecutionTemplate,
  handleDetectedDialog,
  listPortalDialogs,
  listPortalTemplates,
  publishPortalTemplate,
  saveCensusTemplate,
  savePortalDialog,
  savePortalTemplate,
  testPortalTemplate,
  validatePortalTemplate
} from "../services/portal-templates.service.js";

const selectorSchema = z.object({
  strategy: z.enum(["role", "label", "css"]),
  value: z.string().min(1),
  priority: z.number().int().positive().optional()
}).passthrough();

const templateSchema = z.object({
  id: z.string().min(1).max(32).optional(),
  portalId: z.string().min(1).max(32),
  name: z.string().min(2).max(255),
  coverageType: z.string().min(1).max(100),
  coverageTypeCode: z.string().max(80).nullable().optional(),
  workflowType: z.enum(["census_upload", "benefits_builder", "hybrid"]).default("hybrid"),
  domSnapshotIds: z.array(z.string().min(1).max(32)).default([]),
  fieldMappings: z.record(z.string(), z.unknown()).default({ fields: [], submit: { type: "button", selectors: [] } }),
  censusMapping: z.record(z.string(), z.unknown()).nullable().optional(),
  dialogRules: z.array(z.record(z.string(), z.unknown())).default([]),
  submitRules: z.record(z.string(), z.unknown()).default({}),
  quoteCaptureRules: z.record(z.string(), z.unknown()).default({ strategy: "direct_download" }),
  requiredSections: z.array(z.string()).optional(),
  testStatus: z.enum(["not_run", "passed", "failed"]).optional(),
  testReport: z.record(z.string(), z.unknown()).nullable().optional(),
  parentTemplateId: z.string().max(32).nullable().optional()
});

const censusSchema = z.object({
  id: z.string().max(32).optional(),
  portalId: z.string().min(1).max(32),
  portalTemplateId: z.string().max(32).nullable().optional(),
  domSnapshotId: z.string().max(32).nullable().optional(),
  filename: z.string().max(255).nullable().optional(),
  fileHash: z.string().min(1).max(128),
  filePublicId: z.string().max(255).nullable().optional(),
  fileUrl: z.string().max(2048).nullable().optional(),
  sheetName: z.string().max(255).nullable().optional(),
  headers: z.array(z.string()).default([]),
  columnMapping: z.record(z.string(), z.unknown()).nullable().optional(),
  validationRules: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
  status: z.enum(["observed", "approved", "changed_pending_review", "superseded"]).optional()
});

const dialogSchema = z.object({
  id: z.string().max(32).optional(),
  portalId: z.string().min(1).max(32),
  portalTemplateId: z.string().max(32).nullable().optional(),
  name: z.string().min(1).max(255),
  triggerStep: z.string().max(100).nullable().optional(),
  detectionPattern: z.record(z.string(), z.unknown()),
  observedContent: z.record(z.string(), z.unknown()).nullable().optional(),
  defaultAction: z.enum(["ESCALATE", "ACKNOWLEDGE", "RE_LOGIN", "CUSTOM", "CONFIRM_YES"]).optional(),
  approvedAction: z.enum(["ESCALATE", "ACKNOWLEDGE", "RE_LOGIN", "CUSTOM", "CONFIRM_YES"]).nullable().optional(),
  preconditions: z.record(z.string(), z.unknown()).nullable().optional(),
  irreversible: z.boolean().optional(),
  status: z.enum(["observed", "approved", "superseded"]).optional()
});

const censusCheckSchema = z.object({
  fileHash: z.string().min(1).max(128),
  filename: z.string().max(255).nullable().optional(),
  headers: z.array(z.string()).default([]),
  sheetName: z.string().max(255).nullable().optional()
});

const dialogDetectedSchema = z.object({
  portalId: z.string().optional(),
  portalTemplateId: z.string().optional(),
  step: z.string().optional(),
  text: z.string().min(1),
  buttons: z.array(z.string()).default([]),
  screenshotUrl: z.string().url().nullable().optional()
});

function requireInternalToken(request: { headers: { authorization?: string } }) {
  const token = request.headers.authorization?.replace("Bearer ", "");
  return Boolean(env.INTERNAL_AGENT_TOKEN && token === env.INTERNAL_AGENT_TOKEN);
}

export async function portalTemplatesRoutes(app: FastifyInstance) {
  app.get("/portal-templates", { preHandler: [requirePermission(permissions.portalsView)] }, async (request, reply) => {
    const query = z.object({
      portalId: z.string().optional(),
      coverageType: z.string().optional(),
      status: z.string().optional()
    }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: query.error.issues });
    return { data: await listPortalTemplates(query.data) };
  });

  app.get("/portal-templates/:id", { preHandler: [requirePermission(permissions.portalsView)] }, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
    const template = await getPortalTemplate(params.data.id);
    if (!template) return reply.code(404).send({ error: "PORTAL_TEMPLATE_NOT_FOUND" });
    return { data: template };
  });

  app.post("/portal-templates", { preHandler: [requirePermission(permissions.portalsManage)] }, async (request, reply) => {
    const body = templateSchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
    return reply.code(201).send({ data: await savePortalTemplate(body.data, request.user!.id, "draft") });
  });

  app.post("/portal-templates/:id/test", { preHandler: [requirePermission(permissions.portalsManage)] }, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
    const existing = await getPortalTemplate(params.data.id);
    const body = templateSchema.partial().safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
    const payload = templateSchema.safeParse({ ...(existing as Record<string, unknown> ?? {}), ...body.data, id: params.data.id });
    if (!payload.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: payload.error.issues });
    const report = await testPortalTemplate(payload.data);
    const saved = await savePortalTemplate({ ...payload.data, testStatus: report.status as "passed" | "failed", testReport: report }, request.user!.id, "draft");
    return { data: { template: saved, report } };
  });

  app.post("/portal-templates/:id/publish", { preHandler: [requirePermission(permissions.portalsManage)] }, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
    try {
      const template = await publishPortalTemplate(params.data.id, request.user!.id);
      if (!template) return reply.code(404).send({ error: "PORTAL_TEMPLATE_NOT_FOUND" });
      return { data: template };
    } catch (error) {
      return reply.code(409).send({ error: "PORTAL_TEMPLATE_NOT_PUBLISHABLE", issues: (error as Error & { issues?: string[] }).issues ?? [String((error as Error).message)] });
    }
  });

  app.post("/portal-templates/:id/clone", { preHandler: [requirePermission(permissions.portalsManage)] }, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
    const template = await clonePortalTemplate(params.data.id, request.user!.id);
    if (!template) return reply.code(404).send({ error: "PORTAL_TEMPLATE_NOT_FOUND" });
    return reply.code(201).send({ data: template });
  });

  app.post("/portal-templates/:id/validate", { preHandler: [requirePermission(permissions.portalsManage)] }, async (request, reply) => {
    const body = templateSchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
    return { data: validatePortalTemplate(body.data, false) };
  });

  app.post("/census-templates", { preHandler: [requirePermission(permissions.portalsManage)] }, async (request, reply) => {
    const body = censusSchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
    return reply.code(201).send({ data: await saveCensusTemplate(body.data, request.user!.id) });
  });

  app.get("/census-templates/:id", { preHandler: [requirePermission(permissions.portalsView)] }, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
    const template = await getCensusTemplateRecord(params.data.id);
    if (!template) return reply.code(404).send({ error: "CENSUS_TEMPLATE_NOT_FOUND" });
    return { data: template };
  });

  app.post("/portal-dialogs", { preHandler: [requirePermission(permissions.portalsManage)] }, async (request, reply) => {
    const body = dialogSchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
    return reply.code(201).send({ data: await savePortalDialog(body.data, request.user!.id) });
  });

  app.get("/portal-dialogs", { preHandler: [requirePermission(permissions.portalsView)] }, async (request, reply) => {
    const query = z.object({
      portalId: z.string().optional(),
      portalTemplateId: z.string().optional(),
      status: z.string().optional()
    }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: query.error.issues });
    return { data: await listPortalDialogs(query.data) };
  });

  app.get("/internal/jobs/:id/execution-template", async (request, reply) => {
    if (!requireInternalToken(request)) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
    const query = z.object({ domSnapshotId: z.string().optional() }).safeParse(request.query);
    const result = await getPublishedExecutionTemplate({ jobId: params.data.id, domSnapshotId: query.success ? query.data.domSnapshotId : null });
    if (result.blocked) return reply.code(409).send({ error: "EXECUTION_TEMPLATE_BLOCKED", message: result.reason, data: result });
    return { data: result };
  });

  app.post("/internal/jobs/:id/census-template-check", async (request, reply) => {
    if (!requireInternalToken(request)) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
    const body = censusCheckSchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
    const result = await checkCensusTemplateForJob(params.data.id, body.data);
    if (result.blocked) return reply.code(409).send({ error: "CENSUS_TEMPLATE_BLOCKED", message: result.reason, data: result });
    return { data: result };
  });

  app.post("/internal/jobs/:id/dialog-detected", async (request, reply) => {
    if (!requireInternalToken(request)) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
    const body = dialogDetectedSchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
    const result = await handleDetectedDialog(params.data.id, body.data);
    if (result.blocked) return reply.code(409).send({ error: "DIALOG_BLOCKED", message: result.reason, data: result });
    return { data: result };
  });
}
