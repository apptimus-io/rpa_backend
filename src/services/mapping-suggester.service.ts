import { AgentAction, Escalation, PortalFieldMapping } from "../db/models.js";
import { getDomSnapshot, getDomSnapshotFields } from "./agent-dom.service.js";
import { getJob } from "./jobs.service.js";
import { savePortalFieldMapping } from "./member-data.service.js";
import { analyzePortalScreenshotWithGemini, isGeminiConfigured, isGeminiVlmConfigured, suggestMappingDraftWithGemini, type GeminiMappingSuggestion, type GeminiVisionAnalysis } from "./gemini.service.js";

type Selector = { strategy: "role" | "label" | "css"; value: string; priority?: number };
type ExtractedField = { label: string; type: string; selectorCandidates: Selector[] };
type MappingField = {
  target: string;
  type: string;
  required: boolean;
  selectors: Selector[];
  valueMap?: Record<string, string>;
  transform?: Record<string, unknown>;
  verification?: Record<string, unknown>;
  aiSuggestion?: {
    confidence: "high" | "medium" | "low";
    reason: string;
    requiresHumanReview: boolean;
  };
};

function normalize(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function targetHint(target: string) {
  const last = target.split(".").at(-1) ?? target;
  return normalize(last.replace(/([a-z])([A-Z])/g, "$1 $2"));
}

function scoreField(oldField: MappingField, candidate: ExtractedField) {
  const target = targetHint(oldField.target);
  const label = normalize(candidate.label);
  const typeMatches = normalizeMappingType(candidate.type) === normalizeMappingType(oldField.type);
  let score = typeMatches ? 25 : 0;
  if (label === target) score += 60;
  if (label.includes(target) || target.includes(label)) score += 35;
  for (const token of target.split(" ").filter((item) => item.length > 2)) {
    if (label.includes(token)) score += 8;
  }
  return score;
}

function normalizeMappingType(value: unknown) {
  const type = String(value ?? "text").toLowerCase();
  if (type === "phone" || type === "email" || type === "number") return "text";
  if (type === "button") return "button";
  if (type === "select") return "select";
  if (type === "date") return "date";
  if (type === "checkbox") return "checkbox";
  if (type === "file") return "file";
  return "text";
}

function selectorReason(oldField: MappingField, candidate: ExtractedField, score: number) {
  const confidence = score >= 70 ? "high" : score >= 45 ? "medium" : "low";
  return {
    confidence: confidence as "high" | "medium" | "low",
    reason: `${oldField.target} matched to "${candidate.label}" by label/type similarity. Review before publishing.`,
    requiresHumanReview: confidence !== "high"
  };
}

function cloneFieldWithSuggestion(oldField: MappingField, candidate: ExtractedField | undefined, score: number): MappingField {
  if (!candidate || !candidate.selectorCandidates.length) {
    return {
      ...oldField,
      selectors: [],
      aiSuggestion: {
        confidence: "low",
        reason: "No safe selector candidate was found in the new DOM snapshot.",
        requiresHumanReview: true
      }
    };
  }
  return {
    ...oldField,
    type: normalizeMappingType(candidate.type),
    selectors: candidate.selectorCandidates.map((selector, index) => ({ ...selector, priority: index + 1 })),
    aiSuggestion: selectorReason(oldField, candidate, score)
  };
}

function cloneFieldWithGeminiSuggestion(oldField: MappingField, suggestion: GeminiMappingSuggestion, newFields: ExtractedField[]): MappingField | null {
  const allowedSelectors = newFields.flatMap((field) => field.selectorCandidates);
  const preferred = [suggestion.newSelector, ...(suggestion.fallbackSelectors ?? [])]
    .map((selectorValue) => allowedSelectors.find((selector) => selector.value === selectorValue))
    .filter(Boolean) as Selector[];
  if (!preferred.length) return null;
  return {
    ...oldField,
    selectors: preferred.map((selector, index) => ({ ...selector, priority: index + 1 })),
    ...(suggestion.valueMap ? { valueMap: suggestion.valueMap } : {}),
    aiSuggestion: {
      confidence: suggestion.confidence,
      reason: suggestion.reason,
      requiresHumanReview: suggestion.requiresHumanReview || suggestion.confidence !== "high"
    }
  };
}

function suggestSubmit(oldSubmit: Record<string, unknown>, fields: ExtractedField[]) {
  const submit = fields.find((field) => field.type === "button" && /quote|submit|generate|proceed|download/i.test(field.label))
    ?? fields.find((field) => field.type === "button");
  if (!submit?.selectorCandidates.length) return oldSubmit;
  return {
    ...oldSubmit,
    selectors: submit.selectorCandidates.map((selector, index) => ({ ...selector, priority: index + 1 })),
    aiSuggestion: {
      confidence: /quote|submit|generate/i.test(submit.label) ? "high" : "medium",
      reason: `Submit action matched to "${submit.label}" from the new DOM snapshot.`,
      requiresHumanReview: true
    }
  };
}

export async function suggestMappingForEscalation(escalationId: string, actor = "ai-suggester") {
  const escalation = await Escalation.findByPk(escalationId, { raw: true });
  if (!escalation) return null;
  const escalationRow = escalation as unknown as Record<string, unknown>;

  const jobId = String(escalationRow.portalJobId ?? "");
  const job = await getJob(jobId);
  if (!job?.portalId) return null;

  const newSnapshotId = String(escalationRow.newSnapshotId ?? "");
  const newSnapshot = newSnapshotId ? await getDomSnapshot(newSnapshotId) : null;
  const fieldPayload = newSnapshot ? await getDomSnapshotFields(newSnapshot.id) : null;
  if (!newSnapshot || !fieldPayload) return null;

  const result = await createDraftSuggestion({
    portalId: job.portalId,
    snapshotId: newSnapshot.id,
    escalationId,
    metadata: (escalationRow.metadata as Record<string, unknown> | null) ?? {},
    actor
  });
  if (!result) return null;

  await Escalation.update(
    {
      draftMappingId: result.draftMappingId,
      metadata: {
        ...((escalationRow.metadata as Record<string, unknown> | null) ?? {}),
        aiSuggestion: {
          status: "draft_ready",
          draftMappingId: result.draftMappingId,
          model: result.model
        }
      }
    },
    { where: { id: escalationId } }
  );

  return result;
}

export async function suggestMappingForSnapshot(snapshotId: string, actor = "admin") {
  const snapshot = await getDomSnapshot(snapshotId);
  if (!snapshot) return null;
  return createDraftSuggestion({
    portalId: snapshot.portalId,
    snapshotId,
    escalationId: null,
    metadata: {},
    actor
  });
}

export async function analyzeSnapshotWithVision(snapshotId: string) {
  const snapshot = await getDomSnapshot(snapshotId);
  if (!snapshot) return null;
  const fields = await getDomSnapshotFields(snapshot.id);
  const screenshotUrl = await latestScreenshotForJob(snapshot.jobId);
  return analyzePortalScreenshotWithGemini({
    portalId: snapshot.portalId,
    snapshotId: snapshot.id,
    jobId: snapshot.jobId,
    screenshotUrl,
    sanitizedDom: snapshot.sanitizedDom,
    extractedFields: fields?.fields ?? [],
    reason: "Manual vision analysis from DOM review"
  });
}

async function createDraftSuggestion(input: { portalId: string; snapshotId: string; escalationId: string | null; metadata: Record<string, unknown>; actor: string }) {
  const newSnapshot = await getDomSnapshot(input.snapshotId);
  const fieldPayload = newSnapshot ? await getDomSnapshotFields(newSnapshot.id) : null;
  if (!newSnapshot || !fieldPayload) return null;

  const parentSnapshot = newSnapshot.parentSnapshotId ? await getDomSnapshot(newSnapshot.parentSnapshotId) : null;
  const previousMapping = await PortalFieldMapping.findOne({
    where: {
      portalId: input.portalId,
      ...(parentSnapshot?.id ? { domSnapshotId: parentSnapshot.id } : {}),
      status: "published"
    },
    order: [["mappingVersion", "DESC"]],
    raw: true
  }) as Record<string, unknown> | null;

  if (!previousMapping) return null;
  const previousMappings = previousMapping.mappings as { fields?: MappingField[]; submit?: Record<string, unknown> };
  const previousFields = Array.isArray(previousMappings.fields) ? previousMappings.fields : [];
  const newFields = fieldPayload.fields as ExtractedField[];
  const parentFields = parentSnapshot ? (await getDomSnapshotFields(parentSnapshot.id))?.fields ?? [] : [];
  const screenshotUrl = await latestScreenshotForJob(newSnapshot.jobId);
  const gemini = await suggestMappingDraftWithGemini({
    portalId: input.portalId,
    oldMapping: previousMappings,
    oldFields: parentFields,
    newFields
  });
  const vision = await analyzePortalScreenshotWithGemini({
    portalId: input.portalId,
    snapshotId: newSnapshot.id,
    jobId: newSnapshot.jobId,
    screenshotUrl,
    sanitizedDom: newSnapshot.sanitizedDom,
    extractedFields: newFields,
    previousFields: parentFields,
    oldMapping: previousMappings,
    reason: input.escalationId ? "Escalation mapping review" : "Manual mapping review"
  });
  const geminiByTarget = new Map((gemini?.suggestions ?? []).map((suggestion) => [suggestion.normalizedTarget, suggestion]));

  const suggestedFields = previousFields.map((oldField) => {
    const geminiSuggestion = geminiByTarget.get(oldField.target);
    if (geminiSuggestion) {
      const safeSuggestion = cloneFieldWithGeminiSuggestion(oldField, geminiSuggestion, newFields);
      if (safeSuggestion) return safeSuggestion;
    }
    const ranked = newFields
      .filter((field) => normalizeMappingType(field.type) === normalizeMappingType(oldField.type) || oldField.type !== "select")
      .map((field) => ({ field, score: scoreField(oldField, field) }))
      .sort((left, right) => right.score - left.score)[0];
    return cloneFieldWithSuggestion(oldField, ranked?.field, ranked?.score ?? 0);
  });

  const draft = await savePortalFieldMapping({
    portalId: input.portalId,
    coverageType: String(previousMapping.coverageType),
    domSnapshotId: newSnapshot.id,
    mappings: {
      fields: suggestedFields,
      submit: suggestSubmit(previousMappings.submit ?? { type: "button", selectors: [] }, newFields),
      advisory: advisoryPayload({ geminiModel: gemini?.model, vision })
    },
    requiredFields: Array.isArray(previousMapping.requiredFields) ? previousMapping.requiredFields as string[] : [],
    status: "draft",
    aiSuggested: true,
    aiModel: modelLabel(gemini?.model, vision),
    escalationId: input.escalationId,
    parentMappingId: String(previousMapping.id)
  }, input.actor);

  return {
    draftMappingId: String((draft as Record<string, unknown>).id),
    mapping: draft,
    model: modelLabel(gemini?.model, vision),
    reviewRequired: suggestedFields.some((field) => field.aiSuggestion?.requiresHumanReview) || Boolean(vision?.recommendedHumanReview.length)
  };
}

async function latestScreenshotForJob(jobId: string) {
  if (!jobId) return null;
  try {
    const actions = await AgentAction.findAll({
      where: { portalJobId: jobId },
      order: [["createdAt", "DESC"]],
      limit: 20,
      raw: true
    }) as unknown as Array<Record<string, unknown>>;
    for (const action of actions) {
      if (action.afterScreenshotUrl) return String(action.afterScreenshotUrl);
      if (action.beforeScreenshotUrl) return String(action.beforeScreenshotUrl);
    }
    return null;
  } catch {
    return null;
  }
}

function advisoryPayload(input: { geminiModel?: string; vision: GeminiVisionAnalysis | null }) {
  return {
    policy: "advisory_only_human_approval_required",
    textModel: input.geminiModel ?? (isGeminiConfigured() ? "gemini-unavailable" : "not-configured"),
    visionModel: input.vision?.model ?? (isGeminiVlmConfigured() ? "gemini-vlm-unavailable" : "not-configured"),
    visionAnalysis: input.vision,
    safety: {
      aiCanPublishMapping: false,
      aiCanSubmitForm: false,
      approvedMappingRequired: true
    }
  };
}

function modelLabel(geminiModel?: string, vision?: GeminiVisionAnalysis | null) {
  const textModel = geminiModel ?? (isGeminiConfigured() ? "gemini-unavailable-deterministic-advisory" : "deterministic-advisory");
  return vision?.configured ? `${textModel}+${vision.model}-vlm` : textModel;
}
