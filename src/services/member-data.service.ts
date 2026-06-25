import * as XLSX from "xlsx";
import { Customer, CustomerData, CustomerMember, DynamicFieldDefinition, ExcelMappingTemplate, InsurerWorkflow, MemberFieldValue, PortalFieldMapping } from "../db/models.js";
import { canFallbackFromDatabaseError, shouldUseDatabase } from "../db/runtime.js";
import { recordAudit } from "./audit.service.js";
import { getCustomerDataRecord, type CensusMember } from "./submission-data.service.js";

type StandardField =
  | "employeeName"
  | "firstName"
  | "lastName"
  | "dateOfBirth"
  | "age"
  | "gender"
  | "maritalStatus"
  | "nationality"
  | "emiratesLocation"
  | "salary"
  | "salaryBand"
  | "visaStatus"
  | "passportNumber"
  | "employeeNo"
  | "mobileNumber"
  | "email"
  | "relationship"
  | "category"
  | "memberType";

export type ExcelMapping = Record<string, StandardField | `custom:${string}` | "ignore">;

export type MemberRecord = {
  id: string;
  customerId: string;
  customerDataId?: string | null;
  employeeNo?: string | null;
  employeeName: string;
  relationship?: string | null;
  dateOfBirth?: string | null;
  age?: number | null;
  gender?: string | null;
  maritalStatus?: string | null;
  nationality?: string | null;
  emiratesLocation?: string | null;
  salary?: number | null;
  salaryBand?: string | null;
  visaStatus?: string | null;
  passportNumber?: string | null;
  mobileNumber?: string | null;
  email?: string | null;
  category?: string | null;
  memberType?: string | null;
  normalizedPayload: Record<string, unknown>;
  validationErrors: string[];
  importBatchId?: string | null;
  status: string;
  customFields?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
};

const standardAliases: Record<string, StandardField> = {
  name: "employeeName",
  fullname: "employeeName",
  employeename: "employeeName",
  membername: "employeeName",
  firstname: "firstName",
  lastname: "lastName",
  dob: "dateOfBirth",
  dateofbirth: "dateOfBirth",
  dateofbirthddmmyy: "dateOfBirth",
  age: "age",
  gender: "gender",
  maritalstatus: "maritalStatus",
  nationality: "nationality",
  emirates: "emiratesLocation",
  emirate: "emiratesLocation",
  location: "emiratesLocation",
  visaissuanceemirates: "emiratesLocation",
  salary: "salary",
  salaryband: "salaryBand",
  visastatus: "visaStatus",
  passportnumber: "passportNumber",
  passportno: "passportNumber",
  employeeid: "employeeNo",
  employeeno: "employeeNo",
  mobilenumber: "mobileNumber",
  mobile: "mobileNumber",
  phone: "mobileNumber",
  email: "email",
  relation: "relationship",
  relationship: "relationship",
  category: "category",
  membertype: "memberType"
};

const emirates = new Set(["abu dhabi", "dubai", "sharjah", "ajman", "umm al quwain", "ras al khaimah", "fujairah"]);
const memoryMembers: MemberRecord[] = [];
const memoryTemplates: Array<{ id: string; name: string; coverageType: string; portalId?: string | null; mappings: ExcelMapping }> = [];
const memoryPortalMappings: Array<{ id: string; portalId: string; coverageType: string; status: string; mappingVersion: number; mappings: Record<string, unknown>; requiredFields: string[]; aiSuggested?: boolean; aiModel?: string | null; escalationId?: string | null; parentMappingId?: string | null }> = [];
const memoryWorkflows: Array<{ id: string; portalId: string; coverageType: string; workflowMode: "individual_entry" | "bulk_upload" }> = [];

function id(prefix: string) {
  return `${prefix}_${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`;
}

function key(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function parseDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const raw = text(value);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parts = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!parts) return raw;
  const year = parts[3].length === 2 ? `20${parts[3]}` : parts[3];
  return `${year}-${parts[2].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
}

function ageFromDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const dob = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age >= 0 ? age : null;
}

function normalizeGender(value: unknown) {
  const raw = text(value).toLowerCase();
  if (["m", "male"].includes(raw)) return "Male";
  if (["f", "female"].includes(raw)) return "Female";
  return text(value);
}

function normalizeMaritalStatus(value: unknown) {
  const raw = text(value).toLowerCase();
  if (["m", "married"].includes(raw)) return "Married";
  if (["s", "single"].includes(raw)) return "Single";
  return text(value);
}

function salaryBand(value: number | null) {
  if (value === null) return null;
  if (value < 4000) return "Below 4,000";
  if (value < 12_000) return "4,000-11,999";
  return "12,000+";
}

function inferMapping(headers: string[]): ExcelMapping {
  return Object.fromEntries(headers.map((header) => {
    const mapped = standardAliases[key(header)];
    return [header, mapped ?? `custom:${key(header) || "field"}`];
  }));
}

function normalizeMember(row: Record<string, unknown>, mapping: ExcelMapping, coverageType: string) {
  const payload: Record<string, unknown> = {};
  const custom: Record<string, string> = {};
  for (const [header, target] of Object.entries(mapping)) {
    if (target === "ignore") continue;
    const value = row[header];
    if (target.startsWith("custom:")) custom[target.slice(7)] = text(value);
    else payload[target] = value;
  }
  const dateOfBirth = parseDate(payload.dateOfBirth);
  const salaryValue = text(payload.salary) ? Number(String(payload.salary).replace(/,/g, "")) : null;
  const normalized = {
    employeeNo: text(payload.employeeNo) || null,
    employeeName: text(payload.employeeName || `${text(payload.firstName)} ${text(payload.lastName)}`.trim()),
    firstName: text(payload.firstName) || null,
    lastName: text(payload.lastName) || null,
    relationship: text(payload.relationship) || null,
    dateOfBirth: dateOfBirth || null,
    age: text(payload.age) ? Number(payload.age) : ageFromDate(dateOfBirth),
    gender: normalizeGender(payload.gender) || null,
    maritalStatus: normalizeMaritalStatus(payload.maritalStatus) || null,
    nationality: text(payload.nationality) || null,
    emiratesLocation: text(payload.emiratesLocation) || null,
    salary: Number.isFinite(salaryValue) ? salaryValue : null,
    salaryBand: text(payload.salaryBand) || salaryBand(Number.isFinite(salaryValue) ? salaryValue : null),
    visaStatus: text(payload.visaStatus) || null,
    passportNumber: text(payload.passportNumber) || null,
    mobileNumber: text(payload.mobileNumber) || null,
    email: text(payload.email) || null,
    category: text(payload.category) || null,
    memberType: text(payload.memberType) || null,
    coverageType,
    customFields: custom
  };
  return { normalized, validationErrors: validateMember(normalized) };
}

function validateMember(member: Record<string, unknown>) {
  const errors: string[] = [];
  if (!text(member.employeeName)) errors.push("Employee/member name is required.");
  if (member.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(String(member.dateOfBirth))) errors.push("Date of birth must normalize to YYYY-MM-DD.");
  if (member.gender && !["Male", "Female"].includes(String(member.gender))) errors.push("Gender must be Male or Female.");
  if (member.emiratesLocation && !emirates.has(String(member.emiratesLocation).toLowerCase())) errors.push("Emirates/location is not in supported UAE emirates master data.");
  if (member.salary !== null && Number.isNaN(Number(member.salary))) errors.push("Salary must be numeric.");
  return errors;
}

function fromMemberModel(row: Record<string, unknown>, customFields: Record<string, string> = {}): MemberRecord {
  return {
    id: String(row.id),
    customerId: String(row.customerId),
    customerDataId: row.customerDataId ? String(row.customerDataId) : null,
    employeeNo: row.employeeNo ? String(row.employeeNo) : null,
    employeeName: String(row.employeeName),
    relationship: row.relationship ? String(row.relationship) : null,
    dateOfBirth: row.dateOfBirth ? String(row.dateOfBirth) : null,
    age: row.age === null || row.age === undefined ? null : Number(row.age),
    gender: row.gender ? String(row.gender) : null,
    maritalStatus: row.maritalStatus ? String(row.maritalStatus) : null,
    nationality: row.nationality ? String(row.nationality) : null,
    emiratesLocation: row.emiratesLocation ? String(row.emiratesLocation) : null,
    salary: row.salary === null || row.salary === undefined ? null : Number(row.salary),
    salaryBand: row.salaryBand ? String(row.salaryBand) : null,
    visaStatus: row.visaStatus ? String(row.visaStatus) : null,
    passportNumber: row.passportNumber ? String(row.passportNumber) : null,
    mobileNumber: row.mobileNumber ? String(row.mobileNumber) : null,
    email: row.email ? String(row.email) : null,
    category: row.category ? String(row.category) : null,
    memberType: row.memberType ? String(row.memberType) : null,
    normalizedPayload: row.normalizedPayload as Record<string, unknown>,
    validationErrors: row.validationErrors as string[],
    importBatchId: row.importBatchId ? String(row.importBatchId) : null,
    status: String(row.status),
    customFields,
    createdAt: row.createdAt ? new Date(row.createdAt as string | Date).toISOString() : undefined,
    updatedAt: row.updatedAt ? new Date(row.updatedAt as string | Date).toISOString() : undefined
  };
}

export function previewMemberExcel(input: { filename: string; contentBase64: string; coverageType: string; mapping?: ExcelMapping }) {
  const workbook = XLSX.read(Buffer.from(input.contentBase64, "base64"), { type: "buffer", cellDates: true });
  const sheetNames = workbook.SheetNames;
  const firstSheet = sheetNames[0];
  const rows = firstSheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet], { defval: "" }) : [];
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const mapping = input.mapping ?? inferMapping(headers);
  const previewRows = rows.slice(0, 10).map((row, index) => ({ index: index + 1, raw: row, ...normalizeMember(row, mapping, input.coverageType) }));
  const unknownColumns = Object.entries(mapping).filter(([, target]) => String(target).startsWith("custom:")).map(([header]) => header);
  return {
    filename: input.filename,
    sheetNames,
    selectedSheet: firstSheet ?? null,
    headers,
    rowCount: rows.length,
    sampleRows: rows.slice(0, 5),
    suggestedMapping: mapping,
    unknownColumns,
    previewRows,
    validationErrors: previewRows.flatMap((row) => row.validationErrors.map((error) => `Row ${row.index}: ${error}`))
  };
}

async function ensureDynamicField(fieldName: string, label: string, coverageType: string) {
  if (shouldUseDatabase()) {
    const existing = await DynamicFieldDefinition.findOne({ where: { fieldName } });
    if (existing) return existing.get("id") as string;
    const row = await DynamicFieldDefinition.create({ id: id("fld"), fieldName, fieldLabel: label, dataType: "text", required: false, coverageType });
    return row.get("id") as string;
  }
  return `fld_${fieldName}`;
}

export async function confirmMemberExcelImport(input: { customerDataId: string; filename: string; contentBase64: string; coverageType: string; mapping: ExcelMapping; templateName?: string }, actor: string) {
  const customerData = await getCustomerDataRecord(input.customerDataId);
  if (!customerData) return null;
  const workbook = XLSX.read(Buffer.from(input.contentBase64, "base64"), { type: "buffer", cellDates: true });
  const firstSheet = workbook.SheetNames[0];
  const rows = firstSheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet], { defval: "" }) : [];
  const importBatchId = id("imp");
  const saved: MemberRecord[] = [];

  for (const row of rows) {
    const { normalized, validationErrors } = normalizeMember(row, input.mapping, input.coverageType);
    if (!normalized.employeeName) continue;
    const record = {
      id: id("mem"),
      customerId: customerData.customerId,
      customerDataId: customerData.id,
      ...normalized,
      normalizedPayload: normalized,
      validationErrors,
      importBatchId,
      status: validationErrors.length ? "needs_review" : "ready"
    };
    if (shouldUseDatabase()) {
      const created = await CustomerMember.create(record);
      for (const [fieldName, value] of Object.entries(normalized.customFields)) {
        const fieldId = await ensureDynamicField(fieldName, fieldName, input.coverageType);
        await MemberFieldValue.create({ id: id("mfv"), memberId: record.id, fieldId, value });
      }
      saved.push(fromMemberModel(created.get({ plain: true }) as unknown as Record<string, unknown>, normalized.customFields));
    } else {
      saved.push({ ...record, customFields: normalized.customFields, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      memoryMembers.unshift(saved[saved.length - 1]);
    }
  }
  recordAudit({ actor, action: "member_excel_imported", target: input.customerDataId, status: saved.some((row) => row.validationErrors.length) ? "escalated" : "success" });
  return { importBatchId, savedCount: saved.length, failedCount: rows.length - saved.length, members: saved };
}

export async function listCustomerMembers(customerDataId: string) {
  const customerData = await getCustomerDataRecord(customerDataId);
  if (!customerData) return null;
  if (shouldUseDatabase()) {
    const rows = await CustomerMember.findAll({ where: { customerDataId }, order: [["createdAt", "DESC"]], raw: true });
    return rows.map((row) => fromMemberModel(row as unknown as Record<string, unknown>));
  }
  return memoryMembers.filter((member) => member.customerDataId === customerDataId);
}

export async function getMemberData(memberId: string) {
  if (shouldUseDatabase()) {
    const row = await CustomerMember.findByPk(memberId, { raw: true });
    if (!row) return null;
    const values = await MemberFieldValue.findAll({ where: { memberId }, raw: true });
    const fieldIds = values.map((value) => String((value as unknown as Record<string, unknown>).fieldId));
    const fields = fieldIds.length ? await DynamicFieldDefinition.findAll({ where: { id: fieldIds }, raw: true }) : [];
    const labels = new Map(fields.map((field) => [String((field as unknown as Record<string, unknown>).id), String((field as unknown as Record<string, unknown>).fieldName)]));
    const customFields = Object.fromEntries(values.map((value) => {
      const plain = value as unknown as Record<string, unknown>;
      return [labels.get(String(plain.fieldId)) ?? String(plain.fieldId), String(plain.value ?? "")];
    }));
    return fromMemberModel(row as unknown as Record<string, unknown>, customFields);
  }
  return memoryMembers.find((member) => member.id === memberId) ?? null;
}

export async function saveExcelMappingTemplate(input: { id?: string; name: string; coverageType: string; portalId?: string | null; mappings: ExcelMapping }, actor: string) {
  const record = { id: input.id ?? id("xmap"), name: input.name, coverageType: input.coverageType, portalId: input.portalId ?? null, mappings: input.mappings, createdBy: actor };
  if (shouldUseDatabase()) {
    const existing = input.id ? await ExcelMappingTemplate.findByPk(input.id) : null;
    const row = existing ? await existing.update(record) : await ExcelMappingTemplate.create(record);
    return row.get({ plain: true });
  }
  memoryTemplates.unshift(record);
  return record;
}

export async function listExcelMappingTemplates(coverageType?: string) {
  if (shouldUseDatabase()) {
    const rows = await ExcelMappingTemplate.findAll({ where: coverageType ? { coverageType } : {}, order: [["updatedAt", "DESC"]], raw: true });
    return rows;
  }
  return coverageType ? memoryTemplates.filter((template) => template.coverageType === coverageType) : memoryTemplates;
}

export async function savePortalFieldMapping(input: { id?: string; portalId: string; coverageType: string; domSnapshotId?: string | null; mappings: Record<string, unknown>; requiredFields: string[]; status?: "draft" | "published"; mappingVersion?: number; aiSuggested?: boolean; aiModel?: string | null; escalationId?: string | null; parentMappingId?: string | null }, actor: string) {
  const mappingVersion = input.mappingVersion ?? await nextPortalMappingVersion(input.portalId, input.coverageType, input.domSnapshotId ?? null);
  const record = {
    id: input.id ?? id("pfm"),
    portalId: input.portalId,
    coverageType: input.coverageType,
    domSnapshotId: input.domSnapshotId ?? null,
    mappings: input.mappings,
    requiredFields: input.requiredFields,
    status: input.status ?? "draft",
    mappingVersion,
    aiSuggested: input.aiSuggested ?? false,
    aiModel: input.aiModel ?? null,
    escalationId: input.escalationId ?? null,
    parentMappingId: input.parentMappingId ?? null,
    approvedBy: input.status === "published" ? actor : null,
    approvedAt: input.status === "published" ? new Date() : null
  };
  if (shouldUseDatabase()) {
    const existing = input.id ? await PortalFieldMapping.findByPk(input.id) : null;
    const row = existing ? await existing.update(record) : await PortalFieldMapping.create(record);
    return row.get({ plain: true });
  }
  memoryPortalMappings.unshift(record as typeof memoryPortalMappings[number]);
  return record;
}

export async function getPublishedPortalMapping(portalId: string, coverageType: string) {
  if (shouldUseDatabase()) {
    return PortalFieldMapping.findOne({ where: { portalId, coverageType, status: "published" }, order: [["mappingVersion", "DESC"]], raw: true });
  }
  return memoryPortalMappings.find((mapping) => mapping.portalId === portalId && mapping.coverageType === coverageType && mapping.status === "published") ?? null;
}

async function nextPortalMappingVersion(portalId: string, coverageType: string, domSnapshotId?: string | null) {
  if (shouldUseDatabase()) {
    const latest = await PortalFieldMapping.findOne({
      where: { portalId, coverageType, ...(domSnapshotId ? { domSnapshotId } : {}) },
      order: [["mappingVersion", "DESC"]],
      raw: true
    });
    return Number((latest as Record<string, unknown> | null)?.mappingVersion ?? 0) + 1;
  }
  const latest = memoryPortalMappings
    .filter((mapping) => mapping.portalId === portalId && mapping.coverageType === coverageType)
    .sort((left, right) => right.mappingVersion - left.mappingVersion)[0];
  return (latest?.mappingVersion ?? 0) + 1;
}

export async function getPublishedExecutionMapping(input: { portalId: string; coverageType: string; domSnapshotId: string }) {
  if (shouldUseDatabase()) {
    return PortalFieldMapping.findOne({
      where: {
        portalId: input.portalId,
        coverageType: input.coverageType,
        domSnapshotId: input.domSnapshotId,
        status: "published"
      },
      order: [["mappingVersion", "DESC"]],
      raw: true
    });
  }
  return memoryPortalMappings
    .filter((mapping) => mapping.portalId === input.portalId && mapping.coverageType === input.coverageType && mapping.status === "published")
    .sort((left, right) => right.mappingVersion - left.mappingVersion)[0] ?? null;
}

export function validatePortalMappingPayload(input: { mappings: Record<string, unknown>; requiredFields: string[] }) {
  const fields = Array.isArray(input.mappings.fields) ? input.mappings.fields as Array<Record<string, unknown>> : [];
  const submit = input.mappings.submit as Record<string, unknown> | undefined;
  const errors: string[] = [];
  if (!fields.length) errors.push("At least one mapped field is required.");
  for (const requiredField of input.requiredFields) {
    const field = fields.find((item) => String(item.target) === requiredField);
    if (!field) {
      errors.push(`Required field ${requiredField} is not mapped.`);
      continue;
    }
    const selectors = Array.isArray(field.selectors) ? field.selectors : [];
    if (!selectors.length) errors.push(`Required field ${requiredField} has no approved selector.`);
  }
  if (!submit || !Array.isArray(submit.selectors) || !submit.selectors.length) {
    errors.push("Submit/generate quote button mapping is required.");
  }
  return { valid: errors.length === 0, errors };
}

export async function saveInsurerWorkflow(input: { id?: string; portalId: string; coverageType: string; workflowMode: "individual_entry" | "bulk_upload"; uploadMethod?: string | null; quoteDownloadMethod?: string | null; templateConfig?: Record<string, unknown> | null; isActive?: boolean }) {
  const record = { id: input.id ?? id("wf"), portalId: input.portalId, coverageType: input.coverageType, workflowMode: input.workflowMode, uploadMethod: input.uploadMethod ?? null, quoteDownloadMethod: input.quoteDownloadMethod ?? null, templateConfig: input.templateConfig ?? null, isActive: input.isActive ?? true };
  if (shouldUseDatabase()) {
    const existing = input.id ? await InsurerWorkflow.findByPk(input.id) : null;
    const row = existing ? await existing.update(record) : await InsurerWorkflow.create(record);
    return row.get({ plain: true });
  }
  memoryWorkflows.unshift(record);
  return record;
}

export async function getInsurerWorkflow(portalId: string, coverageType: string) {
  if (shouldUseDatabase()) {
    return InsurerWorkflow.findOne({ where: { portalId, coverageType, isActive: true }, raw: true });
  }
  return memoryWorkflows.find((workflow) => workflow.portalId === portalId && workflow.coverageType === coverageType) ?? { workflowMode: "individual_entry" };
}

export function memberToCensus(member: MemberRecord): CensusMember {
  return {
    employeeNo: member.employeeNo ?? undefined,
    employeeName: member.employeeName,
    relationship: member.relationship ?? undefined,
    dateOfBirth: member.dateOfBirth ?? undefined,
    gender: member.gender ?? undefined,
    maritalStatus: member.maritalStatus ?? undefined,
    nationality: member.nationality ?? undefined,
    visaIssuanceEmirate: member.emiratesLocation ?? undefined,
    category: member.category ?? undefined,
    memberType: member.memberType ?? undefined
  };
}
