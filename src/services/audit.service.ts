import { auditLog, jobs } from "../data/demo-data.js";
import { AgentAction, PortalJob } from "../db/models.js";
import { canFallbackFromDatabaseError, shouldUseDatabase } from "../db/runtime.js";

type AuditInput = {
  actor: string;
  action: string;
  target: string;
  status: "success" | "failed" | "escalated";
};

export type AuditRecord = {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  target: string;
  status: "success" | "failed" | "escalated";
  hash: string;
  submissionId?: string;
  portalId?: string;
  beforeScreenshotUrl?: string | null;
  afterScreenshotUrl?: string | null;
};

function fromAgentAction(row: Record<string, unknown>, job?: Record<string, unknown>): AuditRecord {
  return {
    id: String(row.id),
    timestamp: new Date(row.createdAt as string | Date).toISOString(),
    actor: String(row.executedBy),
    action: String(row.actionType),
    target: String(row.portalJobId),
    status: row.status as "success" | "failed" | "escalated",
    hash: `sha256:${String(row.id).slice(-8)}`,
    submissionId: job?.submissionId ? String(job.submissionId) : undefined,
    portalId: job?.portalId ? String(job.portalId) : undefined,
    beforeScreenshotUrl: row.beforeScreenshotUrl ? String(row.beforeScreenshotUrl) : null,
    afterScreenshotUrl: row.afterScreenshotUrl ? String(row.afterScreenshotUrl) : null
  };
}

export async function listAuditLog(filters: AuditFilters = {}): Promise<AuditRecord[]> {
  let records: AuditRecord[];
  if (shouldUseDatabase()) {
    try {
      const rows = await AgentAction.findAll({ order: [["createdAt", "DESC"]], raw: true });
      const jobIds = [...new Set(rows.map((row) => String((row as unknown as Record<string, unknown>).portalJobId)))];
      const jobRows = await PortalJob.findAll({ where: { id: jobIds }, raw: true });
      const jobsById = new Map(jobRows.map((row) => [String((row as unknown as Record<string, unknown>).id), row as unknown as Record<string, unknown>]));
      records = rows.map((row) => {
        const action = row as unknown as Record<string, unknown>;
        return fromAgentAction(action, jobsById.get(String(action.portalJobId)));
      });
      return records.filter((record) => auditMatches(record, filters));
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  records = auditLog.map((record) => {
    const job = jobs.find((item) => item.id === record.target);
    return {
      ...record,
      status: record.status as AuditRecord["status"],
      submissionId: job?.submissionId,
      portalId: job?.portalId
    };
  });
  return records.filter((record) => auditMatches(record, filters));
}

export type AuditFilters = {
  actor?: string;
  action?: string;
  actionType?: string;
  target?: string;
  status?: "success" | "failed" | "escalated";
  submissionId?: string;
  portalId?: string;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
};

function auditMatches(record: AuditRecord, filters: AuditFilters) {
  if (filters.actor && !record.actor.toLowerCase().includes(filters.actor.toLowerCase())) return false;
  const actionFilter = filters.actionType ?? filters.action;
  if (actionFilter && !record.action.toLowerCase().includes(actionFilter.toLowerCase())) return false;
  if (filters.target && !record.target.toLowerCase().includes(filters.target.toLowerCase())) return false;
  if (filters.status && record.status !== filters.status) return false;
  if (filters.submissionId && record.submissionId !== filters.submissionId) return false;
  if (filters.portalId && record.portalId !== filters.portalId) return false;
  if (filters.dateFrom && new Date(record.timestamp) < new Date(filters.dateFrom)) return false;
  if (filters.dateTo && new Date(record.timestamp) > new Date(filters.dateTo)) return false;
  if (filters.q) {
    const query = filters.q.toLowerCase();
    return [record.id, record.timestamp, record.actor, record.action, record.target, record.status, record.hash, record.submissionId, record.portalId, record.beforeScreenshotUrl, record.afterScreenshotUrl]
      .some((value) => String(value).toLowerCase().includes(query));
  }
  return true;
}

function escapeCsvValue(value: unknown) {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export async function exportAuditCsv(filters: AuditFilters = {}) {
  const records = await listAuditLog(filters);
  const headers = ["id", "timestamp", "actor", "action", "target", "submissionId", "portalId", "status", "hash", "beforeScreenshotUrl", "afterScreenshotUrl"];
  const rows = records.map((record: AuditRecord) => headers.map((header) => escapeCsvValue(record[header as keyof AuditRecord])).join(","));
  return [headers.join(","), ...rows].join("\n");
}

export function recordAudit(input: AuditInput) {
  const record = {
    id: `AUD-${Math.floor(Math.random() * 90_000 + 10_000)}`,
    timestamp: new Date().toISOString(),
    hash: `sha256:${Math.random().toString(16).slice(2, 10)}`,
    ...input
  };
  auditLog.unshift(record);
  return record;
}
