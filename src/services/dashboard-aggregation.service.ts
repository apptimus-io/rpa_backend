import { DailyStat } from "../db/models.js";
import { canFallbackFromDatabaseError, shouldUseDatabase } from "../db/runtime.js";
import { listEscalations } from "./escalations.service.js";
import { listJobs } from "./jobs.service.js";
import { listSubmissions } from "./submissions.service.js";

export type DailyStatsRecord = {
  statDate: string;
  submissionsCount: number;
  completedCount: number;
  escalatedCount: number;
  failedJobsCount: number;
  pendingEscalationsCount: number;
  averageCompletionMinutes: number;
  operatorStats: Array<{
    operatorId: string;
    submissions: number;
    completed: number;
  }>;
};

function dateKey(value: Date | string) {
  return new Date(value).toISOString().slice(0, 10);
}

function previousDateKey(now = new Date()) {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - 1);
  return dateKey(date);
}

function toRecord(row: Record<string, unknown>): DailyStatsRecord {
  const rawOperatorStats = row.operatorStats ?? row.operator_stats;
  return {
    statDate: String(row.statDate ?? row.stat_date),
    submissionsCount: Number(row.submissionsCount ?? row.submissions_count ?? 0),
    completedCount: Number(row.completedCount ?? row.completed_count ?? 0),
    escalatedCount: Number(row.escalatedCount ?? row.escalated_count ?? 0),
    failedJobsCount: Number(row.failedJobsCount ?? row.failed_jobs_count ?? 0),
    pendingEscalationsCount: Number(row.pendingEscalationsCount ?? row.pending_escalations_count ?? 0),
    averageCompletionMinutes: Number(row.averageCompletionMinutes ?? row.average_completion_minutes ?? 0),
    operatorStats: Array.isArray(rawOperatorStats) ? rawOperatorStats as DailyStatsRecord["operatorStats"] : []
  };
}

export async function computeDailyStats(statDate: string): Promise<DailyStatsRecord> {
  const [submissions, jobs, escalations] = await Promise.all([
    listSubmissions(),
    listJobs(),
    listEscalations()
  ]);
  const daySubmissions = submissions.filter((submission) => dateKey(submission.createdAt) === statDate);
  const daySubmissionIds = new Set(daySubmissions.map((submission) => submission.id));
  const dayJobs = jobs.filter((job) => daySubmissionIds.has(job.submissionId));
  const operatorStats = Object.values(daySubmissions.reduce<Record<string, DailyStatsRecord["operatorStats"][number]>>((acc, submission) => {
    const operatorId = submission.createdBy ?? "unknown";
    acc[operatorId] ??= { operatorId, submissions: 0, completed: 0 };
    acc[operatorId].submissions += 1;
    if (submission.status === "completed") acc[operatorId].completed += 1;
    return acc;
  }, {}));

  return {
    statDate,
    submissionsCount: daySubmissions.length,
    completedCount: daySubmissions.filter((submission) => submission.status === "completed").length,
    escalatedCount: daySubmissions.filter((submission) => submission.status === "escalated").length,
    failedJobsCount: dayJobs.filter((job) => job.status === "failed").length,
    pendingEscalationsCount: escalations.filter((escalation) => escalation.status === "pending").length,
    averageCompletionMinutes: 0,
    operatorStats
  };
}

export async function upsertDailyStats(statDate: string) {
  const stats = await computeDailyStats(statDate);
  if (shouldUseDatabase()) {
    try {
      const [row] = await DailyStat.upsert(stats);
      return toRecord(row.get({ plain: true }) as Record<string, unknown>);
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }
  return stats;
}

export async function runNightlyDashboardAggregation(now = new Date()) {
  return upsertDailyStats(previousDateKey(now));
}
