import { listEscalations } from "./escalations.service.js";
import { listJobs } from "./jobs.service.js";

export type GeminiPromptReview = {
  portalId: string;
  escalationCount: number;
  lowConfidenceCount: number;
  recommendedPromptGuidance: string[];
};

function safeReason(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/password[=:]\s*[^,\s]+/gi, "password=[redacted]")
    .replace(/token[=:]\s*[^,\s]+/gi, "token=[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email-redacted]")
    .slice(0, 160);
}

export async function buildGeminiPromptReview(): Promise<GeminiPromptReview[]> {
  const [escalations, jobs] = await Promise.all([listEscalations(), listJobs()]);
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const byPortal = new Map<string, { reasons: string[]; lowConfidenceCount: number }>();

  for (const escalation of escalations) {
    const portalId = jobsById.get(escalation.jobId)?.portalId ?? "unknown";
    const entry = byPortal.get(portalId) ?? { reasons: [], lowConfidenceCount: 0 };
    entry.reasons.push(safeReason(escalation.reason));
    if (escalation.confidence < 70) {
      entry.lowConfidenceCount += 1;
    }
    byPortal.set(portalId, entry);
  }

  return [...byPortal.entries()].map(([portalId, entry]) => ({
    portalId,
    escalationCount: entry.reasons.length,
    lowConfidenceCount: entry.lowConfidenceCount,
    recommendedPromptGuidance: [
      "Keep Gemini fallback constrained to sanitized DOM labels, roles, fingerprints, and route context.",
      "Emphasize selector verification before acting; return low confidence when required fields are ambiguous.",
      ...[...new Set(entry.reasons)].slice(0, 3).map((reason) => `Review recurring escalation reason: ${reason}`)
    ]
  }));
}
