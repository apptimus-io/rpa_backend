import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { requirePermission } from "../middleware/auth.js";
import { permissions } from "../permissions/permissions.js";
import { idParamSchema } from "../validation/common.schemas.js";
import {
  createCustomerIntakeLink,
  createPublicIntakeLink,
  CustomerDataDeleteBlockedError,
  deleteCustomerDataRecord,
  getCustomerDataRecord,
  getCustomerPublicIntake,
  getPublicIntake,
  getSubmissionData,
  importSpreadsheetCustomerData,
  listIntakeFormTemplates,
  listCustomerDataRows,
  listCustomerRecordsForVerification,
  parseSpreadsheetSubmissionData,
  saveCustomerData,
  saveIntakeFormTemplate,
  saveSubmissionData,
  submitCustomerPublicIntake,
  submitDynamicCustomerPublicIntake,
  submitPublicIntake,
  updateCustomerVerification
} from "../services/submission-data.service.js";
import {
  confirmMemberExcelImport,
  getMemberData,
  getPublishedPortalMapping,
  listCustomerMembers,
  listExcelMappingTemplates,
  previewMemberExcel,
  saveExcelMappingTemplate,
  saveInsurerWorkflow,
  savePortalFieldMapping,
  validatePortalMappingPayload
} from "../services/member-data.service.js";
import type { ExcelMapping } from "../services/member-data.service.js";

const sourceValues = ["broker_entry", "excel_upload", "public_form"] as const;

const censusMemberSchema = z.object({
  serialNo: z.string().optional(),
  employeeNo: z.string().optional(),
  employeeName: z.string().min(1),
  relationship: z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender: z.string().optional(),
  maritalStatus: z.string().optional(),
  nationality: z.string().optional(),
  visaIssuanceEmirate: z.string().optional(),
  category: z.string().optional(),
  memberType: z.string().optional()
}).passthrough();

const submissionDataBodySchema = z.object({
  source: z.enum(sourceValues).default("broker_entry"),
  sourceFilename: z.string().max(255).nullable().optional(),
  companyDetails: z.record(z.unknown()).default({}),
  contactDetails: z.record(z.unknown()).default({}),
  policyDetails: z.record(z.unknown()).default({}),
  censusMembers: z.array(censusMemberSchema).default([])
}).strict();

const importExcelBodySchema = z.object({
  filename: z.string().min(1).max(255),
  contentBase64: z.string().min(1),
  customerName: z.string().min(1).max(255).optional(),
  companyName: z.string().min(1).max(255).optional(),
  contactName: z.string().max(255).optional(),
  contactEmail: z.string().max(255).optional(),
  contactPhone: z.string().max(50).optional(),
  importMode: z.enum(["company_with_members", "individual_customers"]).optional(),
  coverageType: z.string().min(2).max(100).optional()
}).strict();

const intakeTokenParamsSchema = z.object({
  token: z.string().min(24).max(200)
});

const formFieldSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(160),
  type: z.enum(["text", "email", "phone", "date", "number", "textarea", "select", "file", "member_table"]),
  required: z.boolean().optional(),
  target: z.string().min(1).max(120).optional(),
  options: z.array(z.string().min(1).max(120)).optional()
}).strict();

const memberColumnSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(160),
  target: z.string().min(1).max(120),
  type: z.enum(["text", "date", "number", "select"]),
  required: z.boolean().optional(),
  locked: z.boolean().optional()
}).strict();

const formTemplateBodySchema = z.object({
  id: z.string().min(1).max(32).optional(),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).nullable().optional(),
  coverageType: z.string().max(100).nullable().optional(),
  coverageTypeCode: z.string().max(80).nullable().optional(),
  formType: z.enum(["company", "individual_customer"]).default("company"),
  templateType: z.enum(["company", "individual_customer"]).optional(),
  fields: z.array(formFieldSchema).min(1),
  memberColumns: z.array(memberColumnSchema).optional(),
  isDefault: z.boolean().default(false)
}).strict();

const verificationBodySchema = z.object({
  status: z.enum(["pending_review", "needs_review", "verified", "rejected"]),
  notes: z.string().max(2000).nullable().optional()
}).strict();

const selectorCandidateSchema = z.object({
  strategy: z.enum(["role", "label", "css"]),
  value: z.string().min(1).max(500),
  priority: z.number().int().min(1).max(20).optional()
}).strict();

const deterministicFieldSchema = z.object({
  target: z.string().min(1).max(120),
  type: z.enum(["text", "select", "date", "checkbox", "file", "button", "table"]).default("text"),
  required: z.boolean().default(false),
  selectors: z.array(selectorCandidateSchema).min(1),
  valueMap: z.record(z.string(), z.string()).optional(),
  transform: z.record(z.unknown()).optional(),
  verification: z.object({
    rule: z.enum(["value_equals", "selected_label_equals", "checked_equals", "exists"]).default("value_equals")
  }).passthrough().optional()
}).strict();

const deterministicMappingSchema = z.object({
  fields: z.array(deterministicFieldSchema).default([]),
  submit: z.object({
    type: z.enum(["button"]).default("button"),
    selectors: z.array(selectorCandidateSchema).min(1),
    verification: z.object({ rule: z.enum(["exists"]).default("exists") }).passthrough().optional()
  }).strict()
}).strict();

const portalFieldMappingBodySchema = z.object({
  id: z.string().min(1).max(32).optional(),
  portalId: z.string().min(1).max(32),
  coverageType: z.string().min(1).max(100),
  domSnapshotId: z.string().min(1).max(32),
  mappings: deterministicMappingSchema,
  requiredFields: z.array(z.string().min(1).max(120)).default([]),
  status: z.enum(["draft", "published"]).optional(),
  mappingVersion: z.number().int().positive().optional()
}).strict();

const intakeLinkBodySchema = z.object({
  formTemplateId: z.string().min(1).max(32).nullable().optional()
}).strict();

const excelMappingSchema = z.record(z.string(), z.string());

const memberExcelPreviewSchema = z.object({
  filename: z.string().min(1).max(255),
  contentBase64: z.string().min(1),
  coverageType: z.string().min(1).max(100),
  mapping: excelMappingSchema.optional()
}).strict();

const memberExcelConfirmSchema = memberExcelPreviewSchema.extend({
  mapping: excelMappingSchema,
  templateName: z.string().min(1).max(255).optional()
}).strict();

const excelTemplateSchema = z.object({
  id: z.string().min(1).max(32).optional(),
  name: z.string().min(1).max(255),
  coverageType: z.string().min(1).max(100),
  portalId: z.string().min(1).max(32).nullable().optional(),
  mappings: excelMappingSchema
}).strict();

const insurerWorkflowSchema = z.object({
  id: z.string().min(1).max(32).optional(),
  portalId: z.string().min(1).max(32),
  coverageType: z.string().min(1).max(100),
  workflowMode: z.enum(["individual_entry", "bulk_upload"]),
  uploadMethod: z.string().max(100).nullable().optional(),
  quoteDownloadMethod: z.string().max(100).nullable().optional(),
  templateConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  isActive: z.boolean().optional()
}).strict();

export async function submissionDataRoutes(app: FastifyInstance) {
  app.get(
    "/customers",
    { preHandler: [requirePermission(permissions.submissionsView)] },
    async () => ({ data: await listCustomerDataRows() })
  );

  app.get(
    "/customers/verification",
    { preHandler: [requirePermission(permissions.submissionsView)] },
    async () => ({ data: await listCustomerRecordsForVerification() })
  );

  app.get(
    "/customers/:id",
    { preHandler: [requirePermission(permissions.submissionsView)] },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      const row = await getCustomerDataRecord(params.data.id);
      if (!row) return reply.code(404).send({ error: "CUSTOMER_DATA_NOT_FOUND" });
      const members = await listCustomerMembers(params.data.id) ?? [];
      return { data: { ...row, members } };
    }
  );

  app.post(
    "/customers/:id/verification",
    { preHandler: [requirePermission(permissions.submissionsEdit)] },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      const body = verificationBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      const row = await updateCustomerVerification({ id: params.data.id, status: body.data.status, notes: body.data.notes, actor: request.user!.id });
      if (!row) return reply.code(404).send({ error: "CUSTOMER_DATA_NOT_FOUND" });
      return { data: row };
    }
  );

  app.post(
    "/customers",
    { preHandler: [requirePermission(permissions.submissionsEdit)] },
    async (_request, reply) => {
      return reply.code(410).send({
        error: "MANUAL_CUSTOMER_CREATE_DISABLED",
        message: "Create company/customer records through Excel import or public intake links."
      });
    }
  );

  app.post(
    "/customers/:id",
    { preHandler: [requirePermission(permissions.submissionsEdit)] },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      const body = submissionDataBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      return { data: await saveCustomerData({ id: params.data.id, validationErrors: [], ...body.data }, request.user!.id) };
    }
  );

  app.delete(
    "/customers/:id",
    { preHandler: [requirePermission(permissions.submissionsEdit)] },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      try {
        const deleted = await deleteCustomerDataRecord(params.data.id, request.user!.id);
        if (!deleted) return reply.code(404).send({ error: "CUSTOMER_DATA_NOT_FOUND" });
        return { data: deleted };
      } catch (error) {
        if (error instanceof CustomerDataDeleteBlockedError) {
          return reply.code(409).send({ error: "CUSTOMER_DELETE_BLOCKED", message: error.message });
        }
        throw error;
      }
    }
  );

  app.post(
    "/customers/import-excel",
    { preHandler: [requirePermission(permissions.submissionsCreate)] },
    async (request, reply) => {
      const body = importExcelBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      return { data: await importSpreadsheetCustomerData(body.data, request.user!.id) };
    }
  );

  app.get(
    "/customers/:id/members",
    { preHandler: [requirePermission(permissions.submissionsView)] },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      const members = await listCustomerMembers(params.data.id);
      if (!members) return reply.code(404).send({ error: "CUSTOMER_DATA_NOT_FOUND" });
      return { data: members };
    }
  );

  app.post(
    "/customers/:id/members/import-preview",
    { preHandler: [requirePermission(permissions.submissionsCreate)] },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      const body = memberExcelPreviewSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      return { data: previewMemberExcel({ ...body.data, mapping: body.data.mapping as ExcelMapping | undefined }) };
    }
  );

  app.post(
    "/customers/:id/members/import-confirm",
    { preHandler: [requirePermission(permissions.submissionsCreate)] },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      const body = memberExcelConfirmSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      const result = await confirmMemberExcelImport({ customerDataId: params.data.id, ...body.data, mapping: body.data.mapping as ExcelMapping }, request.user!.id);
      if (!result) return reply.code(404).send({ error: "CUSTOMER_DATA_NOT_FOUND" });
      return { data: result };
    }
  );

  app.get(
    "/mapping-templates",
    { preHandler: [requirePermission(permissions.submissionsView)] },
    async (request) => {
      const query = z.object({ coverageType: z.string().optional() }).safeParse(request.query);
      return { data: await listExcelMappingTemplates(query.success ? query.data.coverageType : undefined) };
    }
  );

  app.post(
    "/mapping-templates",
    { preHandler: [requirePermission(permissions.submissionsEdit)] },
    async (request, reply) => {
      const body = excelTemplateSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      return { data: await saveExcelMappingTemplate({ ...body.data, mappings: body.data.mappings as ExcelMapping }, request.user!.id) };
    }
  );

  app.get(
    "/portal-field-mappings",
    { preHandler: [requirePermission(permissions.portalsView)] },
    async (request, reply) => {
      const query = z.object({ portalId: z.string(), coverageType: z.string() }).safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: query.error.issues });
      return { data: await getPublishedPortalMapping(query.data.portalId, query.data.coverageType) };
    }
  );

  app.post(
    "/portal-field-mappings",
    { preHandler: [requirePermission(permissions.portalsManage)] },
    async (request, reply) => {
      const body = portalFieldMappingBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      return { data: await savePortalFieldMapping(body.data, request.user!.id) };
    }
  );

  app.post(
    "/portal-field-mappings/draft",
    { preHandler: [requirePermission(permissions.portalsManage)] },
    async (request, reply) => {
      const body = portalFieldMappingBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      return { data: await savePortalFieldMapping({ ...body.data, status: "draft" }, request.user!.id) };
    }
  );

  app.post(
    "/portal-field-mappings/:id/test",
    { preHandler: [requirePermission(permissions.portalsManage)] },
    async (request, reply) => {
      const body = z.object({ mappings: deterministicMappingSchema, requiredFields: z.array(z.string()).default([]) }).safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      return { data: validatePortalMappingPayload(body.data) };
    }
  );

  app.post(
    "/portal-field-mappings/:id/publish",
    { preHandler: [requirePermission(permissions.portalsManage)] },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      const routeId = params.data.id === "draft" ? undefined : params.data.id;
      const body = portalFieldMappingBodySchema.safeParse({ ...(request.body as Record<string, unknown> ?? {}), ...(routeId ? { id: routeId } : {}), status: "published" });
      if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      const validation = validatePortalMappingPayload(body.data);
      if (!validation.valid) return reply.code(409).send({ error: "MAPPING_NOT_PUBLISHABLE", issues: validation.errors });
      return { data: await savePortalFieldMapping({ ...body.data, status: "published" }, request.user!.id) };
    }
  );

  app.post(
    "/insurer-workflows",
    { preHandler: [requirePermission(permissions.portalsManage)] },
    async (request, reply) => {
      const body = insurerWorkflowSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      return { data: await saveInsurerWorkflow(body.data) };
    }
  );

  app.post(
    "/customers/intake-link",
    { preHandler: [requirePermission(permissions.submissionsCreate)] },
    async (request, reply) => {
      const body = intakeLinkBodySchema.safeParse(request.body ?? {});
      if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      return { data: await createCustomerIntakeLink(request.user!.id, env.FRONTEND_ORIGIN, body.data.formTemplateId) };
    }
  );

  app.get(
    "/customers/intake-forms",
    { preHandler: [requirePermission(permissions.submissionsView)] },
    async (request) => {
      const query = z.object({ coverageTypeCode: z.string().optional() }).safeParse(request.query);
      return { data: await listIntakeFormTemplates(query.success ? { coverageTypeCode: query.data.coverageTypeCode } : {}) };
    }
  );

  app.post(
    "/customers/intake-forms",
    { preHandler: [requirePermission(permissions.submissionsEdit)] },
    async (request, reply) => {
      const body = formTemplateBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      return { data: await saveIntakeFormTemplate(body.data, request.user!.id) };
    }
  );

  app.get(
    "/submissions/:id/data",
    { preHandler: [requirePermission(permissions.submissionsView)] },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      return { data: await getSubmissionData(params.data.id) };
    }
  );

  app.post(
    "/submissions/:id/data",
    { preHandler: [requirePermission(permissions.submissionsEdit)] },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      const body = submissionDataBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      return { data: await saveSubmissionData({ submissionId: params.data.id, validationErrors: [], ...body.data }, request.user!.id) };
    }
  );

  app.post(
    "/submissions/:id/data/import-excel",
    { preHandler: [requirePermission(permissions.submissionsCreate)] },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      const body = importExcelBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      const parsed = parseSpreadsheetSubmissionData({ submissionId: params.data.id, ...body.data });
      return { data: await saveSubmissionData(parsed, request.user!.id) };
    }
  );

  app.post(
    "/submissions/:id/intake-link",
    { preHandler: [requirePermission(permissions.submissionsCreate)] },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      const link = await createPublicIntakeLink(params.data.id, request.user!.id, env.FRONTEND_ORIGIN);
      if (!link) return reply.code(404).send({ error: "SUBMISSION_NOT_FOUND" });
      return { data: link };
    }
  );

  app.post(
    "/submissions/data/preview-excel",
    { preHandler: [requirePermission(permissions.submissionsCreate)] },
    async (request, reply) => {
      const body = importExcelBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      return { data: parseSpreadsheetSubmissionData(body.data) };
    }
  );

  app.get("/public/intake/:token", async (request, reply) => {
    const params = intakeTokenParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
    const customerIntake = await getCustomerPublicIntake(params.data.token);
    if (customerIntake) return { data: customerIntake };
    const intake = await getPublicIntake(params.data.token);
    if (!intake) return reply.code(404).send({ error: "INTAKE_LINK_NOT_FOUND_OR_EXPIRED" });
    return { data: { ...intake, mode: "submission" } };
  });

  app.post("/public/intake/:token", async (request, reply) => {
    const params = intakeTokenParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
    const dynamicBody = z.object({ values: z.record(z.unknown()) }).strict().safeParse(request.body);
    if (dynamicBody.success) {
      const saved = await submitDynamicCustomerPublicIntake(params.data.token, dynamicBody.data.values);
      if (!saved) return reply.code(404).send({ error: "INTAKE_LINK_NOT_FOUND_OR_EXPIRED" });
      return { data: saved };
    }
    const body = submissionDataBodySchema.omit({ source: true }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
    const customerSaved = await submitCustomerPublicIntake(params.data.token, body.data);
    if (customerSaved) return { data: customerSaved };
    const saved = await submitPublicIntake(params.data.token, body.data);
    if (!saved) return reply.code(404).send({ error: "INTAKE_LINK_NOT_FOUND_OR_EXPIRED" });
    return { data: saved };
  });
}
