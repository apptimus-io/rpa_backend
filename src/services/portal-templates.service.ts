import { createHash } from "node:crypto";
import { CensusTemplate, DomSnapshot, Portal, PortalDialog, PortalJob, PortalTemplate } from "../db/models.js";
import { canFallbackFromDatabaseError, shouldUseDatabase } from "../db/runtime.js";
import { createEscalation } from "./escalations.service.js";
import { getJob } from "./jobs.service.js";

export type PortalWorkflowType = "census_upload" | "benefits_builder" | "hybrid";
export type PortalTemplateStatus = "draft" | "testing" | "published" | "invalidated" | "superseded";

export type PortalTemplateInput = {
  id?: string;
  portalId: string;
  name: string;
  coverageType: string;
  coverageTypeCode?: string | null;
  workflowType: PortalWorkflowType;
  domSnapshotIds: string[];
  fieldMappings: Record<string, unknown>;
  censusMapping?: Record<string, unknown> | null;
  dialogRules: Array<Record<string, unknown>>;
  submitRules: Record<string, unknown>;
  quoteCaptureRules: Record<string, unknown>;
  requiredSections?: string[];
  testStatus?: "not_run" | "passed" | "failed";
  testReport?: Record<string, unknown> | null;
  parentTemplateId?: string | null;
};

export type CensusTemplateInput = {
  id?: string;
  portalId: string;
  portalTemplateId?: string | null;
  domSnapshotId?: string | null;
  filename?: string | null;
  fileHash: string;
  filePublicId?: string | null;
  fileUrl?: string | null;
  sheetName?: string | null;
  headers: string[];
  columnMapping?: Record<string, unknown> | null;
  validationRules?: Array<Record<string, unknown>> | null;
  status?: "observed" | "approved" | "changed_pending_review" | "superseded";
};

export type PortalDialogInput = {
  id?: string;
  portalId: string;
  portalTemplateId?: string | null;
  name: string;
  triggerStep?: string | null;
  detectionPattern: Record<string, unknown>;
  observedContent?: Record<string, unknown> | null;
  defaultAction?: "ESCALATE" | "ACKNOWLEDGE" | "RE_LOGIN" | "CUSTOM" | "CONFIRM_YES";
  approvedAction?: "ESCALATE" | "ACKNOWLEDGE" | "RE_LOGIN" | "CUSTOM" | "CONFIRM_YES" | null;
  preconditions?: Record<string, unknown> | null;
  irreversible?: boolean;
  status?: "observed" | "approved" | "superseded";
};

const memoryTemplates: Array<Record<string, unknown>> = [];
const memoryCensusTemplates: Array<Record<string, unknown>> = [];
const memoryDialogs: Array<Record<string, unknown>> = [];

function id(prefix: string) {
  return `${prefix}_${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`;
}

function sha(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function plain(row: unknown) {
  return row && typeof (row as { get?: unknown }).get === "function"
    ? (row as { get: (options?: { plain: boolean }) => Record<string, unknown> }).get({ plain: true })
    : row as Record<string, unknown>;
}

export async function listPortalTemplates(filters: { portalId?: string; coverageType?: string; status?: string } = {}) {
  if (shouldUseDatabase()) {
    const where = {
      ...(filters.portalId ? { portalId: filters.portalId } : {}),
      ...(filters.coverageType ? { coverageType: filters.coverageType } : {}),
      ...(filters.status ? { status: filters.status } : {})
    };
    return PortalTemplate.findAll({ where, order: [["updatedAt", "DESC"]], raw: true });
  }
  return memoryTemplates.filter((template) => {
    if (filters.portalId && template.portalId !== filters.portalId) return false;
    if (filters.coverageType && template.coverageType !== filters.coverageType) return false;
    if (filters.status && template.status !== filters.status) return false;
    return true;
  });
}

export async function getPortalTemplate(id: string) {
  if (shouldUseDatabase()) return PortalTemplate.findByPk(id, { raw: true });
  return memoryTemplates.find((template) => template.id === id) ?? null;
}

export async function savePortalTemplate(input: PortalTemplateInput, actor: string, status: PortalTemplateStatus = "draft") {
  const existing = input.id ? await getPortalTemplate(input.id) : null;
  const templateVersion = existing ? Number((existing as Record<string, unknown>).templateVersion ?? 1) : await nextTemplateVersion(input.portalId, input.coverageType);
  const record = {
    id: input.id ?? id("ptpl"),
    portalId: input.portalId,
    name: input.name,
    coverageType: input.coverageType,
    coverageTypeCode: input.coverageTypeCode ?? null,
    templateVersion,
    status,
    workflowType: input.workflowType,
    domSnapshotIds: input.domSnapshotIds,
    fieldMappings: input.fieldMappings,
    censusMapping: input.censusMapping ?? null,
    dialogRules: input.dialogRules ?? [],
    submitRules: input.submitRules,
    quoteCaptureRules: input.quoteCaptureRules,
    requiredSections: input.requiredSections ?? requiredSectionsFor(input),
    testStatus: input.testStatus ?? (status === "published" ? "passed" : "not_run"),
    testReport: input.testReport ?? null,
    parentTemplateId: input.parentTemplateId ?? null,
    approvedBy: status === "published" ? actor : null,
    approvedAt: status === "published" ? new Date() : null
  };

  if (shouldUseDatabase()) {
    const model = input.id ? await PortalTemplate.findByPk(input.id) : null;
    const row = model ? await model.update(record) : await PortalTemplate.create(record);
    return plain(row);
  }
  const index = memoryTemplates.findIndex((template) => template.id === record.id);
  if (index >= 0) memoryTemplates[index] = record;
  else memoryTemplates.unshift(record);
  return record;
}

async function nextTemplateVersion(portalId: string, coverageType: string) {
  if (shouldUseDatabase()) {
    const latest = await PortalTemplate.findOne({ where: { portalId, coverageType }, order: [["templateVersion", "DESC"]], raw: true });
    return Number((latest as Record<string, unknown> | null)?.templateVersion ?? 0) + 1;
  }
  const latest = memoryTemplates.filter((template) => template.portalId === portalId && template.coverageType === coverageType).sort((a, b) => Number(b.templateVersion) - Number(a.templateVersion))[0];
  return Number(latest?.templateVersion ?? 0) + 1;
}

function requiredSectionsFor(input: PortalTemplateInput) {
  return [
    "dom",
    "field_mappings",
    input.workflowType === "census_upload" || input.workflowType === "hybrid" ? "census_mapping" : null,
    "dialog_rules",
    "submit_rules",
    "quote_capture_rules"
  ].filter(Boolean) as string[];
}

export function validatePortalTemplate(input: PortalTemplateInput | Record<string, unknown>, publish = false) {
  const errors: string[] = [];
  const domSnapshotIds = Array.isArray(input.domSnapshotIds) ? input.domSnapshotIds : [];
  if (!domSnapshotIds.length) errors.push("At least one approved DOM snapshot must be linked.");
  if (!input.fieldMappings || typeof input.fieldMappings !== "object") errors.push("Field mappings are required.");
  if (!input.submitRules || typeof input.submitRules !== "object") errors.push("Submit rules are required.");
  if (!input.quoteCaptureRules || typeof input.quoteCaptureRules !== "object") errors.push("Quote/PDF capture rules are required.");
  const workflowType = String(input.workflowType ?? "hybrid");
  if ((workflowType === "census_upload" || workflowType === "hybrid") && (!input.censusMapping || typeof input.censusMapping !== "object")) {
    errors.push("Census mapping is required for census upload or hybrid templates.");
  }
  if (publish && String(input.testStatus ?? "not_run") !== "passed") errors.push("Template test run must pass before publish.");
  return { valid: errors.length === 0, errors };
}

export async function testPortalTemplate(input: PortalTemplateInput) {
  const validation = validatePortalTemplate({ ...input, testStatus: "passed" }, false);
  const snapshotCheck = await validateSnapshots(input.portalId, input.domSnapshotIds);
  return {
    status: validation.valid && snapshotCheck.valid ? "passed" : "failed",
    errors: [...validation.errors, ...snapshotCheck.errors],
    checkedAt: new Date().toISOString()
  };
}

async function validateSnapshots(portalId: string, domSnapshotIds: string[]) {
  const errors: string[] = [];
  if (!shouldUseDatabase()) return { valid: true, errors };
  const rows = await DomSnapshot.findAll({ where: { id: domSnapshotIds }, raw: true });
  for (const snapshotId of domSnapshotIds) {
    const row = rows.find((item) => String((item as unknown as Record<string, unknown>).id) === snapshotId) as unknown as Record<string, unknown> | undefined;
    if (!row) errors.push(`DOM snapshot ${snapshotId} was not found.`);
    else if (String(row.portalId) !== portalId) errors.push(`DOM snapshot ${snapshotId} belongs to another portal.`);
    else if (String(row.status) !== "approved") errors.push(`DOM snapshot ${snapshotId} must be approved.`);
  }
  return { valid: errors.length === 0, errors };
}

export async function publishPortalTemplate(idOrInput: string | PortalTemplateInput, actor: string) {
  const input = typeof idOrInput === "string" ? await getPortalTemplate(idOrInput) as Record<string, unknown> | null : idOrInput;
  if (!input) return null;
  const validation = validatePortalTemplate(input, true);
  const snapshotCheck = await validateSnapshots(String(input.portalId), Array.isArray(input.domSnapshotIds) ? input.domSnapshotIds as string[] : []);
  if (!validation.valid || !snapshotCheck.valid) {
    const error = new Error("Portal template is not publishable.");
    (error as Error & { issues?: string[] }).issues = [...validation.errors, ...snapshotCheck.errors];
    throw error;
  }
  if (shouldUseDatabase()) {
    await PortalTemplate.update({ status: "superseded" }, { where: { portalId: String(input.portalId), coverageType: String(input.coverageType), status: "published" } });
  }
  return savePortalTemplate(input as PortalTemplateInput, actor, "published");
}

export async function clonePortalTemplate(templateId: string, actor: string) {
  const source = await getPortalTemplate(templateId) as Record<string, unknown> | null;
  if (!source) return null;
  return savePortalTemplate({
    ...(source as unknown as PortalTemplateInput),
    id: undefined,
    name: `${source.name} copy`,
    parentTemplateId: String(source.id),
    testStatus: "not_run",
    testReport: null
  }, actor, "draft");
}

export async function getPublishedExecutionTemplate(input: { jobId: string; domSnapshotId?: string | null }) {
  const job = await getJob(input.jobId);
  if (!job || !job.portalId) return { blocked: true, reason: "Job not found." };
  const payload = job.payload as Record<string, unknown> | undefined;
  const effectiveCoverage = String(payload?.coverageType ?? payload?.coverageTypeCode ?? "");
  const templates = await listPortalTemplates({ portalId: job.portalId, status: "published" });
  const template = templates.find((item) => {
    const record = item as Record<string, unknown>;
    if (effectiveCoverage) return String(record.coverageType) === effectiveCoverage || String(record.coverageTypeCode ?? "") === effectiveCoverage;
    return true;
  }) as Record<string, unknown> | undefined;
  if (!template) return { blocked: true, reason: "Published portal template is required before portal submission." };
  const domSnapshotIds = Array.isArray(template.domSnapshotIds) ? template.domSnapshotIds.map(String) : [];
  if (input.domSnapshotId && !domSnapshotIds.includes(input.domSnapshotId)) {
    return { blocked: true, reason: "Published portal template is not linked to the approved DOM snapshot used by this job." };
  }
  const censusTemplate = await latestApprovedCensusTemplate(String(template.portalId), String(template.id));
  if (shouldUseDatabase()) {
    await PortalJob.update({
      portalTemplateId: String(template.id),
      censusTemplateId: censusTemplate ? String((censusTemplate as Record<string, unknown>).id) : null,
      mappingVersion: Number(template.templateVersion ?? 1)
    }, { where: { id: input.jobId } });
  }
  return {
    blocked: false,
    template,
    mapping: compatibilityMapping(template),
    censusTemplate,
    dialogRules: template.dialogRules,
    quoteCaptureRules: template.quoteCaptureRules,
    submitRules: template.submitRules
  };
}

function compatibilityMapping(template: Record<string, unknown>) {
  const fieldMappings = template.fieldMappings as Record<string, unknown>;
  return {
    id: template.id,
    portalId: template.portalId,
    coverageType: template.coverageType,
    domSnapshotId: Array.isArray(template.domSnapshotIds) ? template.domSnapshotIds[0] : null,
    mappingVersion: template.templateVersion,
    status: template.status,
    mappings: fieldMappings,
    requiredFields: Array.isArray((fieldMappings as { requiredFields?: unknown }).requiredFields) ? (fieldMappings as { requiredFields: unknown[] }).requiredFields : []
  };
}

async function latestApprovedCensusTemplate(portalId: string, portalTemplateId: string) {
  if (shouldUseDatabase()) {
    return CensusTemplate.findOne({ where: { portalId, portalTemplateId, status: "approved" }, order: [["version", "DESC"]], raw: true });
  }
  return memoryCensusTemplates.find((item) => item.portalId === portalId && item.portalTemplateId === portalTemplateId && item.status === "approved") ?? null;
}

export async function saveCensusTemplate(input: CensusTemplateInput, actor: string) {
  const version = input.id ? Number((await getCensusTemplate(input.id) as Record<string, unknown> | null)?.version ?? 1) : await nextCensusTemplateVersion(input.portalId, input.portalTemplateId ?? null);
  const record = {
    id: input.id ?? id("ctpl"),
    portalId: input.portalId,
    portalTemplateId: input.portalTemplateId ?? null,
    domSnapshotId: input.domSnapshotId ?? null,
    version,
    status: input.status ?? "observed",
    filename: input.filename ?? null,
    fileHash: input.fileHash,
    filePublicId: input.filePublicId ?? null,
    fileUrl: input.fileUrl ?? null,
    sheetName: input.sheetName ?? null,
    headers: input.headers,
    columnMapping: input.columnMapping ?? null,
    validationRules: input.validationRules ?? null,
    parentTemplateId: null,
    approvedBy: input.status === "approved" ? actor : null,
    approvedAt: input.status === "approved" ? new Date() : null
  };
  if (shouldUseDatabase()) {
    const existing = input.id ? await CensusTemplate.findByPk(input.id) : null;
    const row = existing ? await existing.update(record) : await CensusTemplate.create(record);
    return plain(row);
  }
  memoryCensusTemplates.unshift(record);
  return record;
}

async function getCensusTemplate(id: string) {
  if (shouldUseDatabase()) return CensusTemplate.findByPk(id, { raw: true });
  return memoryCensusTemplates.find((item) => item.id === id) ?? null;
}

export async function getCensusTemplateRecord(id: string) {
  return getCensusTemplate(id);
}

async function nextCensusTemplateVersion(portalId: string, portalTemplateId: string | null) {
  if (shouldUseDatabase()) {
    const latest = await CensusTemplate.findOne({ where: { portalId, ...(portalTemplateId ? { portalTemplateId } : {}) }, order: [["version", "DESC"]], raw: true });
    return Number((latest as Record<string, unknown> | null)?.version ?? 0) + 1;
  }
  return memoryCensusTemplates.filter((item) => item.portalId === portalId && (!portalTemplateId || item.portalTemplateId === portalTemplateId)).length + 1;
}

export async function checkCensusTemplateForJob(jobId: string, input: { fileHash: string; filename?: string | null; headers?: string[]; sheetName?: string | null }) {
  const execution = await getPublishedExecutionTemplate({ jobId });
  if (execution.blocked) return execution;
  const template = execution.template as Record<string, unknown>;
  if (!execution.censusTemplate) {
    const observed = await saveCensusTemplate({
      portalId: String(template.portalId),
      portalTemplateId: String(template.id),
      fileHash: input.fileHash,
      filename: input.filename,
      headers: input.headers ?? [],
      sheetName: input.sheetName,
      status: "observed"
    }, "agent-worker");
    await escalateJob(jobId, "census_template_changed", "Census template has not been approved for this portal template.", { observed });
    return { blocked: true, reason: "Census template approval is required.", observed };
  }
  const approved = execution.censusTemplate as Record<string, unknown>;
  if (String(approved.fileHash) !== input.fileHash) {
    const observed = await saveCensusTemplate({
      portalId: String(template.portalId),
      portalTemplateId: String(template.id),
      fileHash: input.fileHash,
      filename: input.filename,
      headers: input.headers ?? [],
      sheetName: input.sheetName,
      status: "changed_pending_review"
    }, "agent-worker");
    await escalateJob(jobId, "census_template_changed", "Portal census template hash changed and must be reviewed before upload.", { approvedHash: approved.fileHash, observedHash: input.fileHash, observed });
    return { blocked: true, reason: "Census template changed.", approved, observed };
  }
  return { blocked: false, censusTemplate: approved, columnMapping: approved.columnMapping, validationRules: approved.validationRules };
}

async function escalateJob(jobId: string, type: string, reason: string, metadata: Record<string, unknown>) {
  const job = await getJob(jobId);
  if (!job) return null;
  return createEscalation({
    jobId,
    submissionId: job.submissionId,
    type,
    portalId: job.portalId,
    metadata,
    reason,
    suggestedAction: "Review the portal template configuration, approve the changed artifact, then retry the job.",
    confidence: 0
  });
}

export async function savePortalDialog(input: PortalDialogInput, actor: string) {
  const record = {
    id: input.id ?? id("pdlg"),
    portalId: input.portalId,
    portalTemplateId: input.portalTemplateId ?? null,
    name: input.name,
    triggerStep: input.triggerStep ?? null,
    detectionPattern: input.detectionPattern,
    observedContent: input.observedContent ?? null,
    defaultAction: input.defaultAction ?? "ESCALATE",
    approvedAction: input.approvedAction ?? null,
    preconditions: input.preconditions ?? null,
    irreversible: input.irreversible ?? false,
    status: input.status ?? "observed",
    approvedBy: input.status === "approved" ? actor : null,
    approvedAt: input.status === "approved" ? new Date() : null
  };
  if (shouldUseDatabase()) {
    const existing = input.id ? await PortalDialog.findByPk(input.id) : null;
    const row = existing ? await existing.update(record) : await PortalDialog.create(record);
    return plain(row);
  }
  memoryDialogs.unshift(record);
  return record;
}

export async function listPortalDialogs(filters: { portalId?: string; portalTemplateId?: string; status?: string } = {}) {
  if (shouldUseDatabase()) {
    const where: Record<string, unknown> = {};
    if (filters.portalId) where.portalId = filters.portalId;
    if (filters.portalTemplateId) where.portalTemplateId = filters.portalTemplateId;
    if (filters.status) where.status = filters.status;
    const rows = await PortalDialog.findAll({ where, order: [["createdAt", "DESC"]] });
    return rows.map(plain);
  }
  return memoryDialogs.filter((dialog) => {
    if (filters.portalId && dialog.portalId !== filters.portalId) return false;
    if (filters.portalTemplateId && dialog.portalTemplateId !== filters.portalTemplateId) return false;
    if (filters.status && dialog.status !== filters.status) return false;
    return true;
  });
}

export async function handleDetectedDialog(jobId: string, input: { portalId?: string; portalTemplateId?: string; step?: string; text: string; buttons?: string[]; screenshotUrl?: string | null }) {
  const normalized = input.text.toLowerCase();
  const dialogs = shouldUseDatabase()
    ? await PortalDialog.findAll({ where: { portalId: input.portalId, status: "approved" }, raw: true })
    : memoryDialogs.filter((item) => item.portalId === input.portalId && item.status === "approved");
  const matched = dialogs.find((dialog) => {
    const pattern = (dialog as Record<string, unknown>).detectionPattern as Record<string, unknown>;
    const contains = Array.isArray(pattern?.contains) ? pattern.contains.map(String) : [];
    return contains.length && contains.every((item) => normalized.includes(item.toLowerCase()));
  }) as Record<string, unknown> | undefined;
  if (!matched) {
    await escalateJob(jobId, "unknown_dialog", "Unknown portal dialog detected. Agent stopped before taking any action.", input);
    return { blocked: true, reason: "Unknown dialog detected." };
  }
  const action = String(matched.approvedAction ?? matched.defaultAction ?? "ESCALATE");
  if (action === "ESCALATE") {
    await escalateJob(jobId, "dialog_blocked", `Portal dialog ${matched.name} requires human review.`, { dialog: matched, observed: input });
    return { blocked: true, reason: "Dialog rule requires escalation.", dialog: matched };
  }
  return { blocked: false, action, dialog: matched };
}

export function hashCensusHeaders(headers: string[]) {
  return sha(headers.join("|"));
}
