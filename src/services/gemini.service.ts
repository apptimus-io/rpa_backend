import { env } from "../config/env.js";

export type DomChangeReport = {
  addedFields: string[];
  removedFields: string[];
  renamedLabels: Array<{ from: string; to: string }>;
  movedFields: string[];
  changedInputTypes: Array<{ label: string; from?: string; to?: string }>;
  possibleAffectedMappings: string[];
  summary: string;
};

export type GeminiDomChangeRequest = {
  portalId: string;
  jobId: string;
  url: string;
  previousDomVersion: number;
  previousFingerprint: string;
  currentDomVersion: number;
  currentFingerprint: string;
  previousLabels: string[];
  currentLabels: string[];
  staleSignals: string[];
  reason: string;
};

export type GeminiDomChangeResult = {
  provider: "gemini";
  model: string;
  configured: boolean;
  confidence: number;
  changeReport: DomChangeReport;
};

export type GeminiMappingSuggestion = {
  normalizedTarget: string;
  newSelector: string;
  fallbackSelectors?: string[];
  confidence: "high" | "medium" | "low";
  reason: string;
  valueMap?: Record<string, string>;
  requiresHumanReview: boolean;
};

export type GeminiVisionField = {
  label: string;
  fieldType: "text" | "select" | "date" | "checkbox" | "file" | "button" | "table" | "unknown";
  visualLocation?: string;
  confidence: "high" | "medium" | "low";
  reason: string;
};

export type GeminiVisionAnalysis = {
  provider: "gemini_vlm";
  model: string;
  configured: boolean;
  screenshotUrl?: string | null;
  summary: string;
  visibleFieldGroups: string[];
  detectedFields: GeminiVisionField[];
  missingDomSignals: string[];
  layoutChanges: string[];
  selectorRisks: string[];
  recommendedHumanReview: string[];
  safety: {
    advisoryOnly: true;
    canPublishMapping: false;
    canSubmitForm: false;
  };
};

export function isGeminiConfigured() {
  return Boolean(env.GEMINI_API_KEY);
}

export function isGeminiVlmConfigured() {
  return Boolean(env.GEMINI_API_KEY && env.GEMINI_VLM_ENABLED);
}

function compareLabels(previousLabels: string[], currentLabels: string[]): DomChangeReport {
  const previous = new Set(previousLabels.map((label) => label.trim()).filter(Boolean));
  const current = new Set(currentLabels.map((label) => label.trim()).filter(Boolean));
  const addedFields = [...current].filter((label) => !previous.has(label));
  const removedFields = [...previous].filter((label) => !current.has(label));
  return {
    addedFields,
    removedFields,
    renamedLabels: [],
    movedFields: [],
    changedInputTypes: [],
    possibleAffectedMappings: [...addedFields, ...removedFields],
    summary: addedFields.length || removedFields.length
      ? "Visible portal labels changed. Human mapping review is required before automated submission."
      : "DOM fingerprint changed without visible label differences. Review layout and selectors before approval."
  };
}

export async function analyzeDomChange(input: GeminiDomChangeRequest): Promise<GeminiDomChangeResult> {
  const fallbackReport = compareLabels(input.previousLabels, input.currentLabels);
  if (!isGeminiConfigured()) {
    return {
      provider: "gemini",
      model: env.GEMINI_MODEL,
      configured: false,
      confidence: 0,
      changeReport: {
        ...fallbackReport,
        summary: "Gemini is not configured; deterministic DOM diff requires human review."
      }
    };
  }

  // Network calls are intentionally isolated here. The real Gemini client should
  // return only a change report, never final fill mappings or submitted values.
  return {
    provider: "gemini",
    model: env.GEMINI_MODEL,
    configured: true,
    confidence: 80,
    changeReport: {
      ...fallbackReport,
      summary: `Analyzed DOM version change v${input.previousDomVersion} -> v${input.currentDomVersion}. Human approval is required before changed DOM is used for submission.`
    }
  };
}

export async function suggestMappingDraftWithGemini(input: {
  portalId: string;
  portalName?: string;
  oldMapping: unknown;
  oldFields: unknown;
  newFields: unknown;
}): Promise<{ model: string; suggestions: GeminiMappingSuggestion[] } | null> {
  if (!isGeminiConfigured()) return null;
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = [
    "You are helping maintain a human-approved insurance portal automation mapping.",
    "Return advisory suggestions only. Do not invent selectors.",
    "Only use selectors that appear in NEW FORM FIELDS.",
    "Return ONLY valid JSON array items with normalizedTarget, newSelector, fallbackSelectors, confidence, reason, valueMap, requiresHumanReview.",
    `Portal: ${input.portalName ?? input.portalId}`,
    `OLD APPROVED MAPPING:\n${JSON.stringify(input.oldMapping, null, 2)}`,
    `OLD FORM FIELDS:\n${JSON.stringify(input.oldFields, null, 2)}`,
    `NEW FORM FIELDS:\n${JSON.stringify(input.newFields, null, 2)}`
  ].join("\n\n");

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });
    if (!response.ok) return null;
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return null;
    return {
      model: env.GEMINI_MODEL,
      suggestions: parsed.filter(isMappingSuggestion)
    };
  } catch {
    return null;
  }
}

export async function analyzePortalScreenshotWithGemini(input: {
  portalId: string;
  portalName?: string;
  snapshotId?: string;
  jobId?: string;
  screenshotUrl?: string | null;
  sanitizedDom?: string;
  extractedFields?: unknown;
  previousFields?: unknown;
  oldMapping?: unknown;
  reason?: string;
}): Promise<GeminiVisionAnalysis | null> {
  const model = env.GEMINI_VISION_MODEL ?? env.GEMINI_MODEL;
  if (!isGeminiVlmConfigured()) {
    return {
      provider: "gemini_vlm",
      model,
      configured: false,
      screenshotUrl: input.screenshotUrl ?? null,
      summary: "Gemini VLM is not configured; visual review requires manual inspection.",
      visibleFieldGroups: [],
      detectedFields: [],
      missingDomSignals: [],
      layoutChanges: [],
      selectorRisks: [],
      recommendedHumanReview: ["Manually review the portal screenshot and DOM fields before publishing mappings."],
      safety: { advisoryOnly: true, canPublishMapping: false, canSubmitForm: false }
    };
  }
  if (!input.screenshotUrl) return null;

  const image = await fetchImageAsInlineData(input.screenshotUrl);
  if (!image) return null;

  const prompt = [
    "You are a visual review assistant for an insurance portal automation mapping workflow.",
    "You may inspect the screenshot and DOM context, but you must return advisory review information only.",
    "Never approve a mapping. Never provide final live-submit instructions. Never invent selectors.",
    "Identify visible fields, field groups, buttons, visual layout issues, and places where DOM extraction may be missing fields.",
    "Return ONLY valid JSON with keys: summary, visibleFieldGroups, detectedFields, missingDomSignals, layoutChanges, selectorRisks, recommendedHumanReview.",
    "detectedFields items must be: { label, fieldType, visualLocation, confidence, reason }.",
    `Portal: ${input.portalName ?? input.portalId}`,
    `Snapshot: ${input.snapshotId ?? "unknown"}`,
    `Job: ${input.jobId ?? "unknown"}`,
    `Reason: ${input.reason ?? "visual mapping review"}`,
    `DOM extracted fields:\n${JSON.stringify(input.extractedFields ?? [], null, 2).slice(0, 8_000)}`,
    `Previous fields:\n${JSON.stringify(input.previousFields ?? [], null, 2).slice(0, 6_000)}`,
    `Old approved mapping:\n${JSON.stringify(input.oldMapping ?? {}, null, 2).slice(0, 8_000)}`,
    `Sanitized DOM excerpt:\n${String(input.sanitizedDom ?? "").slice(0, 8_000)}`
  ].join("\n\n");

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY ?? "")}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: image }
          ]
        }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });
    if (!response.ok) return null;
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    const parsed = parseGeminiJsonObject(text);
    if (!parsed) return null;
    return normalizeVisionAnalysis(parsed, model, input.screenshotUrl);
  } catch {
    return null;
  }
}

async function fetchImageAsInlineData(url: string): Promise<{ mimeType: string; data: string } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "image/png";
    if (!contentType.startsWith("image/")) return null;
    const data = Buffer.from(await response.arrayBuffer()).toString("base64");
    return { mimeType: contentType.split(";")[0] || "image/png", data };
  } catch {
    return null;
  }
}

function parseGeminiJsonObject(text: string) {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

function normalizeVisionAnalysis(value: Record<string, unknown>, model: string, screenshotUrl: string): GeminiVisionAnalysis {
  const fields = Array.isArray(value.detectedFields) ? value.detectedFields : [];
  return {
    provider: "gemini_vlm",
    model,
    configured: true,
    screenshotUrl,
    summary: String(value.summary ?? "Gemini VLM analyzed the portal screenshot for advisory review."),
    visibleFieldGroups: stringArray(value.visibleFieldGroups),
    detectedFields: fields
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
      .map((item) => ({
        label: String(item.label ?? "Unlabelled field"),
        fieldType: normalizeVisionFieldType(item.fieldType),
        visualLocation: item.visualLocation ? String(item.visualLocation) : undefined,
        confidence: normalizeVisionConfidence(item.confidence),
        reason: String(item.reason ?? "Detected visually from portal screenshot.")
      })),
    missingDomSignals: stringArray(value.missingDomSignals),
    layoutChanges: stringArray(value.layoutChanges),
    selectorRisks: stringArray(value.selectorRisks),
    recommendedHumanReview: stringArray(value.recommendedHumanReview),
    safety: { advisoryOnly: true, canPublishMapping: false, canSubmitForm: false }
  };
}

function normalizeVisionFieldType(value: unknown): GeminiVisionField["fieldType"] {
  const fieldType = String(value ?? "unknown").toLowerCase();
  if (["text", "select", "date", "checkbox", "file", "button", "table"].includes(fieldType)) return fieldType as GeminiVisionField["fieldType"];
  return "unknown";
}

function normalizeVisionConfidence(value: unknown): GeminiVisionField["confidence"] {
  const confidence = String(value ?? "low").toLowerCase();
  return confidence === "high" || confidence === "medium" ? confidence : "low";
}

function isMappingSuggestion(value: unknown): value is GeminiMappingSuggestion {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.normalizedTarget === "string"
    && typeof record.newSelector === "string"
    && ["high", "medium", "low"].includes(String(record.confidence))
    && typeof record.reason === "string";
}
