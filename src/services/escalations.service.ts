import { escalations, jobs, submissions } from "../data/demo-data.js";
import { Escalation, PortalJob, Submission } from "../db/models.js";
import { canFallbackFromDatabaseError, shouldUseDatabase } from "../db/runtime.js";
import { buildPortalJobPayload, enqueuePortalJob, type PortalJobPayload } from "../queue/portal-jobs.queue.js";
import { broadcastEscalationCount, broadcastJobStatus } from "../realtime/job-status.websocket.js";
import { getJob } from "./jobs.service.js";

type EscalationRecord = {
  id: string;
  jobId: string;
  submissionId: string;
  type?: string | null;
  portalId?: string | null;
  newSnapshotId?: string | null;
  draftMappingId?: string | null;
  metadata?: Record<string, unknown> | null;
  reason: string;
  suggestedAction: string;
  status: "pending" | "approved" | "overridden" | "aborted" | string;
  confidence: number;
  ageMinutes: number;
  screenshotUrl?: string;
};

type EscalationListOptions = {
  page?: number;
  limit?: number;
};

function ageMinutes(createdAt: unknown) {
  if (!createdAt) {
    return 0;
  }
  return Math.max(0, Math.round((Date.now() - new Date(createdAt as string | Date).getTime()) / 60_000));
}

function toEscalationRecord(row: Record<string, unknown>): EscalationRecord {
  return {
    id: String(row.id),
    jobId: String(row.portalJobId),
    submissionId: String(row.submissionId),
    type: row.escalationType ? String(row.escalationType) : null,
    portalId: row.portalId ? String(row.portalId) : null,
    newSnapshotId: row.newSnapshotId ? String(row.newSnapshotId) : null,
    draftMappingId: row.draftMappingId ? String(row.draftMappingId) : null,
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : null,
    reason: String(row.reason),
    suggestedAction: String(row.suggestedAction),
    status: row.status as EscalationRecord["status"],
    confidence: Number(row.confidence ?? 0),
    ageMinutes: ageMinutes(row.createdAt),
    screenshotUrl: row.screenshotUrl ? String(row.screenshotUrl) : undefined
  };
}

export async function listEscalations() {
  const records = await loadEscalations();
  return sortEscalations(records);
}

export async function listEscalationsPage(options: EscalationListOptions = {}) {
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const data = await listEscalations();
  const start = (page - 1) * limit;
  return {
    data: data.slice(start, start + limit),
    meta: {
      page,
      limit,
      total: data.length,
      totalPages: Math.max(1, Math.ceil(data.length / limit))
    }
  };
}

async function loadEscalations() {
  if (shouldUseDatabase()) {
    try {
      const rows = await Escalation.findAll({ order: [["createdAt", "DESC"]], raw: true });
      return rows.map((row) => toEscalationRecord(row as unknown as Record<string, unknown>));
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  return escalations as EscalationRecord[];
}

function sortEscalations(records: EscalationRecord[]) {
  return [...records].sort((left, right) => {
    if (left.status === "pending" && right.status !== "pending") return -1;
    if (left.status !== "pending" && right.status === "pending") return 1;
    return right.ageMinutes - left.ageMinutes;
  });
}

function emitEscalationCount() {
  void broadcastEscalationCount();
}

async function emitRelatedJob(jobId: string) {
  const job = await getJob(jobId);
  if (!job) {
    return;
  }
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

export async function getEscalation(id: string) {
  if (shouldUseDatabase()) {
    try {
      const row = await Escalation.findByPk(id, { raw: true });
      return row ? toEscalationRecord(row as unknown as Record<string, unknown>) : null;
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  return escalations.find((item) => item.id === id) ?? null;
}

export async function createEscalation(input: {
  jobId: string;
  submissionId: string;
  type?: "dom_changed" | "value_drift" | "selector_miss" | "mapping_required" | string;
  portalId?: string | null;
  newSnapshotId?: string | null;
  metadata?: Record<string, unknown> | null;
  reason: string;
  suggestedAction: string;
  confidence: number;
  screenshotUrl?: string;
}) {
  const existing = (await listEscalations()).find((item) => item.jobId === input.jobId && item.status === "pending" && item.reason === input.reason);
  if (existing) {
    await PortalJob.update(
      {
        status: "escalated",
        step: "Human review required",
        confidence: input.confidence
      },
      { where: { id: input.jobId } }
    ).catch(() => undefined);
    return existing;
  }

  const escalation: EscalationRecord = {
    id: `ESC-${Math.floor(Math.random() * 90_000 + 10_000)}`,
    jobId: input.jobId,
    submissionId: input.submissionId,
    type: input.type ?? null,
    portalId: input.portalId ?? null,
    newSnapshotId: input.newSnapshotId ?? null,
    draftMappingId: null,
    metadata: input.metadata ?? null,
    reason: input.reason,
    suggestedAction: input.suggestedAction,
    status: "pending",
    confidence: input.confidence,
    ageMinutes: 0,
    screenshotUrl: input.screenshotUrl
  };

  if (shouldUseDatabase()) {
    try {
      const row = await Escalation.create({
        id: escalation.id,
        portalJobId: input.jobId,
        submissionId: input.submissionId,
        escalationType: input.type ?? null,
        portalId: input.portalId ?? null,
        newSnapshotId: input.newSnapshotId ?? null,
        metadata: input.metadata ?? null,
        reason: input.reason,
        suggestedAction: input.suggestedAction,
        status: "pending",
        confidence: input.confidence,
        screenshotUrl: input.screenshotUrl ?? null
      });
      await PortalJob.update(
        {
          status: "escalated",
          step: "Human review required",
          confidence: input.confidence
        },
        { where: { id: input.jobId } }
      );
      await Submission.update(
        {
          status: "escalated",
          confidence: input.confidence
        },
        { where: { id: input.submissionId } }
      );
      void emitRelatedJob(input.jobId);
      emitEscalationCount();
      const created = toEscalationRecord(row.get({ plain: true }) as unknown as Record<string, unknown>);
      queueMappingSuggestion(created);
      return created;
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  (escalations as EscalationRecord[]).unshift(escalation);
  const job = jobs.find((item) => item.id === input.jobId);
  if (job) {
    job.status = "escalated";
    job.step = "Human review required";
    job.confidence = input.confidence;
  }
  const submission = submissions.find((item) => item.id === input.submissionId);
  if (submission) {
    submission.status = "escalated";
    submission.confidence = input.confidence;
  }
  void emitRelatedJob(input.jobId);
  emitEscalationCount();
  queueMappingSuggestion(escalation);
  return escalation;
}

export async function handleValueDriftReport(jobId: string, driftReport: Record<string, unknown>) {
  const job = await getJob(jobId);
  if (!job) {
    return null;
  }
  return createEscalation({
    jobId,
    submissionId: job.submissionId,
    type: "value_drift",
    portalId: job.portalId,
    newSnapshotId: typeof driftReport.snapshotId === "string" ? driftReport.snapshotId : null,
    metadata: { drift: driftReport },
    reason: `Portal dropdown values changed for ${job.portalName ?? job.portalId}. Submission blocked until approved value mappings are reviewed.`,
    suggestedAction: "Review changed dropdown values, update approved value maps, then publish a reviewed mapping before retrying.",
    confidence: 0
  });
}

function queueMappingSuggestion(escalation: EscalationRecord) {
  if (!["dom_changed", "value_drift"].includes(String(escalation.type ?? ""))) {
    return;
  }
  setTimeout(() => {
    void import("./mapping-suggester.service.js")
      .then(({ suggestMappingForEscalation }) => suggestMappingForEscalation(escalation.id))
      .catch(async (error) => {
        if (!shouldUseDatabase()) return;
        await Escalation.update(
          {
            metadata: {
              ...(escalation.metadata ?? {}),
              aiSuggestion: {
                status: "failed",
                error: error instanceof Error ? error.message : "AI mapping suggestion failed."
              }
            }
          },
          { where: { id: escalation.id } }
        ).catch(() => undefined);
      });
  }, 0);
}

export type EscalationResolution = {
  action: "approve" | "override" | "abort";
  overrideValue?: string;
};

export class EscalationAlreadyResolvedError extends Error {
  constructor() {
    super("Escalation is already resolved.");
    this.name = "EscalationAlreadyResolvedError";
  }
}

function resolvedStatus(action: EscalationResolution["action"]) {
  if (action === "abort") {
    return "cancelled";
  }
  return action === "override" ? "overridden" : "approved";
}

function ensurePending(status: unknown) {
  if (String(status) !== "pending") {
    throw new EscalationAlreadyResolvedError();
  }
}

function fallbackPayload(input: { jobId: string; submissionId: string; portalId?: string }): PortalJobPayload {
  return buildPortalJobPayload({
    portalJobId: input.jobId,
    submissionId: input.submissionId,
    portalId: input.portalId ?? "",
    customerId: input.submissionId,
    documentUrls: []
  });
}

function shouldResumeAgent(action: EscalationResolution["action"]): action is "approve" | "override" {
  return action === "approve" || action === "override";
}

function isDomOrMappingEscalation(reason: unknown, suggestedAction: unknown) {
  return /DOM|snapshot|mapping|published field mapping|MAPPING_REQUIRED/i.test(`${String(reason ?? "")} ${String(suggestedAction ?? "")}`);
}

function resumeResolutionPayload(input: {
  action: "approve" | "override";
  actor: string;
  overrideValue?: string;
}): NonNullable<PortalJobPayload["escalationResolution"]> {
  return {
    decision: input.action,
    actor: input.actor,
    ...(input.overrideValue ? { overrideValue: input.overrideValue } : {})
  };
}

async function requeueResolvedJob(input: {
  action: "approve" | "override";
  jobId: string;
  submissionId: string;
  resolutionPayload: NonNullable<PortalJobPayload["escalationResolution"]>;
}) {
  if (shouldUseDatabase()) {
    const row = await PortalJob.findByPk(input.jobId);
    if (!row) {
      return null;
    }
    const payload = (row.get("jobPayload") as PortalJobPayload | null) ?? fallbackPayload({
      jobId: input.jobId,
      submissionId: input.submissionId,
      portalId: String(row.get("portalId") ?? "")
    });
    const resumePayload = {
      ...payload,
      escalationResolution: input.resolutionPayload,
      portalJobId: input.jobId,
      submissionId: input.submissionId
    };
    const enqueued = await enqueuePortalJob(resumePayload);
    await row.update({
      status: "queued",
      step: `Queued after escalation ${input.action}`,
      confidence: 0,
      queueJobId: enqueued.queueJobId,
      jobPayload: resumePayload
    });
    return enqueued;
  }

  const job = jobs.find((item) => item.id === input.jobId);
  if (!job) {
    return null;
  }
  const resumePayload = {
    ...fallbackPayload({
      jobId: job.id,
      submissionId: job.submissionId,
      portalId: job.portalId
    }),
    escalationResolution: input.resolutionPayload
  };
  const enqueued = await enqueuePortalJob(resumePayload);
  job.status = "queued";
  job.step = `Queued after escalation ${input.action}`;
  job.confidence = 0;
  (job as typeof job & { queueJobId?: string }).queueJobId = enqueued.queueJobId;
  return enqueued;
}

async function cancelResolvedJob(input: { jobId: string }) {
  if (shouldUseDatabase()) {
    const row = await PortalJob.findByPk(input.jobId);
    await row?.update({
      status: "cancelled",
      step: "Escalation aborted by operator",
      confidence: 0,
      errorMessage: "Automation stopped by escalation abort."
    });
    return;
  }

  const job = jobs.find((item) => item.id === input.jobId);
  if (job) {
    job.status = "cancelled";
    job.step = "Escalation aborted by operator";
    job.confidence = 0;
  }
}

export async function resolveEscalation(id: string, actor: string, resolution: EscalationResolution = { action: "approve" }) {
  const status = resolvedStatus(resolution.action);
  const resolutionPayload = {
    decision: resolution.action,
    actor,
    ...(resolution.overrideValue ? { overrideValue: resolution.overrideValue } : {})
  };

  if (shouldUseDatabase()) {
    try {
      const row = await Escalation.findByPk(id);
      if (!row) {
        return null;
      }
      ensurePending(row.get("status"));
      await row.update({
        status,
        resolvedBy: actor,
        resolvedAt: new Date(),
        resolutionPayload
      });
      if (shouldResumeAgent(resolution.action) && !isDomOrMappingEscalation(row.get("reason"), row.get("suggestedAction"))) {
        const resumeResolution = resumeResolutionPayload({
          action: resolution.action,
          actor,
          overrideValue: resolution.overrideValue
        });
        await requeueResolvedJob({
          action: resolution.action,
          jobId: String(row.get("portalJobId")),
          submissionId: String(row.get("submissionId")),
          resolutionPayload: resumeResolution
        });
      } else if (resolution.action === "abort") {
        await cancelResolvedJob({ jobId: String(row.get("portalJobId")) });
      }
      void emitRelatedJob(String(row.get("portalJobId")));
      emitEscalationCount();
      return toEscalationRecord(row.get({ plain: true }) as unknown as Record<string, unknown>);
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  const escalation = escalations.find((item) => item.id === id);
  if (!escalation) {
    return null;
  }
  ensurePending(escalation.status);
  escalation.status = status as EscalationRecord["status"];
  if (shouldResumeAgent(resolution.action) && !isDomOrMappingEscalation(escalation.reason, escalation.suggestedAction)) {
    const resumeResolution = resumeResolutionPayload({
      action: resolution.action,
      actor,
      overrideValue: resolution.overrideValue
    });
    await requeueResolvedJob({
      action: resolution.action,
      jobId: escalation.jobId,
      submissionId: escalation.submissionId,
      resolutionPayload: resumeResolution
    });
  } else if (resolution.action === "abort") {
    await cancelResolvedJob({ jobId: escalation.jobId });
  }
  void emitRelatedJob(escalation.jobId);
  emitEscalationCount();
  return escalation;
}
