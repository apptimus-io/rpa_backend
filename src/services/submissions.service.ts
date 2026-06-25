import { jobs, portals, submissions, type JobStatus, type SubmissionStatus } from "../data/demo-data.js";
import { AgentAction, Customer, Portal, PortalJob, Quote, Submission } from "../db/models.js";
import { canFallbackFromDatabaseError, shouldUseDatabase } from "../db/runtime.js";
import { sequelize } from "../db/sequelize.js";
import { Op } from "sequelize";
import { buildPortalJobPayload, enqueuePortalJob, removeQueuedPortalJobsForSubmission, type PortalJobPayload } from "../queue/portal-jobs.queue.js";
import { broadcastJobStatus } from "../realtime/job-status.websocket.js";
import { recordAudit } from "./audit.service.js";
import { listSubmissionDocuments } from "./documents.service.js";
import { listEscalations } from "./escalations.service.js";
import { listJobs } from "./jobs.service.js";
import { getInsurerWorkflow, getMemberData, listCustomerMembers, memberToCensus } from "./member-data.service.js";
import { getCustomerDataRecord, getSubmissionData, saveCustomerData, saveSubmissionData, type CensusMember, type SubmissionDataInput } from "./submission-data.service.js";
import { isValidCoverageType } from "./master-data.service.js";

type SubmissionRecord = (typeof submissions)[number];

type CreateSubmissionInput = {
  customer: string | {
    fullName: string;
    dateOfBirth?: string;
    email?: string;
    phone?: string;
    address?: string;
  };
  coverageType: string;
  riskDetails?: Record<string, unknown>;
  portalIds: string[];
  documentCount: number;
  customerDataId?: string;
  memberIds?: string[];
  quoteGroupBy?: QuoteGroupBy;
  submissionData?: Omit<SubmissionDataInput, "submissionId">;
  actor: string;
};

export class SubmissionNotCancellableError extends Error {
  constructor() {
    super("Only queued or escalated submissions can be cancelled.");
    this.name = "SubmissionNotCancellableError";
  }
}

export class InvalidCoverageTypeError extends Error {
  constructor() {
    super("Coverage type must be selected from master data.");
    this.name = "InvalidCoverageTypeError";
  }
}

export class CustomerRecordNotVerifiedError extends Error {
  constructor() {
    super("Company/customer record must be verified before submission.");
    this.name = "CustomerRecordNotVerifiedError";
  }
}

type CreatedPortalJob = {
  id: string;
  submissionId: string;
  portalId: string;
  portalName: string;
  status: JobStatus;
  step: string;
  confidence: number;
  startedAt: string;
  queueJobId: string;
  payload: PortalJobPayload;
};

type QuoteGroupBy = "location" | "category" | "salaryBand" | "nationality";

type LocationQuoteBatch = {
  groupBy: QuoteGroupBy;
  groupValue: string;
  locationValue: string;
  label: string;
  memberCount: number;
  members: CensusMember[];
};

export type SubmissionListFilters = {
  page?: number;
  limit?: number;
  status?: SubmissionStatus;
  dateFrom?: string;
  dateTo?: string;
  portalId?: string;
};

function memberGroupValue(member: CensusMember, groupBy: QuoteGroupBy) {
  if (groupBy === "category") return String(member.category ?? "").trim() || "Unspecified category";
  if (groupBy === "salaryBand") return String(member.salaryBand ?? "").trim() || "Unspecified salary band";
  if (groupBy === "nationality") return String(member.nationality ?? "").trim() || "Unspecified nationality";
  return String(member.emiratesLocation ?? member.visaIssuanceEmirate ?? "").trim() || "Unspecified location";
}

function buildLocationQuoteBatches(members: CensusMember[], groupBy: QuoteGroupBy): LocationQuoteBatch[] {
  if (!members.length) {
    return [{
      groupBy,
      groupValue: "record",
      locationValue: "record",
      label: "Record-level quotation",
      memberCount: 0,
      members: []
    }];
  }

  const grouped = new Map<string, CensusMember[]>();
  for (const member of members) {
    const groupValue = memberGroupValue(member, groupBy);
    grouped.set(groupValue, [...(grouped.get(groupValue) ?? []), member]);
  }

  return [...grouped.entries()].map(([groupValue, locationMembers]) => ({
    groupBy,
    groupValue,
    locationValue: groupValue,
    label: `${groupLabel(groupBy)}: ${groupValue}`,
    memberCount: locationMembers.length,
    members: locationMembers
  }));
}

function chooseQuoteGroupBy(members: CensusMember[]): QuoteGroupBy {
  if (!members.length) return "location";

  const candidates: QuoteGroupBy[] = ["location", "category", "salaryBand", "nationality"];
  const distinctByCandidate = candidates.map((candidate) => ({
    candidate,
    distinctCount: new Set(
      members
        .map((member) => memberGroupValue(member, candidate))
        .filter((value) => !value.startsWith("Unspecified"))
    ).size
  }));

  const location = distinctByCandidate.find((item) => item.candidate === "location");
  if ((location?.distinctCount ?? 0) > 1) return "location";

  return distinctByCandidate
    .filter((item) => item.distinctCount > 1)
    .sort((left, right) => right.distinctCount - left.distinctCount)[0]?.candidate ?? "location";
}

function groupLabel(groupBy: QuoteGroupBy) {
  if (groupBy === "category") return "Category";
  if (groupBy === "salaryBand") return "Salary band";
  if (groupBy === "nationality") return "Nationality";
  return "Location";
}

function toSubmissionRecord(row: Record<string, unknown>): SubmissionRecord {
  return {
    id: String(row.id),
    customer: String(row.customer),
    coverageType: String(row.coverageType),
    status: row.status as SubmissionStatus,
    portalCount: Number(row.portalCount ?? 0),
    documentCount: Number(row.documentCount ?? 0),
    createdAt: new Date(row.createdAt as string | Date).toISOString(),
    confidence: Number(row.confidence ?? 0),
    createdBy: String(row.createdBy)
  };
}

function generateSubmissionId() {
  return `SUB-2026-${Math.floor(Math.random() * 9000 + 1000)}`;
}

function generateJobId() {
  return `JOB-${Math.floor(Math.random() * 9000 + 1000)}`;
}

function generateCustomerId() {
  return `cus_${Math.floor(Math.random() * 90_000 + 10_000)}`;
}

function normalizeCustomer(input: CreateSubmissionInput["customer"]) {
  if (typeof input === "string") {
    return {
      fullName: input,
      dateOfBirth: undefined,
      email: undefined,
      phone: undefined,
      address: undefined
    };
  }

  return input;
}

async function getSelectablePortals(portalIds: string[]) {
  if (shouldUseDatabase()) {
    try {
      const rows = await Portal.findAll({
        where: { id: portalIds, isActive: true },
        raw: true
      });
      return rows.map((row) => ({
        id: String((row as unknown as Record<string, unknown>).id),
        name: String((row as unknown as Record<string, unknown>).name),
        loginUrl: String((row as unknown as Record<string, unknown>).loginUrl),
        quotationUrl: (row as unknown as Record<string, unknown>).quotationUrl ? String((row as unknown as Record<string, unknown>).quotationUrl) : undefined
      }));
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  return portals
    .filter((portal) => portalIds.includes(portal.id) && portal.health !== "offline")
    .map((portal) => ({ id: portal.id, name: portal.name, loginUrl: portal.loginUrl }));
}

function applySubmissionFilters(records: SubmissionRecord[], filters: SubmissionListFilters = {}) {
  const filtered = records.filter((submission) => {
    if (filters.status && submission.status !== filters.status) return false;
    if (filters.dateFrom && new Date(submission.createdAt) < new Date(filters.dateFrom)) return false;
    if (filters.dateTo && new Date(submission.createdAt) > new Date(filters.dateTo)) return false;
    if (filters.portalId && !jobs.some((job) => job.submissionId === submission.id && job.portalId === filters.portalId)) return false;
    return true;
  });
  const page = filters.page ?? 1;
  const limit = filters.limit ?? (filtered.length || 1);
  return filtered.slice((page - 1) * limit, page * limit);
}

function rollupSubmissionFromJobs(submission: SubmissionRecord, portalJobs: Array<{ status: JobStatus; confidence: number }>): SubmissionRecord {
  if (!portalJobs.length) return submission;
  const statuses = portalJobs.map((job) => job.status);
  const terminalStatuses = new Set(["completed", "failed", "escalated", "cancelled"]);
  const allTerminal = statuses.every((status) => terminalStatuses.has(status));
  const status: SubmissionStatus = statuses.every((item) => item === "completed")
    ? "completed"
    : statuses.some((item) => item === "escalated")
      ? "escalated"
      : allTerminal && statuses.some((item) => item === "failed")
        ? "failed"
        : statuses.some((item) => item === "processing")
          ? "processing"
          : statuses.some((item) => item === "queued")
            ? "queued"
            : submission.status;
  const confidence = Math.round(portalJobs.reduce((total, job) => total + Number(job.confidence ?? 0), 0) / portalJobs.length);
  return {
    ...submission,
    status,
    confidence,
    portalCount: portalJobs.length
  };
}

async function rollupSubmissions(records: SubmissionRecord[]) {
  if (!records.length) return records;
  if (shouldUseDatabase()) {
    try {
      const submissionIds = records.map((record) => record.id);
      const jobRows = await PortalJob.findAll({
        attributes: ["submissionId", "status", "confidence"],
        where: { submissionId: submissionIds },
        raw: true
      });
      const jobsBySubmission = new Map<string, Array<{ status: JobStatus; confidence: number }>>();
      for (const row of jobRows) {
        const data = row as unknown as Record<string, unknown>;
        const submissionId = String(data.submissionId);
        jobsBySubmission.set(submissionId, [
          ...(jobsBySubmission.get(submissionId) ?? []),
          { status: data.status as JobStatus, confidence: Number(data.confidence ?? 0) }
        ]);
      }
      const rolled = records.map((record) => rollupSubmissionFromJobs(record, jobsBySubmission.get(record.id) ?? []));
      await Promise.all(rolled
        .filter((record, index) => record.status !== records[index].status || record.confidence !== records[index].confidence || record.portalCount !== records[index].portalCount)
        .map((record) => Submission.update({ status: record.status, confidence: record.confidence, portalCount: record.portalCount }, { where: { id: record.id } })));
      return rolled;
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  return records.map((record) => rollupSubmissionFromJobs(record, jobs.filter((job) => job.submissionId === record.id).map((job) => ({ status: job.status, confidence: job.confidence }))));
}

async function submissionIdsForPortal(portalId: string) {
  const rows = await PortalJob.findAll({ attributes: ["submissionId"], where: { portalId }, raw: true });
  return rows.map((row) => String((row as unknown as Record<string, unknown>).submissionId));
}

export async function listSubmissions(filters: SubmissionListFilters = {}) {
  if (shouldUseDatabase()) {
    try {
      const portalSubmissionIds = filters.portalId ? await submissionIdsForPortal(filters.portalId) : undefined;
      const rows = await Submission.findAll({
        where: {
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.dateFrom || filters.dateTo ? {
            createdAt: {
              ...(filters.dateFrom ? { [Op.gte]: new Date(filters.dateFrom) } : {}),
              ...(filters.dateTo ? { [Op.lte]: new Date(filters.dateTo) } : {})
            }
          } : {}),
          ...(portalSubmissionIds ? { id: portalSubmissionIds } : {})
        },
        order: [["createdAt", "DESC"]],
        offset: filters.page && filters.limit ? (filters.page - 1) * filters.limit : undefined,
        limit: filters.limit,
        raw: true
      });
      return rollupSubmissions(rows.map((row) => toSubmissionRecord(row as unknown as Record<string, unknown>)));
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  return applySubmissionFilters(await rollupSubmissions(submissions), filters);
}

export async function getSubmission(id: string) {
  if (shouldUseDatabase()) {
    try {
      const row = await Submission.findByPk(id, { raw: true });
      if (!row) return null;
      const [rolled] = await rollupSubmissions([toSubmissionRecord(row as unknown as Record<string, unknown>)]);
      return rolled;
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  const submission = submissions.find((item) => item.id === id);
  if (!submission) return null;
  const [rolled] = await rollupSubmissions([submission]);
  return rolled;
}

function safeCustomerFromSubmission(submission: SubmissionRecord) {
  return {
    fullName: submission.customer
  };
}

function quoteFromModel(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    portalJobId: String(row.portalJobId),
    portalId: String(row.portalId),
    submissionId: String(row.submissionId),
    premium: Number(row.premium),
    currency: String(row.currency),
    quoteReference: row.quoteReference ? String(row.quoteReference) : null,
    quotePdfUrl: row.quotePdfUrl ? String(row.quotePdfUrl) : null,
    quotePdfPublicId: row.quotePdfPublicId ? String(row.quotePdfPublicId) : null,
    extractedAt: new Date(row.extractedAt as string | Date).toISOString()
  };
}

function actionSummaryFromModel(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    portalJobId: String(row.portalJobId),
    action: String(row.actionType),
    confidence: Number(row.confidenceScore ?? 0),
    status: String(row.status),
    beforeScreenshotUrl: row.beforeScreenshotUrl ? String(row.beforeScreenshotUrl) : null,
    afterScreenshotUrl: row.afterScreenshotUrl ? String(row.afterScreenshotUrl) : null,
    executedBy: String(row.executedBy),
    createdAt: new Date(row.createdAt as string | Date).toISOString()
  };
}

async function getCustomerSummary(submission: SubmissionRecord) {
  if (shouldUseDatabase()) {
    try {
      const row = await Submission.findByPk(submission.id, { raw: true });
      const customerId = row ? String((row as unknown as Record<string, unknown>).customerId ?? "") : "";
      if (customerId) {
        const customer = await Customer.findByPk(customerId, { raw: true });
        if (customer) {
          const data = customer as unknown as Record<string, unknown>;
          return {
            id: String(data.id),
            fullName: String(data.fullName),
            email: data.email ? String(data.email) : null,
            phone: data.phone ? String(data.phone) : null
          };
        }
      }
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  return safeCustomerFromSubmission(submission);
}

async function listSubmissionQuotes(submissionId: string) {
  if (shouldUseDatabase()) {
    try {
      const rows = await Quote.findAll({ where: { submissionId }, order: [["extractedAt", "DESC"]], raw: true });
      return rows.map((row) => quoteFromModel(row as unknown as Record<string, unknown>));
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  return [];
}

async function listSubmissionActionSummary(jobIds: string[]) {
  if (!jobIds.length) {
    return [];
  }
  if (shouldUseDatabase()) {
    try {
      const rows = await AgentAction.findAll({
        where: { portalJobId: jobIds },
        order: [["createdAt", "DESC"]],
        raw: true
      });
      return rows.map((row) => actionSummaryFromModel(row as unknown as Record<string, unknown>));
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  return [];
}

export async function getSubmissionDetail(id: string) {
  const submission = await getSubmission(id);
  if (!submission) {
    return null;
  }

  const [customer, documents, allJobs, quotes, allEscalations] = await Promise.all([
    getCustomerSummary(submission),
    listSubmissionDocuments(id),
    listJobs(),
    listSubmissionQuotes(id),
    listEscalations()
  ]);
  const portalJobs = allJobs.filter((job) => job.submissionId === id);
  const actionSummary = await listSubmissionActionSummary(portalJobs.map((job) => job.id));

  return {
    ...submission,
    customerSummary: customer,
    documents,
    portalJobs,
    quotes,
    escalations: allEscalations.filter((escalation) => escalation.submissionId === id),
    actionSummary
  };
}

export async function createSubmission(input: CreateSubmissionInput) {
  if (!(await isValidCoverageType(input.coverageType))) {
    throw new InvalidCoverageTypeError();
  }
  const selectedPortals = await getSelectablePortals(input.portalIds);
  if (selectedPortals.length !== input.portalIds.length) {
    return { error: "PORTAL_NOT_SELECTABLE" as const };
  }

  const customerData = input.customerDataId ? await getCustomerDataRecord(input.customerDataId) : null;
  if (customerData && customerData.verificationStatus !== "verified") {
    throw new CustomerRecordNotVerifiedError();
  }
  const customerInput = customerData
    ? {
      fullName: customerData.customer,
      email: customerData.email ?? undefined,
      phone: customerData.phone ?? undefined,
      dateOfBirth: undefined,
      address: undefined
    }
    : normalizeCustomer(input.customer);
  const customerId = customerData?.customerId ?? generateCustomerId();
  const submission: SubmissionRecord = {
    id: generateSubmissionId(),
    customer: customerInput.fullName,
    coverageType: input.coverageType,
    status: "queued",
    portalCount: input.portalIds.length,
    documentCount: input.documentCount,
    createdAt: new Date().toISOString(),
    confidence: 0,
    createdBy: input.actor
  };

  if (shouldUseDatabase()) {
    try {
      await sequelize.transaction(async (transaction) => {
        if (!customerData) {
          await Customer.create({
            id: customerId,
            fullName: customerInput.fullName,
            dateOfBirth: customerInput.dateOfBirth,
            email: customerInput.email,
            phone: customerInput.phone,
            address: customerInput.address,
            createdBy: input.actor
          }, { transaction });
        }
        await Submission.create({
          ...submission,
          customerId,
          riskDetails: input.riskDetails ?? {}
        }, { transaction });
      });
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
      submissions.unshift(submission);
    }
  } else {
    submissions.unshift(submission);
  }

  const selectedMembers = customerData?.id
    ? await listCustomerMembers(customerData.id) ?? []
    : input.memberIds?.length
      ? (await Promise.all(input.memberIds.map((memberId) => getMemberData(memberId)))).filter((member): member is NonNullable<Awaited<ReturnType<typeof getMemberData>>> => Boolean(member))
      : [];

  const copiedCustomerData = customerData
    ? {
      source: customerData.source,
      sourceFilename: customerData.sourceFilename,
      companyDetails: customerData.companyDetails,
      contactDetails: customerData.contactDetails,
      policyDetails: { ...customerData.policyDetails, coverageType: input.coverageType },
      censusMembers: selectedMembers.length ? selectedMembers.map(memberToCensus) : customerData.censusMembers
    }
    : undefined;
  const savedSubmissionData = input.submissionData
    ? await saveSubmissionData({ ...input.submissionData, submissionId: submission.id }, input.actor)
    : copiedCustomerData
      ? await saveSubmissionData({ ...copiedCustomerData, submissionId: submission.id }, input.actor)
    : await getSubmissionData(submission.id);
  if (!customerData && input.submissionData) {
    await saveCustomerData({ ...input.submissionData, customerId }, input.actor);
  }
  const documents = await listSubmissionDocuments(submission.id);
  const documentUrls = documents.map((document) => document.cloudinaryUrl);
  const createdJobs: CreatedPortalJob[] = [];
  const effectiveCensusMembers = (savedSubmissionData?.censusMembers?.length ? savedSubmissionData.censusMembers : copiedCustomerData?.censusMembers) ?? [];
  const quoteGroupBy = input.quoteGroupBy ?? chooseQuoteGroupBy(effectiveCensusMembers);
  const quoteBatches = buildLocationQuoteBatches(effectiveCensusMembers, quoteGroupBy);

  for (const portal of selectedPortals) {
    const workflow = await getInsurerWorkflow(portal.id, input.coverageType);
    const workflowMode = String((workflow as Record<string, unknown> | null)?.workflowMode ?? (selectedMembers.length ? "bulk_upload" : "individual_entry")) as "individual_entry" | "bulk_upload";
    for (const quoteBatch of quoteBatches) {
      const jobId = generateJobId();
      const payload = buildPortalJobPayload({
        portalJobId: jobId,
        submissionId: submission.id,
        portalId: portal.id,
        portalName: portal.name,
        portalLoginUrl: portal.loginUrl,
        portalQuotationUrl: (portal as { quotationUrl?: string }).quotationUrl ?? portal.loginUrl,
        customerId,
        customerDataId: customerData?.id,
        memberId: undefined,
        coverageType: input.coverageType,
        coverageTypeCode: (savedSubmissionData?.policyDetails?.coverageTypeCode ? String(savedSubmissionData.policyDetails.coverageTypeCode) : undefined),
        workflowMode,
        submissionDataId: savedSubmissionData?.id,
        quoteBatch: {
          groupBy: quoteBatch.groupBy,
          groupValue: quoteBatch.groupValue,
          locationValue: quoteBatch.locationValue,
          label: quoteBatch.label,
          memberCount: quoteBatch.memberCount
        },
        documentUrls
      });
      const queued = await enqueuePortalJob(payload);
      const job: CreatedPortalJob = {
        id: jobId,
        submissionId: submission.id,
        portalId: portal.id,
        portalName: portal.name,
        status: "queued",
        step: "Queued",
        confidence: 0,
        startedAt: submission.createdAt,
        queueJobId: queued.queueJobId,
        payload
      };

    if (shouldUseDatabase()) {
      try {
        await PortalJob.create({
          id: job.id,
          submissionId: job.submissionId,
          portalId: job.portalId,
          status: job.status,
          queueJobId: job.queueJobId,
          payloadVersion: payload.payloadVersion,
          jobPayload: payload,
          step: job.step,
          confidence: job.confidence,
          attempts: 0,
          memberId: null,
          workflowMode,
          mappingVersion: payload.mappingVersion ?? null,
          portalTemplateId: payload.portalTemplateId ?? null,
          censusTemplateId: payload.censusTemplateId ?? null
        });
      } catch (error) {
        if (!canFallbackFromDatabaseError()) throw error;
      }
    } else {
      jobs.unshift({
        id: job.id,
        submissionId: job.submissionId,
        portalId: job.portalId,
        portalName: job.portalName,
        status: job.status,
        step: job.step,
        confidence: job.confidence,
        startedAt: job.startedAt
      });
    }

    createdJobs.push(job);
    broadcastJobStatus({
      type: "job_status_changed",
      job: {
        id: job.id,
        submissionId: job.submissionId,
        portalId: job.portalId,
        portalName: job.portalName,
        status: job.status,
        step: job.step,
        confidence: job.confidence,
        attempts: 0,
        errorMessage: null
      }
    });
    }
  }

  recordAudit({ actor: input.actor, action: "submission_created", target: submission.id, status: "success" });
  recordAudit({ actor: input.actor, action: "portal_jobs_created", target: submission.id, status: "success" });

  return { data: { submission, jobs: createdJobs } };
}

export async function cancelSubmission(id: string, actor: string) {
  const submission = await getSubmission(id);
  if (!submission) {
    return null;
  }
  if (submission.status === "cancelled") {
    return submission;
  }
  if (!["queued", "escalated"].includes(submission.status)) {
    throw new SubmissionNotCancellableError();
  }

  if (shouldUseDatabase()) {
    try {
      await Submission.update({ status: "cancelled" }, { where: { id } });
      await PortalJob.update(
        {
          status: "cancelled",
          step: "Cancelled with submission"
        },
        {
          where: {
            submissionId: id,
            status: ["queued", "escalated", "failed"]
          }
        }
      );
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  } else {
    submission.status = "cancelled";
    for (const job of jobs.filter((item) => item.submissionId === id && ["queued", "escalated", "failed"].includes(item.status))) {
      job.status = "cancelled" as JobStatus;
      job.step = "Cancelled with submission";
    }
  }

  const queueRemoval = removeQueuedPortalJobsForSubmission(id);
  for (const job of await listJobs({ submissionId: id })) {
    if (job.status === "cancelled") {
      broadcastJobStatus({
        type: "job_status_changed",
        job: {
          id: job.id,
          submissionId: job.submissionId,
          portalId: job.portalId,
          portalName: job.portalName,
          status: job.status,
          step: job.step,
          confidence: job.confidence,
          attempts: job.attempts,
          errorMessage: job.errorMessage
        }
      });
    }
  }
  recordAudit({ actor, action: "submission_cancelled", target: id, status: "success" });
  if (queueRemoval.removed > 0) {
    recordAudit({ actor, action: "portal_jobs_queue_cancelled", target: id, status: "success" });
  }
  return { ...submission, status: "cancelled" as SubmissionStatus };
}
