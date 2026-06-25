import { createHash, randomBytes } from "node:crypto";
import * as XLSX from "xlsx";
import { submissions } from "../data/demo-data.js";
import { Customer, CustomerData, CustomerIntakeLink, CustomerMember, IntakeFormTemplate, MemberFieldValue, PortalJob, PublicIntakeLink, Quote, Submission, SubmissionData } from "../db/models.js";
import { canFallbackFromDatabaseError, shouldUseDatabase } from "../db/runtime.js";
import { recordAudit } from "./audit.service.js";
import { listCoverageTypes } from "./master-data.service.js";

export type SubmissionDataSource = "broker_entry" | "excel_upload" | "public_form";

export type CensusMember = {
  serialNo?: string;
  employeeNo?: string;
  employeeName?: string;
  relationship?: string;
  dateOfBirth?: string;
  age?: number | string;
  gender?: string;
  maritalStatus?: string;
  nationality?: string;
  visaIssuanceEmirate?: string;
  emiratesLocation?: string;
  salary?: number | string;
  salaryBand?: string;
  visaStatus?: string;
  passportNumber?: string;
  mobileNumber?: string;
  email?: string;
  category?: string;
  memberType?: string;
};

export type SubmissionDataInput = Omit<NormalizedSubmissionData, "validationErrors"> & {
  validationErrors?: string[];
};

export type NormalizedSubmissionData = {
  id?: string;
  submissionId: string;
  source: SubmissionDataSource;
  sourceFilename?: string | null;
  companyDetails: Record<string, unknown>;
  contactDetails: Record<string, unknown>;
  policyDetails: Record<string, unknown>;
  censusMembers: CensusMember[];
  validationErrors: string[];
  lockedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type CustomerDataRow = {
  id: string;
  customerId: string;
  customer: string;
  email?: string | null;
  phone?: string | null;
  coverageType: string;
  source: SubmissionDataSource;
  sourceFilename?: string | null;
  companyDetails: Record<string, unknown>;
  contactDetails: Record<string, unknown>;
  policyDetails: Record<string, unknown>;
  censusMembers: CensusMember[];
  validationErrors: string[];
  verificationStatus?: "pending_review" | "needs_review" | "verified" | "rejected";
  verificationNotes?: string | null;
  assignedTo?: string | null;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  lockedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type SpreadsheetImportInput = {
  submissionId?: string;
  filename: string;
  contentBase64: string;
};

type CustomerSpreadsheetImportInput = SpreadsheetImportInput & {
  importMode?: "company_with_members" | "individual_customers";
  companyName?: string;
  customerName?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  coverageType?: string;
};

export type IntakeFormField = {
  id: string;
  label: string;
  type: "text" | "email" | "phone" | "date" | "number" | "textarea" | "select" | "file" | "member_table";
  required?: boolean;
  target?: "company.companyName" | "contact.fullName" | "contact.email" | "contact.phone" | "policy.coverageType" | "policy.policyStartDate" | "policy.policyEndDate" | "censusMembers" | "documents" | string;
  options?: string[];
};

export type MemberColumnDefinition = {
  id: string;
  label: string;
  target: string;
  type: "text" | "date" | "number" | "select";
  required?: boolean;
  locked?: boolean;
};

export type IntakeFormTemplateRecord = {
  id: string;
  name: string;
  description?: string | null;
  coverageType?: string | null;
  coverageTypeCode?: string | null;
  formType: "company" | "individual_customer";
  templateType?: "company" | "individual_customer";
  fields: IntakeFormField[];
  memberColumns?: MemberColumnDefinition[];
  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
};

const memorySubmissionData: NormalizedSubmissionData[] = [];
const memoryCustomerData: CustomerDataRow[] = [];
const memoryIntakeLinks: Array<{
  id: string;
  submissionId: string;
  tokenHash: string;
  token: string;
  expiresAt: string;
  revokedAt?: string | null;
  usedAt?: string | null;
  createdBy: string;
  createdAt: string;
}> = [];
const memoryCustomerIntakeLinks: Array<{
  id: string;
  formTemplateId?: string | null;
  tokenHash: string;
  token: string;
  expiresAt: string;
  revokedAt?: string | null;
  usedAt?: string | null;
  createdBy: string;
  createdAt: string;
}> = [];
const memoryFormTemplates: IntakeFormTemplateRecord[] = [];

const requiredMemberColumns = ["employeeName"];

export const medicalMemberColumns: MemberColumnDefinition[] = [
  { id: "employeeName", label: "EmployeeName", target: "employeeName", type: "text", required: true, locked: true },
  { id: "dateOfBirth", label: "DateOfBirth", target: "dateOfBirth", type: "date", required: true, locked: true },
  { id: "relationship", label: "Relation", target: "relationship", type: "select", required: true, locked: true },
  { id: "category", label: "CategoryName", target: "category", type: "select", required: true, locked: true },
  { id: "gender", label: "Gender", target: "gender", type: "select", required: true, locked: true },
  { id: "maritalStatus", label: "MaritalStatus", target: "maritalStatus", type: "select", required: false, locked: true },
  { id: "nationality", label: "Nationality", target: "nationality", type: "text", required: true, locked: true },
  { id: "emiratesLocation", label: "Location", target: "emiratesLocation", type: "text", required: true, locked: true },
  { id: "salaryBand", label: "SalaryBand", target: "salaryBand", type: "select", required: false, locked: true },
  { id: "age", label: "Age", target: "age", type: "number", required: false, locked: true }
];

function id(prefix: string) {
  return `${prefix}_${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function parseDateValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parts = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (parts) {
      const year = parts[3].length === 2 ? `20${parts[3]}` : parts[3];
      return `${year}-${parts[2].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
    }
    return trimmed;
  }
  return undefined;
}

function normalizeKey(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const columnMap: Record<string, keyof CensusMember> = {
  sno: "serialNo",
  serialno: "serialNo",
  employeeno: "employeeNo",
  employeeid: "employeeNo",
  employeename: "employeeName",
  membername: "employeeName",
  relationship: "relationship",
  relation: "relationship",
  dateofbirthddmmyy: "dateOfBirth",
  dateofbirth: "dateOfBirth",
  dob: "dateOfBirth",
  age: "age",
  gender: "gender",
  maritalstatus: "maritalStatus",
  nationality: "nationality",
  emirates: "emiratesLocation",
  emirate: "emiratesLocation",
  location: "emiratesLocation",
  visaissuanceemirates: "visaIssuanceEmirate",
  visaissuanceemirate: "visaIssuanceEmirate",
  visacity: "visaIssuanceEmirate",
  salary: "salary",
  salaryband: "salaryBand",
  visastatus: "visaStatus",
  passportnumber: "passportNumber",
  passportno: "passportNumber",
  mobilenumber: "mobileNumber",
  mobile: "mobileNumber",
  phone: "mobileNumber",
  email: "email",
  category: "category",
  categoryname: "category",
  membertype: "memberType"
};

function compactObject(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function validateData(data: NormalizedSubmissionData) {
  const errors: string[] = [];
  if (!String(data.companyDetails.companyName ?? data.contactDetails.fullName ?? "").trim()) {
    errors.push("Company name or customer name is required.");
  }
  data.censusMembers.forEach((member, index) => {
    for (const column of requiredMemberColumns) {
      if (!String(member[column as keyof CensusMember] ?? "").trim()) {
        errors.push(`Row ${index + 1}: employee name is required.`);
      }
    }
  });
  return errors;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function safeObject(value: unknown): Record<string, unknown> {
  const parsed = parseJsonValue(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function safeArray<T>(value: unknown): T[] {
  const parsed = parseJsonValue(value);
  return Array.isArray(parsed) ? parsed as T[] : [];
}

function safeIso(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = new Date(value as string | Date);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function safeSource(value: unknown): SubmissionDataSource {
  return value === "excel_upload" || value === "public_form" || value === "broker_entry" ? value : "broker_entry";
}

function fromModel(row: Record<string, unknown>): NormalizedSubmissionData {
  const lockedAt = safeIso(row.lockedAt);
  return {
    id: String(row.id),
    submissionId: String(row.submissionId),
    source: safeSource(row.source),
    sourceFilename: row.sourceFilename ? String(row.sourceFilename) : null,
    companyDetails: safeObject(row.companyDetails),
    contactDetails: safeObject(row.contactDetails),
    policyDetails: safeObject(row.policyDetails),
    censusMembers: safeArray<CensusMember>(row.censusMembers),
    validationErrors: safeArray<string>(row.validationErrors),
    lockedAt: lockedAt ?? null,
    createdAt: safeIso(row.createdAt),
    updatedAt: safeIso(row.updatedAt)
  };
}

function fromCustomerModel(customerRow: Record<string, unknown>, dataRow: Record<string, unknown>): CustomerDataRow {
  const companyDetails = safeObject(dataRow.companyDetails);
  const contactDetails = safeObject(dataRow.contactDetails);
  const policyDetails = safeObject(dataRow.policyDetails);
  const validationErrors = safeArray<string>(dataRow.validationErrors);
  return {
    id: String(dataRow.id),
    customerId: String(customerRow.id),
    customer: String(companyDetails.companyName ?? customerRow.fullName),
    email: customerRow.email ? String(customerRow.email) : text(contactDetails.email) || null,
    phone: customerRow.phone ? String(customerRow.phone) : text(contactDetails.phone) || null,
    coverageType: text(policyDetails.coverageType) || "Customer data",
    source: safeSource(dataRow.source),
    sourceFilename: dataRow.sourceFilename ? String(dataRow.sourceFilename) : null,
    companyDetails,
    contactDetails,
    policyDetails,
    censusMembers: safeArray<CensusMember>(dataRow.censusMembers),
    validationErrors,
    verificationStatus: String(dataRow.verificationStatus ?? (validationErrors.length ? "needs_review" : "pending_review")) as CustomerDataRow["verificationStatus"],
    verificationNotes: dataRow.verificationNotes ? String(dataRow.verificationNotes) : null,
    assignedTo: dataRow.assignedTo ? String(dataRow.assignedTo) : null,
    verifiedBy: dataRow.verifiedBy ? String(dataRow.verifiedBy) : null,
    verifiedAt: safeIso(dataRow.verifiedAt) ?? null,
    lockedAt: safeIso(dataRow.lockedAt) ?? null,
    createdAt: safeIso(dataRow.createdAt),
    updatedAt: safeIso(dataRow.updatedAt)
  };
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

const defaultIntakeFields: IntakeFormField[] = [
  { id: "companyName", label: "Company name", type: "text", required: false, target: "company.companyName" },
  { id: "fullName", label: "Individual customer name", type: "text", required: false, target: "contact.fullName" },
  { id: "email", label: "Email", type: "email", required: true, target: "contact.email" },
  { id: "phone", label: "Phone", type: "phone", required: false, target: "contact.phone" },
  { id: "coverageType", label: "Coverage type", type: "select", required: true, target: "policy.coverageType", options: ["Motor Fleet", "Commercial Property", "Medical", "Personal Auto"] },
  { id: "policyStartDate", label: "Policy start", type: "date", required: false, target: "policy.policyStartDate" },
  { id: "policyEndDate", label: "Policy end", type: "date", required: false, target: "policy.policyEndDate" }
];

function fromTemplateModel(row: Record<string, unknown>): IntakeFormTemplateRecord {
  const formType = row.formType === "individual_customer" || row.templateType === "individual_customer" ? "individual_customer" : "company";
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    coverageType: row.coverageType ? String(row.coverageType) : null,
    coverageTypeCode: row.coverageTypeCode ? String(row.coverageTypeCode) : null,
    formType,
    templateType: formType,
    fields: row.fields as IntakeFormField[],
    memberColumns: Array.isArray(row.memberColumns) ? row.memberColumns as MemberColumnDefinition[] : undefined,
    isDefault: Boolean(row.isDefault),
    createdAt: row.createdAt ? new Date(row.createdAt as string | Date).toISOString() : undefined,
    updatedAt: row.updatedAt ? new Date(row.updatedAt as string | Date).toISOString() : undefined
  };
}

async function defaultTemplate(formType: "company" | "individual_customer" = "company"): Promise<IntakeFormTemplateRecord> {
  const coverageTypes = await listCoverageTypes();
  const baseFields = formType === "company"
    ? defaultIntakeFields.filter((field) => field.target !== "contact.fullName")
    : defaultIntakeFields.filter((field) => field.target !== "company.companyName" && field.target !== "censusMembers");
  return {
    id: formType === "company" ? "default_company" : "default_customer",
    name: formType === "company" ? "Company details" : "Customer details",
    description: "Complete the requested details so your broker can prepare the right insurance submission.",
    coverageType: null,
    coverageTypeCode: null,
    formType,
    templateType: formType,
    fields: baseFields.map((field) => field.target === "policy.coverageType" ? { ...field, options: coverageTypes.map((item) => item.name) } : field),
    memberColumns: formType === "company" ? [] : undefined,
    isDefault: true
  };
}

async function defaultMedicalTemplate(formType: "company" | "individual_customer"): Promise<IntakeFormTemplateRecord> {
  const coverageTypes = await listCoverageTypes();
  const coverageNames = coverageTypes.map((item) => item.name);
  const fields = formType === "company"
    ? [
      { id: "companyName", label: "Company name", type: "text", required: true, target: "company.companyName" },
      { id: "contactName", label: "Contact person", type: "text", required: true, target: "contact.fullName" },
      { id: "email", label: "Email", type: "email", required: true, target: "contact.email" },
      { id: "phone", label: "Phone", type: "phone", required: true, target: "contact.phone" },
      { id: "coverageType", label: "Coverage type", type: "select", required: true, target: "policy.coverageType", options: coverageNames },
      { id: "policyStartDate", label: "Policy start", type: "date", required: false, target: "policy.policyStartDate" },
      { id: "policyEndDate", label: "Policy end", type: "date", required: false, target: "policy.policyEndDate" },
      { id: "members", label: "Medical member census", type: "member_table", required: false, target: "censusMembers" }
    ] as IntakeFormField[]
    : [
      { id: "fullName", label: "Customer name", type: "text", required: true, target: "contact.fullName" },
      { id: "email", label: "Email", type: "email", required: true, target: "contact.email" },
      { id: "phone", label: "Phone", type: "phone", required: true, target: "contact.phone" },
      { id: "coverageType", label: "Coverage type", type: "select", required: true, target: "policy.coverageType", options: coverageNames },
      { id: "policyStartDate", label: "Policy start", type: "date", required: false, target: "policy.policyStartDate" },
      { id: "policyEndDate", label: "Policy end", type: "date", required: false, target: "policy.policyEndDate" }
    ] as IntakeFormField[];
  return {
    id: formType === "company" ? "medical_company" : "medical_customer",
    name: formType === "company" ? "Medical company" : "Medical individual customer",
    description: formType === "company" ? "Collect company contact, policy, and medical census details." : "Collect one customer's medical policy details.",
    coverageType: "Medical",
    coverageTypeCode: "medical",
    formType,
    templateType: formType,
    fields,
    memberColumns: formType === "company" ? medicalMemberColumns : [],
    isDefault: false
  };
}

function setNestedValue(target: string | undefined, value: unknown, output: { recordType?: string; companyDetails: Record<string, unknown>; contactDetails: Record<string, unknown>; policyDetails: Record<string, unknown>; censusMembers: CensusMember[]; documents: unknown[] }) {
  if (!target) return;
  if (target === "record.type") {
    output.recordType = text(value);
    return;
  }
  if (target === "censusMembers") {
    output.censusMembers = Array.isArray(value) ? value as CensusMember[] : [];
    return;
  }
  if (target === "documents") {
    output.documents = Array.isArray(value) ? value : value ? [value] : [];
    return;
  }
  const [group, key] = target.split(".");
  if (!key) return;
  if (group === "company") output.companyDetails[key] = value;
  if (group === "contact") output.contactDetails[key] = value;
  if (group === "policy") output.policyDetails[key] = value;
}

function normalizeDynamicIntake(fields: IntakeFormField[], values: Record<string, unknown>): Omit<NormalizedSubmissionData, "id" | "submissionId" | "source" | "sourceFilename" | "validationErrors" | "createdAt" | "updatedAt"> & { documents?: unknown[]; recordType?: string } {
  const normalized = { recordType: "", companyDetails: {}, contactDetails: {}, policyDetails: {}, censusMembers: [] as CensusMember[], documents: [] as unknown[] };
  for (const field of fields) {
    setNestedValue(field.target, values[field.id], normalized);
  }
  if (normalized.recordType.toLowerCase().includes("individual")) {
    delete (normalized.companyDetails as Record<string, unknown>).companyName;
    normalized.censusMembers = [];
  }
  return normalized;
}

export function normalizeSubmissionData(input: SubmissionDataInput): NormalizedSubmissionData {
  const data: NormalizedSubmissionData = {
    submissionId: input.submissionId,
    source: input.source,
    sourceFilename: input.sourceFilename ?? null,
    companyDetails: compactObject(input.companyDetails ?? {}),
    contactDetails: compactObject(input.contactDetails ?? {}),
    policyDetails: compactObject(input.policyDetails ?? {}),
    censusMembers: (input.censusMembers ?? []).map((member) => compactObject(member as Record<string, unknown>) as CensusMember),
    validationErrors: input.validationErrors ?? []
  };
  data.validationErrors = [...data.validationErrors, ...validateData(data)];
  return data;
}

export function parseSpreadsheetSubmissionData(input: SpreadsheetImportInput) {
  const buffer = Buffer.from(input.contentBase64, "base64");
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  const rows = firstSheetName ? XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheetName], { defval: "" }) : [];
  const censusMembers = rows.map((row) => {
    const member: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const mapped = columnMap[normalizeKey(key)];
      if (!mapped) continue;
      member[mapped] = mapped === "dateOfBirth" ? parseDateValue(value) : String(value ?? "").trim();
    }
    return compactObject(member) as CensusMember;
  }).filter((member) => Object.keys(member).length > 0);

  return normalizeSubmissionData({
    submissionId: input.submissionId ?? "preview",
    source: "excel_upload",
    sourceFilename: input.filename,
    companyDetails: {},
    contactDetails: {},
    policyDetails: {},
    censusMembers
  });
}

export async function getSubmissionData(submissionId: string) {
  if (shouldUseDatabase()) {
    try {
      const row = await SubmissionData.findOne({ where: { submissionId }, raw: true });
      return row ? fromModel(row as unknown as Record<string, unknown>) : null;
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }
  return memorySubmissionData.find((item) => item.submissionId === submissionId) ?? null;
}

export async function listCustomerDataRows(): Promise<CustomerDataRow[]> {
  if (shouldUseDatabase()) {
    try {
      const dataRows = await CustomerData.findAll({ order: [["updatedAt", "DESC"]], raw: true });
      const customerIds = dataRows.map((row) => String((row as unknown as Record<string, unknown>).customerId));
      const customerRows = customerIds.length ? await Customer.findAll({ where: { id: customerIds }, raw: true }) : [];
      const customersById = new Map(customerRows.map((row) => [String((row as unknown as Record<string, unknown>).id), row as unknown as Record<string, unknown>]));
      return dataRows
        .map((row) => row as unknown as Record<string, unknown>)
        .map((row) => {
          const customer = customersById.get(String(row.customerId));
          return customer ? fromCustomerModel(customer, row) : null;
        })
        .filter((row): row is CustomerDataRow => Boolean(row));
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  return memoryCustomerData.slice().sort((left, right) => new Date(right.updatedAt ?? right.createdAt ?? 0).getTime() - new Date(left.updatedAt ?? left.createdAt ?? 0).getTime());
}

export async function getCustomerDataRecord(id: string) {
  if (shouldUseDatabase()) {
    try {
      const dataRow = await CustomerData.findByPk(id, { raw: true });
      if (!dataRow) return null;
      const data = dataRow as unknown as Record<string, unknown>;
      const customer = await Customer.findByPk(String(data.customerId), { raw: true });
      return customer ? fromCustomerModel(customer as unknown as Record<string, unknown>, data) : null;
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }
  return memoryCustomerData.find((item) => item.id === id) ?? null;
}

export async function listCustomerRecordsForVerification() {
  const rows = await listCustomerDataRows();
  return rows.filter((row) => row.verificationStatus !== "verified");
}

export async function updateCustomerVerification(input: { id: string; status: "pending_review" | "needs_review" | "verified" | "rejected"; notes?: string | null; actor: string }) {
  if (shouldUseDatabase()) {
    try {
      const row = await CustomerData.findByPk(input.id);
      if (!row) return null;
      const patch: Record<string, unknown> = {
        verificationStatus: input.status,
        verificationNotes: input.notes ?? null
      };
      if (input.status === "verified") {
        patch.verifiedBy = input.actor;
        patch.verifiedAt = new Date();
        patch.lockedAt = new Date();
      } else {
        patch.verifiedBy = null;
        patch.verifiedAt = null;
      }
      await row.update(patch);
      recordAudit({ actor: input.actor, action: "customer_record_verification_updated", target: input.id, status: input.status === "verified" ? "success" : "escalated" });
      return getCustomerDataRecord(input.id);
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  const index = memoryCustomerData.findIndex((row) => row.id === input.id);
  if (index < 0) return null;
  memoryCustomerData[index] = {
    ...memoryCustomerData[index],
    verificationStatus: input.status,
    verificationNotes: input.notes ?? null,
    verifiedBy: input.status === "verified" ? input.actor : null,
    verifiedAt: input.status === "verified" ? new Date().toISOString() : null,
    lockedAt: input.status === "verified" ? new Date().toISOString() : memoryCustomerData[index].lockedAt,
    updatedAt: new Date().toISOString()
  };
  return memoryCustomerData[index];
}

export class CustomerDataDeleteBlockedError extends Error {
  constructor() {
    super("Customer record cannot be deleted after member portal jobs or quotes exist.");
    this.name = "CustomerDataDeleteBlockedError";
  }
}

export async function deleteCustomerDataRecord(id: string, actor: string) {
  if (shouldUseDatabase()) {
    try {
      const dataRow = await CustomerData.findByPk(id, { raw: true });
      if (!dataRow) return null;
      const data = dataRow as unknown as Record<string, unknown>;
      const memberRows = await CustomerMember.findAll({ where: { customerDataId: id }, raw: true });
      const memberIds = memberRows.map((row) => String((row as unknown as Record<string, unknown>).id));
      if (memberIds.length) {
        const [jobCount, quoteCount] = await Promise.all([
          PortalJob.count({ where: { memberId: memberIds } }),
          Quote.count({ where: { memberId: memberIds } })
        ]);
        if (jobCount || quoteCount) throw new CustomerDataDeleteBlockedError();
        await MemberFieldValue.destroy({ where: { memberId: memberIds } });
        await CustomerMember.destroy({ where: { customerDataId: id } });
      }
      await CustomerData.destroy({ where: { id } });
      const remainingData = await CustomerData.count({ where: { customerId: String(data.customerId) } });
      const submissionCount = await Submission.count({ where: { customerId: String(data.customerId) } });
      if (!remainingData && !submissionCount) {
        await Customer.destroy({ where: { id: String(data.customerId) } });
      }
      recordAudit({ actor, action: "customer_data_deleted", target: id, status: "success" });
      return { id, customerId: String(data.customerId), deleted: true };
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  const index = memoryCustomerData.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const [deleted] = memoryCustomerData.splice(index, 1);
  recordAudit({ actor, action: "customer_data_deleted", target: id, status: "success" });
  return { id, customerId: deleted.customerId, deleted: true };
}

export async function saveCustomerData(input: Omit<SubmissionDataInput, "submissionId"> & { customerId?: string; id?: string }, actor: string) {
  const tempSubmissionData = normalizeSubmissionData({
    ...input,
    submissionId: "customer-preview"
  });
  const displayName = text(tempSubmissionData.companyDetails.companyName)
    || text(tempSubmissionData.contactDetails.fullName)
    || "Customer";
  const email = text(tempSubmissionData.contactDetails.email) || null;
  const phone = text(tempSubmissionData.contactDetails.phone) || null;
  const coverageType = text(tempSubmissionData.policyDetails.coverageType) || "Customer data";
  let customerId = input.customerId ?? id("cus");
  const recordId = input.id ?? id("cdata");
  const verificationStatus = tempSubmissionData.validationErrors.length ? "needs_review" : "pending_review";

  if (shouldUseDatabase()) {
    try {
      if (input.id && !input.customerId) {
        const existingById = await CustomerData.findByPk(input.id, { raw: true });
        if (existingById) {
          customerId = String((existingById as unknown as Record<string, unknown>).customerId);
        }
      }
      const existingCustomer = await Customer.findByPk(customerId);
      if (existingCustomer) {
        await existingCustomer.update({ fullName: displayName, email, phone });
      } else {
        await Customer.create({ id: customerId, fullName: displayName, email, phone, address: null, createdBy: actor });
      }
      const record = {
        id: recordId,
        customerId,
        source: tempSubmissionData.source,
        sourceFilename: tempSubmissionData.sourceFilename ?? null,
        companyDetails: tempSubmissionData.companyDetails,
        contactDetails: tempSubmissionData.contactDetails,
        policyDetails: { ...tempSubmissionData.policyDetails, coverageType },
        censusMembers: tempSubmissionData.censusMembers,
        validationErrors: tempSubmissionData.validationErrors,
        verificationStatus,
        verificationNotes: tempSubmissionData.validationErrors.length ? "Review import/intake validation issues before submission." : null,
        lockedAt: input.lockedAt ? new Date(input.lockedAt) : null
      };
      const existingData = await CustomerData.findOne({ where: { customerId } });
      const row = existingData ? await existingData.update(record) : await CustomerData.create(record);
      const customer = await Customer.findByPk(customerId, { raw: true });
      recordAudit({ actor, action: "customer_data_saved", target: customerId, status: "success" });
      return fromCustomerModel(customer as unknown as Record<string, unknown>, row.get({ plain: true }) as unknown as Record<string, unknown>);
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  const saved: CustomerDataRow = {
    id: recordId,
    customerId,
    customer: displayName,
    email,
    phone,
    coverageType,
    source: tempSubmissionData.source,
    sourceFilename: tempSubmissionData.sourceFilename,
    companyDetails: tempSubmissionData.companyDetails,
    contactDetails: tempSubmissionData.contactDetails,
    policyDetails: { ...tempSubmissionData.policyDetails, coverageType },
    censusMembers: tempSubmissionData.censusMembers,
    validationErrors: tempSubmissionData.validationErrors,
    verificationStatus,
    verificationNotes: tempSubmissionData.validationErrors.length ? "Review import/intake validation issues before submission." : null,
    assignedTo: null,
    verifiedBy: null,
    verifiedAt: null,
    lockedAt: input.lockedAt ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const index = memoryCustomerData.findIndex((item) => item.customerId === customerId || item.id === recordId);
  if (index >= 0) memoryCustomerData[index] = saved;
  else memoryCustomerData.unshift(saved);
  recordAudit({ actor, action: "customer_data_saved", target: customerId, status: "success" });
  return saved;
}

export function parseSpreadsheetCustomerData(input: CustomerSpreadsheetImportInput) {
  const parsed = parseSpreadsheetSubmissionData(input);
  return {
    source: parsed.source,
    sourceFilename: parsed.sourceFilename,
    companyDetails: { companyName: input.customerName ?? parsed.companyDetails.companyName ?? "" },
    contactDetails: {
      fullName: input.contactName ?? input.customerName ?? "",
      email: input.contactEmail ?? "",
      phone: input.contactPhone ?? ""
    },
    policyDetails: { coverageType: input.coverageType ?? "Customer data" },
    censusMembers: parsed.censusMembers,
    validationErrors: parsed.validationErrors
  };
}

async function createMembersForCustomerData(customerData: CustomerDataRow, members: CensusMember[], actor: string) {
  if (!members.length) return;
  if (shouldUseDatabase()) {
    try {
      await CustomerMember.destroy({ where: { customerDataId: customerData.id } });
      await CustomerMember.bulkCreate(members.filter((member) => text(member.employeeName)).map((member) => ({
        id: id("mem"),
        customerId: customerData.customerId,
        customerDataId: customerData.id,
        employeeNo: member.employeeNo ?? null,
        employeeName: text(member.employeeName),
        relationship: member.relationship ?? null,
        dateOfBirth: member.dateOfBirth ?? null,
        age: member.age === undefined || member.age === "" ? null : Number(member.age),
        gender: member.gender ?? null,
        maritalStatus: member.maritalStatus ?? null,
        nationality: member.nationality ?? null,
        emiratesLocation: member.emiratesLocation ?? member.visaIssuanceEmirate ?? null,
        salary: member.salary === undefined || member.salary === "" ? null : Number(String(member.salary).replace(/,/g, "")),
        salaryBand: member.salaryBand ?? null,
        visaStatus: member.visaStatus ?? null,
        passportNumber: member.passportNumber ?? null,
        mobileNumber: member.mobileNumber ?? null,
        email: member.email ?? null,
        category: member.category ?? null,
        memberType: member.memberType ?? null,
        normalizedPayload: member,
        validationErrors: text(member.employeeName) ? [] : ["employee name is required"],
        status: text(member.employeeName) ? "ready" : "needs_review",
        importBatchId: id("imp")
      })));
      recordAudit({ actor, action: "company_member_rows_imported", target: customerData.id, status: "success" });
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }
}

export async function importSpreadsheetCustomerData(input: CustomerSpreadsheetImportInput, actor: string) {
  const parsed = parseSpreadsheetCustomerData({ ...input, customerName: input.companyName ?? input.customerName });
  const coverageType = input.coverageType ?? "Customer data";
  if (input.importMode === "individual_customers") {
    const rows: CustomerDataRow[] = [];
    for (const member of parsed.censusMembers) {
      const fullName = text(member.employeeName);
      if (!fullName) continue;
      rows.push(await saveCustomerData({
        source: "excel_upload",
        sourceFilename: input.filename,
        companyDetails: {},
        contactDetails: {
          fullName,
          email: text(member.email) || text(input.contactEmail) || "",
          phone: text(member.mobileNumber) || text(input.contactPhone) || ""
        },
        policyDetails: { coverageType },
        censusMembers: [],
        validationErrors: []
      }, actor));
    }
    return rows;
  }

  const companyName = text(input.companyName) || text(input.customerName) || text(parsed.companyDetails.companyName) || input.filename.replace(/\.[^.]+$/, "");
  const company = await saveCustomerData({
    source: "excel_upload",
    sourceFilename: input.filename,
    companyDetails: { companyName },
    contactDetails: {
      fullName: text(input.contactName),
      email: text(input.contactEmail),
      phone: text(input.contactPhone)
    },
    policyDetails: { coverageType },
    censusMembers: parsed.censusMembers,
    validationErrors: parsed.validationErrors
  }, actor);
  await createMembersForCustomerData(company, parsed.censusMembers, actor);
  return company;
}

export async function listIntakeFormTemplates(filters: { coverageTypeCode?: string | null } = {}) {
  const defaults = [await defaultMedicalTemplate("company"), await defaultMedicalTemplate("individual_customer"), await defaultTemplate("company"), await defaultTemplate("individual_customer")];
  const applyFilters = (templates: IntakeFormTemplateRecord[]) => filters.coverageTypeCode
    ? templates.filter((template) => template.coverageTypeCode === filters.coverageTypeCode)
    : templates;

  if (shouldUseDatabase()) {
    try {
      const rows = await IntakeFormTemplate.findAll({ order: [["updatedAt", "DESC"]], raw: true });
      const templates = rows.map((row) => fromTemplateModel(row as unknown as Record<string, unknown>));
      const merged = [...templates];
      for (const template of defaults) {
        if (!merged.some((item) => item.id === template.id)) merged.push(template);
      }
      return applyFilters(merged);
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }
  const templates = memoryFormTemplates.length ? memoryFormTemplates : defaults;
  return applyFilters(templates);
}

export async function getIntakeFormTemplate(templateId?: string | null) {
  const templates = await listIntakeFormTemplates();
  if (templateId) {
    const selected = templates.find((template) => template.id === templateId);
    if (selected) return selected;
  }
  return templates.find((template) => template.isDefault) ?? templates[0] ?? await defaultTemplate("company");
}

export async function saveIntakeFormTemplate(input: Omit<IntakeFormTemplateRecord, "id" | "createdAt" | "updatedAt"> & { id?: string }, actor: string) {
  const normalized = normalizeTemplateForSave(input);
  const record = {
    id: normalized.id ?? id("form"),
    name: normalized.name,
    description: normalized.description ?? null,
    coverageType: normalized.coverageType ?? null,
    coverageTypeCode: normalized.coverageTypeCode ?? null,
    formType: normalized.formType ?? "company",
    templateType: normalized.templateType ?? normalized.formType ?? "company",
    fields: normalized.fields,
    memberColumns: normalized.memberColumns ?? null,
    isDefault: normalized.isDefault,
    createdBy: actor
  };

  if (shouldUseDatabase()) {
    try {
      if (record.isDefault) {
        await IntakeFormTemplate.update({ isDefault: false }, { where: {} });
      }
      const existing = await IntakeFormTemplate.findByPk(record.id);
      const row = existing ? await existing.update(record) : await IntakeFormTemplate.create(record);
      recordAudit({ actor, action: "intake_form_template_saved", target: record.id, status: "success" });
      return fromTemplateModel(row.get({ plain: true }) as unknown as Record<string, unknown>);
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  if (record.isDefault) {
    for (const template of memoryFormTemplates) template.isDefault = false;
  }
  const saved = { ...record, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const index = memoryFormTemplates.findIndex((template) => template.id === saved.id);
  if (index >= 0) memoryFormTemplates[index] = saved;
  else memoryFormTemplates.unshift(saved);
  recordAudit({ actor, action: "intake_form_template_saved", target: saved.id, status: "success" });
  return saved;
}

function normalizeTemplateForSave(input: Omit<IntakeFormTemplateRecord, "id" | "createdAt" | "updatedAt"> & { id?: string }) {
  const formType = input.formType ?? input.templateType ?? "company";
  const coverageTypeCode = input.coverageTypeCode ?? (input.coverageType?.toLowerCase() === "medical" ? "medical" : null);
  const fields = formType === "individual_customer"
    ? input.fields.filter((field) => field.type !== "member_table" && field.target !== "censusMembers" && field.target !== "company.companyName")
    : input.fields;
  const memberColumns = coverageTypeCode === "medical" && formType === "company"
    ? mergeLockedMedicalColumns(input.memberColumns ?? [])
    : formType === "company"
      ? input.memberColumns ?? []
      : [];
  return {
    ...input,
    coverageTypeCode,
    formType,
    templateType: formType,
    fields,
    memberColumns
  };
}

function mergeLockedMedicalColumns(columns: MemberColumnDefinition[]) {
  const byTarget = new Map(columns.map((column) => [String(column.target), column]));
  const locked = medicalMemberColumns.map((column) => ({ ...column, ...(byTarget.get(String(column.target)) ?? {}), target: column.target, locked: true }));
  const lockedTargets = new Set(locked.map((column) => column.target));
  const custom = columns.filter((column) => !lockedTargets.has(column.target)).map((column) => ({ ...column, locked: false }));
  return [...locked, ...custom];
}

export async function saveSubmissionData(input: SubmissionDataInput, actor: string) {
  const data = normalizeSubmissionData(input);
  const record = {
    id: input.id ?? id("sdata"),
    submissionId: data.submissionId,
    source: data.source,
    sourceFilename: data.sourceFilename ?? null,
    companyDetails: data.companyDetails,
    contactDetails: data.contactDetails,
    policyDetails: data.policyDetails,
    censusMembers: data.censusMembers,
    validationErrors: data.validationErrors,
    lockedAt: input.lockedAt ? new Date(input.lockedAt) : null
  };

  if (shouldUseDatabase()) {
    try {
      const existing = await SubmissionData.findOne({ where: { submissionId: data.submissionId } });
      const row = existing
        ? await existing.update(record)
        : await SubmissionData.create(record);
      recordAudit({ actor, action: "submission_data_saved", target: data.submissionId, status: "success" });
      return fromModel(row.get({ plain: true }) as unknown as Record<string, unknown>);
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  const index = memorySubmissionData.findIndex((item) => item.submissionId === data.submissionId);
  const saved = { ...data, id: record.id, lockedAt: record.lockedAt?.toISOString() ?? null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (index >= 0) memorySubmissionData[index] = saved;
  else memorySubmissionData.unshift(saved);
  recordAudit({ actor, action: "submission_data_saved", target: data.submissionId, status: "success" });
  return saved;
}

export async function createPublicIntakeLink(submissionId: string, actor: string, baseUrl: string) {
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const record = {
    id: id("intake"),
    submissionId,
    tokenHash: tokenHash(token),
    expiresAt,
    createdBy: actor
  };

  if (shouldUseDatabase()) {
    try {
      const count = await Submission.count({ where: { id: submissionId } });
      if (!count) return null;
      await PublicIntakeLink.create(record);
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  } else if (!submissions.some((submission) => submission.id === submissionId)) {
    return null;
  }

  memoryIntakeLinks.unshift({ ...record, token, expiresAt: expiresAt.toISOString(), createdAt: new Date().toISOString() });
  recordAudit({ actor, action: "public_intake_link_created", target: submissionId, status: "success" });
  return {
    id: record.id,
    token,
    url: `${baseUrl.replace(/\/$/, "")}/intake/${token}`,
    expiresAt: expiresAt.toISOString()
  };
}

export async function createCustomerIntakeLink(actor: string, baseUrl: string, formTemplateId?: string | null) {
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const record = {
    id: id("cintake"),
    formTemplateId: formTemplateId ?? null,
    tokenHash: tokenHash(token),
    expiresAt,
    createdBy: actor
  };

  if (shouldUseDatabase()) {
    try {
      await CustomerIntakeLink.create(record);
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  memoryCustomerIntakeLinks.unshift({ ...record, token, expiresAt: expiresAt.toISOString(), createdAt: new Date().toISOString() });
  recordAudit({ actor, action: "customer_intake_link_created", target: record.id, status: "success" });
  return {
    id: record.id,
    token,
    url: `${baseUrl.replace(/\/$/, "")}/intake/${token}`,
    expiresAt: expiresAt.toISOString()
  };
}

export async function getCustomerPublicIntake(token: string) {
  const hash = tokenHash(token);
  if (shouldUseDatabase()) {
    try {
      const row = await CustomerIntakeLink.findOne({ where: { tokenHash: hash }, raw: true });
      if (!row) return null;
      const data = row as unknown as Record<string, unknown>;
      if (data.revokedAt || data.usedAt || new Date(data.expiresAt as string | Date) <= new Date()) return null;
      const template = await getIntakeFormTemplate(data.formTemplateId ? String(data.formTemplateId) : null);
      return { mode: "customer" as const, customer: "New customer", coverageType: template.coverageType ?? "Customer intake", template };
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  const link = memoryCustomerIntakeLinks.find((item) => item.tokenHash === hash && !item.revokedAt && !item.usedAt && new Date(item.expiresAt) > new Date());
  const template = link ? await getIntakeFormTemplate(link.formTemplateId) : null;
  return link && template ? { mode: "customer" as const, customer: "New customer", coverageType: template.coverageType ?? "Customer intake", template } : null;
}

export async function getPublicIntake(token: string) {
  const hash = tokenHash(token);
  if (shouldUseDatabase()) {
    try {
      const row = await PublicIntakeLink.findOne({ where: { tokenHash: hash }, raw: true });
      if (!row) return null;
      const data = row as unknown as Record<string, unknown>;
      if (data.revokedAt || data.usedAt || new Date(data.expiresAt as string | Date) <= new Date()) return null;
      const submission = await Submission.findByPk(String(data.submissionId), { raw: true });
      const safeSubmission = submission as unknown as Record<string, unknown>;
      return submission ? { submissionId: String(data.submissionId), customer: String(safeSubmission.customer), coverageType: String(safeSubmission.coverageType) } : null;
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }
  const link = memoryIntakeLinks.find((item) => item.tokenHash === hash && !item.revokedAt && !item.usedAt && new Date(item.expiresAt) > new Date());
  const submission = link ? submissions.find((item) => item.id === link.submissionId) : null;
  return link && submission ? { submissionId: link.submissionId, customer: submission.customer, coverageType: submission.coverageType } : null;
}

export async function submitCustomerPublicIntake(token: string, data: Omit<NormalizedSubmissionData, "submissionId" | "source" | "validationErrors">) {
  const hash = tokenHash(token);
  let linkId: string | null = null;
  let createdBy: string | null = null;

  if (shouldUseDatabase()) {
    try {
      const row = await CustomerIntakeLink.findOne({ where: { tokenHash: hash } });
      if (!row) return null;
      const plain = row.get({ plain: true }) as Record<string, unknown>;
      if (plain.revokedAt || plain.usedAt || new Date(plain.expiresAt as string | Date) <= new Date()) return null;
      linkId = String(plain.id);
      createdBy = String(plain.createdBy);
      await row.update({ usedAt: new Date() });
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  } else {
    const link = memoryCustomerIntakeLinks.find((item) => item.tokenHash === hash && !item.revokedAt && !item.usedAt && new Date(item.expiresAt) > new Date());
    if (!link) return null;
    link.usedAt = new Date().toISOString();
    linkId = link.id;
    createdBy = link.createdBy;
  }

  const saved = await saveCustomerData({
    ...data,
    source: "public_form",
    validationErrors: [],
    lockedAt: new Date().toISOString()
  }, createdBy ?? "public-intake");
  await createMembersForCustomerData(saved, data.censusMembers ?? [], createdBy ?? "public-intake");
  recordAudit({ actor: "public-intake", action: "customer_intake_submitted", target: linkId ?? saved.customerId, status: "success" });
  return saved;
}

export async function submitDynamicCustomerPublicIntake(token: string, values: Record<string, unknown>) {
  const intake = await getCustomerPublicIntake(token);
  if (!intake) return null;
  const normalized = normalizeDynamicIntake(intake.template.fields, values);
  if (intake.template.formType === "individual_customer") {
    normalized.companyDetails = {};
    normalized.censusMembers = [];
  } else {
    delete normalized.contactDetails.fullName;
  }
  if (intake.template.coverageType && !normalized.policyDetails.coverageType) {
    normalized.policyDetails.coverageType = intake.template.coverageType;
  }
  return submitCustomerPublicIntake(token, normalized);
}

export async function submitPublicIntake(token: string, data: Omit<NormalizedSubmissionData, "submissionId" | "source" | "validationErrors">) {
  const hash = tokenHash(token);
  let submissionId: string | null = null;
  let linkId: string | null = null;

  if (shouldUseDatabase()) {
    try {
      const row = await PublicIntakeLink.findOne({ where: { tokenHash: hash } });
      if (!row) return null;
      const plain = row.get({ plain: true }) as Record<string, unknown>;
      if (plain.revokedAt || plain.usedAt || new Date(plain.expiresAt as string | Date) <= new Date()) return null;
      submissionId = String(plain.submissionId);
      linkId = String(plain.id);
      await row.update({ usedAt: new Date() });
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  } else {
    const link = memoryIntakeLinks.find((item) => item.tokenHash === hash && !item.revokedAt && !item.usedAt && new Date(item.expiresAt) > new Date());
    if (!link) return null;
    link.usedAt = new Date().toISOString();
    submissionId = link.submissionId;
    linkId = link.id;
  }

  if (!submissionId) return null;
  const saved = await saveSubmissionData({
    ...data,
    submissionId,
    source: "public_form",
    validationErrors: [],
    lockedAt: new Date().toISOString()
  }, "public-intake");
  recordAudit({ actor: "public-intake", action: "public_intake_submitted", target: linkId ?? submissionId, status: "success" });
  return saved;
}
