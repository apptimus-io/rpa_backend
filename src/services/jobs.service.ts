import { jobs, type JobStatus } from "../data/demo-data.js";
import { AgentAction, Escalation, Portal, PortalJob, Quote } from "../db/models.js";
import { canFallbackFromDatabaseError, shouldUseDatabase } from "../db/runtime.js";
import { enqueuePortalJob, type PortalJobPayload } from "../queue/portal-jobs.queue.js";
import { broadcastJobStatus } from "../realtime/job-status.websocket.js";
import { recordAudit } from "./audit.service.js";
import { notify } from "./notification.service.js";
import { Op } from "sequelize";

const maxAttempts = 3;
const staleProcessingJobMinutes = 120;

export type JobRecord = {
  id: string;
  submissionId: string;
  portalId?: string;
  portalName: string;
  status: JobStatus;
  step: string;
  confidence: number;
  startedAt: string;
  queueJobId?: string;
  payload?: PortalJobPayload;
  attempts?: number;
  errorMessage?: string | null;
};

export class JobNotRetryableError extends Error {
  constructor() {
    super("Only failed jobs can be retried.");
    this.name = "JobNotRetryableError";
  }
}

export class JobRetryLimitError extends Error {
  constructor() {
    super("Job has reached the retry limit.");
    this.name = "JobRetryLimitError";
  }
}

export type JobListFilters = {
  status?: JobStatus;
  portalId?: string;
  submissionId?: string;
  page?: number;
  limit?: number;
};

export type AgentActionInput = {
  portalJobId: string;
  actionType: string;
  confidenceScore: number;
  actionPayload: Record<string, unknown>;
  status: string;
  executedBy?: string;
  beforeScreenshotUrl?: string | null;
  afterScreenshotUrl?: string | null;
};

function emitJobStatus(job: JobRecord) {
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

export type QuoteInput = {
  portalJobId: string;
  premium: number;
  currency: string;
  quoteReference?: string | null;
  quotePayload: Record<string, unknown>;
  memberId?: string | null;
  quotePdfUrl?: string | null;
  quotePdfPublicId?: string | null;
  status?: string;
};

function toJobRecord(row: Record<string, unknown>): JobRecord {
  const portal = row.Portal as { name?: string } | undefined;
  return {
    id: String(row.id),
    submissionId: String(row.submissionId),
    portalId: String(row.portalId),
    portalName: portal?.name ?? "Portal",
    status: row.status as JobRecord["status"],
    step: String(row.step ?? "Queued"),
    confidence: Number(row.confidence ?? 0),
    startedAt: row.startedAt ? new Date(row.startedAt as string | Date).toISOString() : new Date(row.createdAt as string | Date).toISOString(),
    queueJobId: row.queueJobId ? String(row.queueJobId) : undefined,
    payload: row.jobPayload as PortalJobPayload | undefined,
    attempts: Number(row.attempts ?? 0),
    errorMessage: row.errorMessage ? String(row.errorMessage) : null
  };
}

function demoJobRecord(job: (typeof jobs)[number]): JobRecord {
  return job as unknown as JobRecord;
}

function safeErrorMessage(value: unknown) {
  const raw = value instanceof Error ? value.message : String(value ?? "Unknown portal job failure.");
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/password[=:]\s*[^,\s]+/gi, "password=[redacted]")
    .replace(/token[=:]\s*[^,\s]+/gi, "token=[redacted]")
    .slice(0, 500);
}

function safeActionPayload(value: unknown): Record<string, unknown> {
  const redact = (item: unknown): unknown => {
    if (Array.isArray(item)) {
      return item.map(redact);
    }
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as unknown as Record<string, unknown>).map(([key, nested]) => {
          if (/password|token|secret|credential|ciphertext|authorization|cookie/i.test(key)) {
            return [key, "[redacted]"];
          }
          return [key, redact(nested)];
        })
      );
    }
    if (typeof item === "string") {
      return item
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
        .replace(/password[=:]\s*[^,\s]+/gi, "password=[redacted]")
        .replace(/token[=:]\s*[^,\s]+/gi, "token=[redacted]")
        .slice(0, 2_000);
    }
    return item;
  };

  const redacted = redact(value);
  return redacted && typeof redacted === "object" && !Array.isArray(redacted) ? (redacted as unknown as Record<string, unknown>) : { value: redacted };
}

function escalationId() {
  return `ESC-${Math.floor(Math.random() * 90_000 + 10_000)}`;
}

function fallbackPayload(job: JobRecord): PortalJobPayload {
  return {
    payloadVersion: "v1",
    portalJobId: job.id,
    submissionId: job.submissionId,
    portalId: job.portalId ?? "",
    customerId: job.submissionId,
    documentUrls: []
  };
}

function applyJobFilters(records: JobRecord[], filters: JobListFilters = {}) {
  const filtered = records.filter((job) => {
    if (filters.status && job.status !== filters.status) return false;
    if (filters.portalId && job.portalId !== filters.portalId) return false;
    if (filters.submissionId && job.submissionId !== filters.submissionId) return false;
    return true;
  });
  const page = filters.page ?? 1;
  const limit = filters.limit ?? (filtered.length || 1);
  return filtered.slice((page - 1) * limit, page * limit);
}

function actionSummaryFromModel(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    action: String(row.actionType),
    confidence: Number(row.confidenceScore ?? 0),
    status: String(row.status),
    beforeScreenshotUrl: row.beforeScreenshotUrl ? String(row.beforeScreenshotUrl) : null,
    afterScreenshotUrl: row.afterScreenshotUrl ? String(row.afterScreenshotUrl) : null,
    executedBy: String(row.executedBy),
    createdAt: new Date(row.createdAt as string | Date).toISOString()
  };
}

function toActionSummary(row: Record<string, unknown>) {
  return actionSummaryFromModel(row);
}

function quoteSummaryFromModel(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    portalId: String(row.portalId),
    submissionId: String(row.submissionId),
    premium: Number(row.premium),
    currency: String(row.currency),
    quoteReference: row.quoteReference ? String(row.quoteReference) : null,
    memberId: row.memberId ? String(row.memberId) : null,
    quotePdfUrl: row.quotePdfUrl ? String(row.quotePdfUrl) : null,
    quotePdfPublicId: row.quotePdfPublicId ? String(row.quotePdfPublicId) : null,
    status: row.status ? String(row.status) : "extracted",
    extractedAt: new Date(row.extractedAt as string | Date).toISOString()
  };
}

function auditStatusFromAction(status: string) {
  if (status === "failed") return "failed";
  if (status === "escalated") return "escalated";
  return "success";
}

function escalationSummaryFromModel(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    submissionId: String(row.submissionId),
    reason: String(row.reason),
    suggestedAction: String(row.suggestedAction),
    status: String(row.status),
    confidence: Number(row.confidence ?? 0),
    screenshotUrl: row.screenshotUrl ? String(row.screenshotUrl) : null
  };
}

export async function listJobs(filters: JobListFilters = {}) {
  await cleanupStaleProcessingJobs({ actor: "system", olderThanMinutes: staleProcessingJobMinutes });
  if (shouldUseDatabase()) {
    try {
      const rows = await PortalJob.findAll({
        where: {
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.portalId ? { portalId: filters.portalId } : {}),
          ...(filters.submissionId ? { submissionId: filters.submissionId } : {})
        },
        include: [{ model: Portal, attributes: ["name"] }],
        order: [["createdAt", "DESC"]],
        offset: filters.page && filters.limit ? (filters.page - 1) * filters.limit : undefined,
        limit: filters.limit,
        raw: true,
        nest: true
      });
      return rows.map((row) => toJobRecord(row as unknown as Record<string, unknown>));
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  return applyJobFilters(jobs.map(demoJobRecord), filters);
}

export async function cleanupStaleProcessingJobs(input: { actor?: string; olderThanMinutes?: number } = {}) {
  const olderThanMinutes = input.olderThanMinutes ?? staleProcessingJobMinutes;
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
  const message = `Stale processing job timed out after ${olderThanMinutes} minutes. Retry this job to run it again.`;
  const step = "Timed out while processing";

  if (shouldUseDatabase()) {
    try {
      const staleRows = await PortalJob.findAll({
        where: {
          status: "processing",
          updatedAt: { [Op.lt]: cutoff }
        },
        include: [{ model: Portal, attributes: ["name"] }],
        raw: true,
        nest: true
      });
      if (!staleRows.length) return { updated: 0 };

      await PortalJob.update(
        {
          status: "failed",
          errorMessage: message,
          step,
          completedAt: new Date()
        },
        {
          where: {
            id: staleRows.map((row) => String((row as unknown as Record<string, unknown>).id))
          }
        }
      );

      for (const row of staleRows) {
        const job = toJobRecord(row as unknown as Record<string, unknown>);
        const updated = { ...job, status: "failed" as const, step, errorMessage: message };
        recordAudit({ actor: input.actor ?? "system", action: "stale_job_timed_out", target: job.id, status: "failed" });
        emitJobStatus(updated);
      }
      return { updated: staleRows.length };
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  let updated = 0;
  for (const job of jobs) {
    const startedAt = new Date(job.startedAt).getTime();
    if (job.status === "processing" && Number.isFinite(startedAt) && startedAt < cutoff.getTime()) {
      job.status = "failed";
      job.step = step;
      updated += 1;
      recordAudit({ actor: input.actor ?? "system", action: "stale_job_timed_out", target: job.id, status: "failed" });
      emitJobStatus({ ...demoJobRecord(job), errorMessage: message });
    }
  }
  return { updated };
}

export async function getJob(id: string) {
  if (shouldUseDatabase()) {
    try {
      const row = await PortalJob.findByPk(id, {
        include: [{ model: Portal, attributes: ["name"] }],
        raw: true,
        nest: true
      });
      return row ? toJobRecord(row as unknown as Record<string, unknown>) : null;
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  const job = jobs.find((item) => item.id === id);
  return job ? demoJobRecord(job) : null;
}

export async function getJobDetail(id: string) {
  const job = await getJob(id);
  if (!job) {
    return null;
  }

  if (shouldUseDatabase()) {
    try {
      const [actions, quotes, escalations] = await Promise.all([
        AgentAction.findAll({ where: { portalJobId: id }, order: [["createdAt", "DESC"]], raw: true }),
        Quote.findAll({ where: { portalJobId: id }, order: [["extractedAt", "DESC"]], raw: true }),
        Escalation.findAll({ where: { portalJobId: id }, order: [["createdAt", "DESC"]], raw: true })
      ]);
      return {
        ...job,
        actions: actions.map((row) => actionSummaryFromModel(row as unknown as Record<string, unknown>)),
        quotes: quotes.map((row) => quoteSummaryFromModel(row as unknown as Record<string, unknown>)),
        escalations: escalations.map((row) => escalationSummaryFromModel(row as unknown as Record<string, unknown>))
      };
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  return {
    ...job,
    actions: [],
    quotes: [],
    escalations: []
  };
}

export async function retryJob(id: string, actor: string) {
  const job = await getJob(id);
  if (!job) {
    return null;
  }
  if (job.status !== "failed") {
    throw new JobNotRetryableError();
  }
  if ((job.attempts ?? 0) >= maxAttempts) {
    throw new JobRetryLimitError();
  }

  const payload = job.payload ?? fallbackPayload(job);
  const enqueued = await enqueuePortalJob(payload);
  const attempts = (job.attempts ?? 0) + 1;

  if (shouldUseDatabase()) {
    try {
      await PortalJob.update(
        {
          status: "queued",
          step: "Queued for retry",
          confidence: 0,
          attempts,
          errorMessage: null,
          queueJobId: enqueued.queueJobId
        },
        { where: { id } }
      );
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  } else {
    job.status = "queued";
    job.step = "Queued for retry";
    job.confidence = 0;
    job.attempts = attempts;
    job.errorMessage = null;
    job.queueJobId = enqueued.queueJobId;
  }

  recordAudit({ actor, action: "job_retry_requested", target: id, status: "success" });
  const updated = { ...job, status: "queued" as const, step: "Queued for retry", confidence: 0, attempts, errorMessage: null, queueJobId: enqueued.queueJobId };
  emitJobStatus(updated);
  return updated;
}

export async function deadLetterJobs() {
  return listJobs({ status: "failed" });
}

export async function markJobProcessing(input: { id: string; step?: string; actor?: string }) {
  const job = await getJob(input.id);
  if (!job) {
    return null;
  }

  const step = input.step ?? "Agent started";
  if (shouldUseDatabase()) {
    try {
      await PortalJob.update(
        {
          status: "processing",
          step,
          errorMessage: null
        },
        { where: { id: input.id } }
      );
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  } else {
    job.status = "processing";
    job.step = step;
    job.errorMessage = null;
  }

  recordAudit({ actor: input.actor ?? "agent-worker", action: "job_processing_started", target: input.id, status: "success" });
  const updated = { ...job, status: "processing" as const, step, errorMessage: null };
  emitJobStatus(updated);
  return updated;
}

export async function recordAgentAction(input: AgentActionInput) {
  const job = await getJob(input.portalJobId);
  if (!job) {
    return null;
  }

  const record = {
    id: `act_${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`,
    portalJobId: input.portalJobId,
    actionType: input.actionType,
    confidenceScore: Math.max(0, Math.min(100, Number(input.confidenceScore))),
    actionPayload: safeActionPayload(input.actionPayload),
    beforeScreenshotUrl: input.beforeScreenshotUrl ?? null,
    afterScreenshotUrl: input.afterScreenshotUrl ?? null,
    status: input.status,
    executedBy: input.executedBy ?? "agent-worker",
    createdAt: new Date()
  };

  if (shouldUseDatabase()) {
    try {
      await PortalJob.update(
        {
          status: "processing",
          step: input.actionType.replaceAll("_", " "),
          confidence: record.confidenceScore,
          errorMessage: null
        },
        { where: { id: input.portalJobId, status: ["queued", "processing"] } }
      );
      const row = await AgentAction.create(record);
      recordAudit({ actor: record.executedBy, action: `agent_${record.actionType}`, target: input.portalJobId, status: auditStatusFromAction(record.status) });
      emitJobStatus({ ...job, status: "processing", step: input.actionType.replaceAll("_", " "), confidence: record.confidenceScore, errorMessage: null });
      return toActionSummary(row.get({ plain: true }) as unknown as Record<string, unknown>);
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  job.status = "processing";
  job.step = input.actionType.replaceAll("_", " ");
  job.confidence = record.confidenceScore;
  job.errorMessage = null;

  recordAudit({ actor: record.executedBy, action: `agent_${record.actionType}`, target: input.portalJobId, status: auditStatusFromAction(record.status) });
  emitJobStatus(job);
  return toActionSummary(record as unknown as Record<string, unknown>);
}

export async function recordQuote(input: QuoteInput) {
  const job = await getJob(input.portalJobId);
  if (!job) {
    return null;
  }

  const record = {
    id: `quo_${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`,
    portalJobId: input.portalJobId,
    portalId: job.portalId ?? "",
    submissionId: job.submissionId,
    premium: input.premium,
    currency: input.currency.toUpperCase(),
    quoteReference: input.quoteReference ?? null,
    quotePayload: safeActionPayload(input.quotePayload),
    memberId: input.memberId ?? (job.payload?.memberId ?? null),
    quotePdfUrl: input.quotePdfUrl ?? null,
    quotePdfPublicId: input.quotePdfPublicId ?? null,
    status: input.status ?? "extracted",
    extractedAt: new Date()
  };

  if (shouldUseDatabase()) {
    try {
      const row = await Quote.create(record);
      await PortalJob.update(
        {
          status: "completed",
          step: "Quote extraction",
          confidence: 100,
          completedAt: record.extractedAt
        },
        { where: { id: input.portalJobId } }
      );
      recordAudit({ actor: "agent-worker", action: "quote_extracted", target: input.portalJobId, status: "success" });
      emitJobStatus({ ...job, status: "completed", step: "Quote extraction", confidence: 100 });
      return quoteSummaryFromModel(row.get({ plain: true }) as unknown as Record<string, unknown>);
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  } else {
    const demoJob = jobs.find((item) => item.id === input.portalJobId);
    if (demoJob) {
      demoJob.status = "completed";
      demoJob.step = "Quote extraction";
      demoJob.confidence = 100;
    }
  }

  recordAudit({ actor: "agent-worker", action: "quote_extracted", target: input.portalJobId, status: "success" });
  emitJobStatus({ ...job, status: "completed", step: "Quote extraction", confidence: 100 });
  return quoteSummaryFromModel(record as unknown as Record<string, unknown>);
}

export async function markJobFailure(input: { id: string; error: unknown; actor?: string; terminal?: boolean; status?: "failed" | "escalated" }) {
  const job = await getJob(input.id);
  if (!job) {
    return null;
  }

  const attempts = input.terminal ? (job.attempts ?? 0) : Math.min((job.attempts ?? 0) + 1, maxAttempts);
  const isExhausted = input.terminal || attempts >= maxAttempts;
  const status: JobStatus = input.terminal ? (input.status ?? "failed") : isExhausted ? "failed" : "processing";
  const message = safeErrorMessage(input.error);
  const step = input.terminal ? message.slice(0, 120) : isExhausted ? "Retry policy exhausted" : `Retry attempt ${attempts} failed`;

  if (shouldUseDatabase()) {
    try {
      await PortalJob.update(
        {
          status,
          attempts,
          errorMessage: message,
          step
        },
        { where: { id: input.id } }
      );
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  } else {
    job.status = status;
    job.attempts = attempts;
    job.errorMessage = message;
    job.step = step;
  }

  if (isExhausted) {
    recordAudit({ actor: input.actor ?? "system", action: status === "escalated" ? "job_escalated" : "job_dead_lettered", target: input.id, status: status === "escalated" ? "escalated" : "failed" });
    if (status === "escalated") {
      await ensureEscalationForJob(job, message);
    }
    notify({
      userId: "usr_seed_admin",
      channel: "system",
      title: status === "escalated" ? "Portal job escalated" : "Portal job moved to dead letter",
      body: status === "escalated" ? `${input.id} requires human review.` : `${input.id} failed after ${maxAttempts} attempts.`
    });
  }

  const updated = { ...job, status, attempts, errorMessage: message, step };
  emitJobStatus(updated);
  return updated;
}

async function ensureEscalationForJob(job: JobRecord, reason: string) {
  if (shouldUseDatabase()) {
    try {
      const existing = await Escalation.findOne({ where: { portalJobId: job.id, status: "pending" } });
      if (existing) return;
      await Escalation.create({
        id: escalationId(),
        portalJobId: job.id,
        submissionId: job.submissionId,
        reason,
        suggestedAction: suggestedActionForEscalation(reason),
        status: "pending",
        confidence: job.confidence ?? 0,
        screenshotUrl: null
      });
      return;
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }
}

function suggestedActionForEscalation(reason: string) {
  if (/mapping|required|DOM|snapshot/i.test(reason)) {
    return "Approve the DOM snapshot and publish the portal field mapping from Agent Activity, then retry the job.";
  }
  return "Review the failed agent action, correct the issue, then retry the job.";
}
