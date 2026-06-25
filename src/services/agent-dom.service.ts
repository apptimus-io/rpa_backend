import { createHash } from "node:crypto";
import { auditLog } from "../data/demo-data.js";
import { DomSnapshot } from "../db/models.js";
import { canFallbackFromDatabaseError, shouldUseDatabase } from "../db/runtime.js";
import { createEscalation } from "./escalations.service.js";
import { analyzeDomChange, type DomChangeReport } from "./gemini.service.js";
import { getJob } from "./jobs.service.js";

export type DomSnapshotInput = {
  portalId: string;
  jobId: string;
  url: string;
  step: string;
  sanitizedDom: string;
  visibleLabels: string[];
  frameCount?: number;
  frameMetadata?: Array<Record<string, unknown>>;
};

export type DomSnapshotRecord = DomSnapshotInput & {
  id: string;
  fingerprint: string;
  domVersion: number;
  parentSnapshotId?: string | null;
  routeFingerprint?: string | null;
  status: DomSnapshotStatus;
  changeReport?: DomChangeReport | null;
  createdAt: string;
};

export type DomSnapshotStatus = "observed" | "unchanged" | "changed_pending_review" | "approved" | "superseded";

export type PageStateCache = {
  cacheKey: string;
  portalId: string;
  jobId: string;
  url: string;
  routeFingerprint: string;
  step: string;
  domFingerprint: string;
  visibleTextFingerprint: string;
  fieldCount: number;
  visibleLabels: string[];
  modalState: "none" | "present";
  dynamicState: "stable" | "changed";
  paginationState: "single" | "multi";
  lastVerifiedAt: string;
};

export type DomMatchInput = {
  portalId: string;
  jobId: string;
  url: string;
  step: string;
  currentSanitizedDom: string;
  visibleLabels: string[];
  frameCount?: number;
  frameMetadata?: Array<Record<string, unknown>>;
  reason: string;
};

const snapshots: DomSnapshotRecord[] = [
  {
    id: "dom_001",
    portalId: "por_axa",
    jobId: "JOB-9091",
    url: "https://portal.example/axa/quote",
    step: "risk_details",
    sanitizedDom: "<form><label>Business category</label><select></select><label>Vehicle count</label><input /></form>",
    visibleLabels: ["Business category", "Vehicle count"],
    fingerprint: "sha256:2d44ab21",
    domVersion: 1,
    parentSnapshotId: null,
    routeFingerprint: "sha256:seedroute",
    status: "approved",
    changeReport: null,
    createdAt: "2026-06-01T08:18:32.000Z"
  }
];

function fingerprint(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 8)}`;
}

function sanitizeDomCopy(value: string) {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email-redacted]")
    .replace(/\b(password|token|secret|authorization)\s*=\s*["'][^"']*["']/gi, '$1="[redacted]"')
    .replace(/(<input[^>]+type=["']password["'][^>]*value=)["'][^"']*["']/gi, '$1"[redacted]"')
    .slice(0, 20_000);
}

function stableDomFingerprint(sanitizedDom: string, visibleLabels: string[]) {
  return fingerprint(stableDomSignature(sanitizedDom, visibleLabels));
}

function stableDomSignature(sanitizedDom: string, visibleLabels: string[]) {
  const dom = decodeHtmlForExtraction(sanitizeDomCopy(sanitizedDom))
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const fields = extractFieldsFromSanitizedDom(dom, visibleLabels)
    .map((field) => ({
      label: normalizeSignatureText(field.label),
      type: normalizeSignatureText(field.type),
      selectorHints: field.selectorCandidates
        .filter((selector) => selector.strategy !== "css" || !isVolatileSelector(selector.value))
        .map((selector) => `${selector.strategy}:${normalizeSignatureText(selector.value)}`)
        .sort()
    }))
    .filter((field) => field.label)
    .sort((left, right) => `${left.type}:${left.label}`.localeCompare(`${right.type}:${right.label}`));
  if (fields.length) {
    return JSON.stringify({ fields });
  }
  return normalizeSignatureText(cleanText(dom)).slice(0, 4_000);
}

function stableFieldKeys(sanitizedDom: string, visibleLabels: string[]) {
  const dom = decodeHtmlForExtraction(sanitizeDomCopy(sanitizedDom))
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ");
  return extractFieldsFromSanitizedDom(dom, visibleLabels)
    .filter((field) => field.type !== "button")
    .map((field) => `${normalizeSignatureText(field.type)}:${normalizeSignatureText(field.label)}`)
    .filter(Boolean)
    .sort();
}

function fieldCompatibilityScore(leftDom: string, leftLabels: string[], rightDom: string, rightLabels: string[]) {
  const left = new Set(stableFieldKeys(leftDom, leftLabels));
  const right = new Set(stableFieldKeys(rightDom, rightLabels));
  if (!left.size && !right.size) return 0;
  const intersection = [...left].filter((key) => right.has(key)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function usableFieldCount(sanitizedDom: string, visibleLabels: string[]) {
  return stableFieldKeys(sanitizedDom, visibleLabels).length;
}

function normalizeSignatureText(value: string) {
  return value
    .toLowerCase()
    .replace(/\b\d{5,}\b/g, "[number]")
    .replace(/\b[a-f0-9]{8,}\b/g, "[hash]")
    .replace(/\b[a-z0-9_-]{12,}\b/gi, "[token]")
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/\s+/g, " ")
    .trim();
}

function isVolatileSelector(value: string) {
  return /#__next|data-react|data-v-|data-testid|lovable|:[a-z0-9_-]{8,}|\\[a-f0-9]{4,}/i.test(value);
}

function normalizedLabels(labels: string[]) {
  return labels.map((label) => label.trim()).filter(Boolean);
}

function fieldCountFromDom(sanitizedDom: string, labels: string[]) {
  const explicitFields = (decodeHtmlForExtraction(sanitizedDom).match(/<(input|select|textarea|button)\b/gi) ?? []).length;
  return Math.max(explicitFields, labels.length);
}

function modalStateFromDom(sanitizedDom: string): PageStateCache["modalState"] {
  return /role=["']dialog["']|aria-modal=["']true["']|class=["'][^"']*(modal|dialog)/i.test(sanitizedDom) ? "present" : "none";
}

function paginationStateFromDom(sanitizedDom: string): PageStateCache["paginationState"] {
  return /aria-label=["']pagination["']|data-page=|next page|previous page/i.test(sanitizedDom) ? "multi" : "single";
}

function routeFingerprint(url: string) {
  const parsed = new URL(url);
  return fingerprint(`${parsed.origin}${parsed.pathname}`);
}

const emptyChangeReport: DomChangeReport = {
  addedFields: [],
  removedFields: [],
  renamedLabels: [],
  movedFields: [],
  changedInputTypes: [],
  possibleAffectedMappings: [],
  summary: "No DOM change detected."
};

export function buildPageStateCache(input: DomSnapshotInput): PageStateCache {
  const visibleLabels = normalizedLabels(input.visibleLabels);
  const sanitizedDom = sanitizeDomCopy(input.sanitizedDom);
  const domFingerprint = stableDomFingerprint(sanitizedDom, visibleLabels);
  const routeHash = routeFingerprint(input.url);
  return {
    cacheKey: `${input.portalId}:${input.step}:${routeHash}:${domFingerprint}`,
    portalId: input.portalId,
    jobId: input.jobId,
    url: input.url,
    routeFingerprint: routeHash,
    step: input.step,
    domFingerprint,
    visibleTextFingerprint: fingerprint(visibleLabels.join("|").toLowerCase()),
    fieldCount: fieldCountFromDom(sanitizedDom, visibleLabels),
    visibleLabels,
    modalState: modalStateFromDom(sanitizedDom),
    dynamicState: "stable",
    paginationState: paginationStateFromDom(sanitizedDom),
    lastVerifiedAt: new Date().toISOString()
  };
}

function staleSignals(previous: DomSnapshotRecord | undefined, current: PageStateCache) {
  if (!previous) {
    return ["missing_cache"];
  }

  const previousCache = buildPageStateCache(previous);
  return [
    previousCache.routeFingerprint !== current.routeFingerprint ? "route_changed" : null,
    previousCache.domFingerprint !== current.domFingerprint ? "dom_fingerprint_changed" : null,
    previousCache.visibleTextFingerprint !== current.visibleTextFingerprint ? "visible_labels_changed" : null,
    previousCache.fieldCount !== current.fieldCount ? "field_count_changed" : null,
    previousCache.modalState !== current.modalState ? "modal_state_changed" : null,
    previousCache.paginationState !== current.paginationState ? "pagination_state_changed" : null
  ].filter(Boolean) as string[];
}

function audit(action: string, target: string, status: "success" | "failed" | "escalated") {
  auditLog.unshift({
    id: `AUD-${Math.floor(Math.random() * 90_000 + 10_000)}`,
    timestamp: new Date().toISOString(),
    actor: "agent",
    action,
    target,
    status,
    hash: fingerprint(`${action}:${target}:${Date.now()}`)
  });
}

function fromModel(row: Record<string, unknown>): DomSnapshotRecord {
  return {
    id: String(row.id),
    portalId: String(row.portalId),
    jobId: String(row.portalJobId ?? ""),
    url: String(row.url),
    step: String(row.step),
    sanitizedDom: String(row.sanitizedDom),
    visibleLabels: Array.isArray(row.visibleLabels) ? row.visibleLabels as string[] : [],
    fingerprint: String(row.fingerprint),
    domVersion: Number(row.domVersion ?? 1),
    parentSnapshotId: row.parentSnapshotId ? String(row.parentSnapshotId) : null,
    routeFingerprint: row.routeFingerprint ? String(row.routeFingerprint) : null,
    status: (row.status ? String(row.status) : "observed") as DomSnapshotStatus,
    changeReport: row.changeReport as DomChangeReport | null ?? null,
    frameCount: Number(row.frameCount ?? 0),
    frameMetadata: Array.isArray(row.frameMetadata) ? row.frameMetadata as Array<Record<string, unknown>> : [],
    createdAt: new Date(row.createdAt as string | Date).toISOString()
  };
}

async function latestSnapshotFor(input: { portalId: string; step: string; routeFingerprint: string }) {
  const all = await listDomSnapshots();
  return all
    .filter((snapshot) => snapshot.portalId === input.portalId && snapshot.step === input.step && (snapshot.routeFingerprint ?? routeFingerprint(snapshot.url)) === input.routeFingerprint)
    .sort((left, right) => right.domVersion - left.domVersion || new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];
}

async function matchingSnapshotFor(input: { portalId: string; step: string; routeFingerprint: string; fingerprint: string }) {
  const all = await listDomSnapshots();
  return all
    .filter((snapshot) => snapshot.portalId === input.portalId && snapshot.step === input.step && (snapshot.routeFingerprint ?? routeFingerprint(snapshot.url)) === input.routeFingerprint)
    .filter((snapshot) => effectiveSnapshotFingerprint(snapshot) === input.fingerprint)
    .sort((left, right) => statusRank(right.status) - statusRank(left.status) || right.domVersion - left.domVersion || new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];
}

async function compatibleApprovedSnapshotFor(input: { portalId: string; step: string; routeFingerprint: string; sanitizedDom: string; visibleLabels: string[] }) {
  const all = await listDomSnapshots();
  return all
    .filter((snapshot) => snapshot.status === "approved")
    .filter((snapshot) => snapshot.portalId === input.portalId && snapshot.step === input.step && (snapshot.routeFingerprint ?? routeFingerprint(snapshot.url)) === input.routeFingerprint)
    .map((snapshot) => ({
      snapshot,
      score: fieldCompatibilityScore(snapshot.sanitizedDom, snapshot.visibleLabels, input.sanitizedDom, input.visibleLabels)
    }))
    .filter((item) => item.score >= 0.92)
    .sort((left, right) => right.score - left.score || right.snapshot.domVersion - left.snapshot.domVersion || new Date(right.snapshot.createdAt).getTime() - new Date(left.snapshot.createdAt).getTime())[0];
}

function effectiveSnapshotFingerprint(snapshot: DomSnapshotRecord) {
  const visibleLabels = normalizedLabels(snapshot.visibleLabels);
  const stable = stableDomFingerprint(snapshot.sanitizedDom, visibleLabels);
  return stable || snapshot.fingerprint;
}

function statusRank(status: DomSnapshotStatus) {
  if (status === "approved") return 5;
  if (status === "unchanged") return 4;
  if (status === "observed") return 3;
  if (status === "changed_pending_review") return 2;
  return 1;
}

async function ensureDomReviewEscalation(input: { jobId: string; portalId: string; step: string; domVersion: number; confidence: number; newSnapshotId?: string | null; metadata?: Record<string, unknown> | null }) {
  const job = await getJob(input.jobId);
  if (!job) return null;
  const escalation = await createEscalation({
    jobId: input.jobId,
    submissionId: job.submissionId,
    type: "dom_changed",
    portalId: input.portalId,
    newSnapshotId: input.newSnapshotId ?? null,
    metadata: input.metadata ?? null,
    reason: `Portal DOM changed for ${input.portalId}/${input.step}. Submission blocked until DOM version v${input.domVersion} is reviewed.`,
    suggestedAction: "Review old vs new sanitized DOM, confirm approved mappings, then approve the DOM version.",
    confidence: input.confidence
  });
  audit("dom_mapping_escalated", input.jobId, "escalated");
  return escalation.id;
}

export async function storeDomSnapshot(input: DomSnapshotInput & { domVersion?: number; parentSnapshotId?: string | null; routeFingerprint?: string | null; status?: DomSnapshotStatus; changeReport?: DomChangeReport | null }) {
  const sanitizedDom = sanitizeDomCopy(input.sanitizedDom);
  const visibleLabels = normalizedLabels(input.visibleLabels);
  const computedRouteFingerprint = input.routeFingerprint ?? routeFingerprint(input.url);
  const computedFingerprint = stableDomFingerprint(sanitizedDom, visibleLabels);
  const record: DomSnapshotRecord = {
    id: `dom_${Math.floor(Math.random() * 90_000 + 10_000)}`,
    portalId: input.portalId,
    jobId: input.jobId,
    url: input.url,
    step: input.step,
    sanitizedDom,
    visibleLabels,
    fingerprint: computedFingerprint,
    domVersion: input.domVersion ?? 1,
    parentSnapshotId: input.parentSnapshotId ?? null,
    routeFingerprint: computedRouteFingerprint,
    status: input.status ?? "observed",
    changeReport: input.changeReport ?? null,
    frameCount: Number(input.frameCount ?? 0),
    frameMetadata: Array.isArray(input.frameMetadata) ? input.frameMetadata : [],
    createdAt: new Date().toISOString()
  };

  if (shouldUseDatabase()) {
    try {
      const linkedJob = await getJob(record.jobId);
      const row = await DomSnapshot.create({
        id: record.id,
        portalId: record.portalId,
        portalJobId: linkedJob ? record.jobId : null,
        url: record.url,
        step: record.step,
        sanitizedDom: record.sanitizedDom,
        visibleLabels: record.visibleLabels,
        fingerprint: record.fingerprint,
        domVersion: record.domVersion,
        parentSnapshotId: record.parentSnapshotId,
        routeFingerprint: record.routeFingerprint,
        status: record.status,
        changeReport: record.changeReport,
        frameCount: record.frameCount,
        frameMetadata: record.frameMetadata
      });
      audit("dom_snapshot_stored", input.jobId, "success");
      return fromModel(row.get({ plain: true }) as unknown as Record<string, unknown>);
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  snapshots.unshift(record);
  audit("dom_snapshot_stored", input.jobId, "success");
  return record;
}

export async function listDomSnapshots() {
  if (shouldUseDatabase()) {
    try {
      const rows = await DomSnapshot.findAll({ order: [["createdAt", "DESC"]], raw: true });
      return rows.map((row) => fromModel(row as unknown as Record<string, unknown>));
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  return snapshots;
}

export async function getDomSnapshot(id: string) {
  const all = await listDomSnapshots();
  return all.find((snapshot) => snapshot.id === id) ?? null;
}

export async function getDomSnapshotFields(id: string) {
  const snapshot = await getDomSnapshot(id);
  if (!snapshot) return null;
  return {
    snapshot,
    fields: extractFieldsFromSanitizedDom(snapshot.sanitizedDom, snapshot.visibleLabels)
  };
}

function extractFieldsFromSanitizedDom(sanitizedDom: string, visibleLabels: string[]) {
  const dom = decodeHtmlForExtraction(sanitizedDom);
  const fields: Array<{ label: string; type: string; selectorCandidates: Array<{ strategy: "role" | "label" | "css"; value: string }> }> = [];
  const byLabelFor = new Map<string, string>();
  for (const match of dom.matchAll(/<label\b([^>]*)>(.*?)<\/label>/gi)) {
    const targetId = /for=["']([^"']+)["']/i.exec(match[1])?.[1];
    const labelText = cleanText(match[2]);
    if (targetId && labelText) byLabelFor.set(targetId, labelText);
  }

  const controlPattern = /<(input|select|textarea)\b([^>]*)>|<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let fallbackIndex = 1;
  for (const match of dom.matchAll(controlPattern)) {
    const tag = (match[1] ?? "button").toLowerCase();
    const attrs = match[2] ?? match[3] ?? "";
    const buttonText = cleanText(match[4] ?? "");
    const name = /name=["']([^"']+)["']/i.exec(attrs)?.[1];
    const idAttr = /id=["']([^"']+)["']/i.exec(attrs)?.[1];
    const aria = /aria-label=["']([^"']+)["']/i.exec(attrs)?.[1];
    const ariaLabelledBy = /aria-labelledby=["']([^"']+)["']/i.exec(attrs)?.[1];
    const placeholder = /placeholder=["']([^"']+)["']/i.exec(attrs)?.[1];
    const title = /title=["']([^"']+)["']/i.exec(attrs)?.[1];
    const rawType = tag === "select" ? "select" : tag === "button" ? "button" : /type=["']([^"']+)["']/i.exec(attrs)?.[1] ?? tag;
    const type = normalizeControlType(tag, rawType);
    const associatedLabel = idAttr ? byLabelFor.get(idAttr) : undefined;
    const labelledByText = ariaLabelledBy ? textForElementId(dom, ariaLabelledBy) : undefined;
    const wrappingLabel = inferWrappingLabel(dom, match.index ?? 0);
    const nearby = inferNearbyText(dom, match.index ?? 0);
    const attrLabel = humanizeName(name ?? idAttr ?? "");
    const label = firstUsefulText([aria, associatedLabel, labelledByText, placeholder, title, buttonText, wrappingLabel, nearby, attrLabel]) ?? `Field ${fallbackIndex++}`;
    fields.push({
      label,
      type,
      selectorCandidates: [
        ...roleCandidates(type, label),
        ...firstUsefulTexts([aria, associatedLabel, labelledByText, placeholder, title, buttonText]).map((value) => ({ strategy: "label" as const, value })),
        ...(placeholder ? [{ strategy: "css" as const, value: `${tag}[placeholder="${cssAttributeValue(placeholder)}"]` }] : []),
        ...(idAttr ? [{ strategy: "css" as const, value: `#${cssEscape(idAttr)}` }] : []),
        ...(name ? [{ strategy: "css" as const, value: `${tag}[name="${cssAttributeValue(name)}"]` }] : []),
        ...(buttonText ? [{ strategy: "role" as const, value: `button:${buttonText}` }] : [])
      ].filter((candidate) => candidate.value)
    });
  }

  for (const visibleLabel of visibleLabels) {
    const label = cleanText(visibleLabel);
    if (!label || fields.some((field) => sameLabel(field.label, label))) continue;
    fields.push({
      label,
      type: "text",
      selectorCandidates: [
        { strategy: "label", value: label },
        { strategy: "role", value: `textbox:${label}` }
      ]
    });
  }

  return dedupeFields(fields);
}

function decodeHtmlForExtraction(value: string) {
  return value
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function normalizeControlType(tag: string, rawType: string) {
  const normalized = rawType.toLowerCase();
  if (tag === "select") return "select";
  if (tag === "textarea") return "text";
  if (tag === "button" || normalized === "submit" || normalized === "button") return "button";
  if (["email", "tel", "phone", "date", "number", "checkbox", "file"].includes(normalized)) {
    return normalized === "tel" ? "phone" : normalized;
  }
  return "text";
}

function roleCandidates(type: string, label: string) {
  const role = type === "button"
    ? "button"
    : type === "select"
      ? "combobox"
      : type === "checkbox"
        ? "checkbox"
        : "textbox";
  return [{ strategy: "role" as const, value: `${role}:${label}` }];
}

function firstUsefulTexts(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => cleanText(value ?? "")).filter((value) => isUsefulLabel(value)))];
}

function firstUsefulText(values: Array<string | undefined>) {
  return firstUsefulTexts(values)[0];
}

function isUsefulLabel(value: string) {
  if (!value || value.length > 120) return false;
  if (/^https?:\/\//i.test(value)) return false;
  if (/^[a-f0-9-]{16,}$/i.test(value)) return false;
  if (/(twitter:image|og:image|lovable\.app|data:|sha256:)/i.test(value)) return false;
  return /[a-z0-9]/i.test(value);
}

function sameLabel(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function cssEscape(value: string) {
  return value.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}

function cssAttributeValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function cleanText(value: string) {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\b[a-z0-9_-]+]:[a-z0-9_:[\]-]+[">]*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferNearbyText(dom: string, index: number) {
  const window = dom.slice(Math.max(0, index - 700), index);
  const candidates = [
    /<label[^>]*>(.*?)<\/label>\s*$/i.exec(window)?.[1],
    ...[...window.matchAll(/<(?:span|div|p|strong|dt|legend)[^>]*>([^<>]{2,120})<\/(?:span|div|p|strong|dt|legend)>/gi)].map((match) => match[1]).slice(-3).reverse()
  ].map((item) => item ? cleanText(item) : "").filter(isUsefulLabel);
  return candidates.at(0);
}

function inferWrappingLabel(dom: string, index: number) {
  const before = dom.lastIndexOf("<label", index);
  const after = dom.indexOf("</label>", index);
  if (before === -1 || after === -1 || before < index - 600) return undefined;
  return cleanText(dom.slice(before, index));
}

function textForElementId(dom: string, id: string) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<[^>]+id=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i").exec(dom);
  return match ? cleanText(match[1]) : undefined;
}

function humanizeName(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function dedupeFields(fields: Array<{ label: string; type: string; selectorCandidates: Array<{ strategy: "role" | "label" | "css"; value: string }> }>) {
  const seen = new Set<string>();
  return fields.map((field) => ({
    ...field,
    selectorCandidates: dedupeSelectors(field.selectorCandidates)
  })).filter((field) => {
    const key = `${field.label.trim().toLowerCase()}:${field.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeSelectors(selectors: Array<{ strategy: "role" | "label" | "css"; value: string }>) {
  const seen = new Set<string>();
  return selectors.filter((selector) => {
    const key = `${selector.strategy}:${selector.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function getDomSnapshotDiff(id: string) {
  const snapshots = await listDomSnapshots();
  const current = snapshots.find((snapshot) => snapshot.id === id);
  if (!current) return null;
  const parent = current.parentSnapshotId ? snapshots.find((snapshot) => snapshot.id === current.parentSnapshotId) ?? null : null;
  return {
    snapshot: current,
    parent,
    changeReport: current.changeReport ?? emptyChangeReport
  };
}

export async function approveDomSnapshot(id: string, actor: string) {
  const allSnapshots = await listDomSnapshots();
  const current = allSnapshots.find((snapshot) => snapshot.id === id);
  if (!current) return null;

  if (shouldUseDatabase()) {
    try {
      await DomSnapshot.update(
        { status: "superseded" },
        {
          where: {
            portalId: current.portalId,
            step: current.step,
            routeFingerprint: current.routeFingerprint,
            status: "approved"
          }
        }
      );
      const row = await DomSnapshot.findByPk(id);
      if (!row) return null;
      await row.update({ status: "approved" });
      audit("dom_snapshot_approved", id, "success");
      return fromModel(row.get({ plain: true }) as unknown as Record<string, unknown>);
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  for (const snapshot of allSnapshots) {
    if (snapshot.portalId === current.portalId && snapshot.step === current.step && snapshot.routeFingerprint === current.routeFingerprint && snapshot.status === "approved") {
      snapshot.status = "superseded";
    }
  }
  current.status = "approved";
  audit("dom_snapshot_approved", `${id}:${actor}`, "success");
  return current;
}

export async function matchDomSnapshot(input: DomMatchInput) {
  const sanitizedDom = sanitizeDomCopy(input.currentSanitizedDom);
  const currentCache = buildPageStateCache({
    portalId: input.portalId,
    jobId: input.jobId,
    url: input.url,
    step: input.step,
    sanitizedDom,
    visibleLabels: input.visibleLabels
  });
  const currentFingerprint = currentCache.domFingerprint;
  const previous = await latestSnapshotFor({ portalId: input.portalId, step: input.step, routeFingerprint: currentCache.routeFingerprint });
  const exactMatch = await matchingSnapshotFor({ portalId: input.portalId, step: input.step, routeFingerprint: currentCache.routeFingerprint, fingerprint: currentFingerprint });
  const signals = staleSignals(previous, currentCache);
  const compatibleApproved = await compatibleApprovedSnapshotFor({
    portalId: input.portalId,
    step: input.step,
    routeFingerprint: currentCache.routeFingerprint,
    sanitizedDom,
    visibleLabels: normalizedLabels(input.visibleLabels)
  });

  if (exactMatch) {
    if (exactMatch.status === "changed_pending_review" && compatibleApproved) {
      audit("dom_snapshot_approved_compatible_hit", input.jobId, "success");
      return {
        mode: "approved_version" as const,
        confidence: Math.round(compatibleApproved.score * 100),
        cache: { ...currentCache, dynamicState: "stable" as const },
        staleSignals: [...new Set([...signals, "compatible_approved_dom"])],
        snapshotId: compatibleApproved.snapshot.id,
        domVersion: compatibleApproved.snapshot.domVersion,
        status: compatibleApproved.snapshot.status,
        currentFingerprint,
        previousFingerprint: effectiveSnapshotFingerprint(compatibleApproved.snapshot),
        changeReport: emptyChangeReport
      };
    }
    if (exactMatch.status === "changed_pending_review") {
      audit("dom_snapshot_pending_review_hit", input.jobId, "escalated");
      const escalationId = await ensureDomReviewEscalation({
        jobId: input.jobId,
        portalId: input.portalId,
        step: input.step,
        domVersion: exactMatch.domVersion,
        confidence: 0
      });
      return {
        mode: "changed_pending_review" as const,
        confidence: 0,
        escalationId,
        snapshotId: exactMatch.id,
        domVersion: exactMatch.domVersion,
        status: exactMatch.status,
        cache: { ...currentCache, dynamicState: "changed" as const },
        staleSignals: signals,
        currentFingerprint,
        previousFingerprint: effectiveSnapshotFingerprint(exactMatch),
        changeReport: exactMatch.changeReport ?? emptyChangeReport
      };
    }
    audit("dom_snapshot_cache_hit", input.jobId, "success");
    return {
      mode: exactMatch.status === "approved" ? "approved_version" as const : "cache_hit" as const,
      confidence: 98,
      cache: currentCache,
      staleSignals: signals,
      snapshotId: exactMatch.id,
      domVersion: exactMatch.domVersion,
      status: exactMatch.status,
      currentFingerprint,
      previousFingerprint: effectiveSnapshotFingerprint(exactMatch),
      changeReport: emptyChangeReport
    };
  }

  if (compatibleApproved) {
    audit("dom_snapshot_approved_compatible_hit", input.jobId, "success");
    return {
      mode: "approved_version" as const,
      confidence: Math.round(compatibleApproved.score * 100),
      cache: { ...currentCache, dynamicState: "stable" as const },
      staleSignals: [...new Set([...signals, "compatible_approved_dom"])],
      snapshotId: compatibleApproved.snapshot.id,
      domVersion: compatibleApproved.snapshot.domVersion,
      status: compatibleApproved.snapshot.status,
      currentFingerprint,
      previousFingerprint: effectiveSnapshotFingerprint(compatibleApproved.snapshot),
      changeReport: emptyChangeReport
    };
  }

  if (previous && usableFieldCount(previous.sanitizedDom, previous.visibleLabels) === 0 && usableFieldCount(sanitizedDom, normalizedLabels(input.visibleLabels)) > 0) {
    const firstUsable = await storeDomSnapshot({
      portalId: input.portalId,
      jobId: input.jobId,
      url: input.url,
      step: input.step,
      sanitizedDom,
      visibleLabels: normalizedLabels(input.visibleLabels),
      frameCount: input.frameCount,
      frameMetadata: input.frameMetadata,
      domVersion: previous.domVersion + 1,
      parentSnapshotId: previous.id,
      routeFingerprint: currentCache.routeFingerprint,
      status: "approved",
      changeReport: {
        ...emptyChangeReport,
        summary: "First usable quotation form DOM observed; previous approved snapshots did not contain form fields."
      }
    });
    audit("dom_snapshot_first_usable_form", input.jobId, "success");
    return {
      mode: "approved_version" as const,
      confidence: 100,
      snapshotId: firstUsable.id,
      domVersion: firstUsable.domVersion,
      status: firstUsable.status,
      cache: { ...currentCache, dynamicState: "stable" as const },
      staleSignals: ["first_usable_form_dom"],
      currentFingerprint,
      previousFingerprint: effectiveSnapshotFingerprint(previous),
      changeReport: firstUsable.changeReport ?? emptyChangeReport
    };
  }

  if (!previous) {
    const first = await storeDomSnapshot({
      portalId: input.portalId,
      jobId: input.jobId,
      url: input.url,
      step: input.step,
      sanitizedDom,
      visibleLabels: normalizedLabels(input.visibleLabels),
      frameCount: input.frameCount,
      frameMetadata: input.frameMetadata,
      domVersion: 1,
      routeFingerprint: currentCache.routeFingerprint,
      status: "approved",
      changeReport: emptyChangeReport
    });
    audit("dom_snapshot_first_observation", input.jobId, "success");
    return {
      mode: "first_observation_stored" as const,
      confidence: 100,
      snapshotId: first.id,
      domVersion: first.domVersion,
      status: first.status,
      cache: { ...currentCache, dynamicState: "stable" as const },
      staleSignals: ["missing_cache"],
      currentFingerprint,
      previousFingerprint: null,
      changeReport: emptyChangeReport
    };
  }

  audit("dom_change_analysis_requested", input.jobId, "escalated");
  let analysis;
  const nextVersion = previous.domVersion + 1;
  try {
    analysis = await analyzeDomChange({
      portalId: input.portalId,
      jobId: input.jobId,
      url: input.url,
      previousDomVersion: previous.domVersion,
      previousFingerprint: effectiveSnapshotFingerprint(previous),
      currentDomVersion: nextVersion,
      currentFingerprint,
      previousLabels: previous.visibleLabels,
      currentLabels: normalizedLabels(input.visibleLabels),
      staleSignals: signals,
      reason: input.reason
    });
  } catch {
    analysis = {
      provider: "gemini" as const,
      model: "unavailable",
      configured: false,
      confidence: 0,
      changeReport: {
        ...emptyChangeReport,
        possibleAffectedMappings: signals,
        summary: "DOM change analysis failed; human review is required."
      }
    };
  }

  const changed = await storeDomSnapshot({
    portalId: input.portalId,
    jobId: input.jobId,
    url: input.url,
    step: input.step,
    sanitizedDom,
    visibleLabels: normalizedLabels(input.visibleLabels),
    frameCount: input.frameCount,
    frameMetadata: input.frameMetadata,
    domVersion: nextVersion,
    parentSnapshotId: previous.id,
    routeFingerprint: currentCache.routeFingerprint,
    status: "changed_pending_review",
    changeReport: analysis.changeReport
  });

  const escalationId = await ensureDomReviewEscalation({
    jobId: input.jobId,
    portalId: input.portalId,
    step: input.step,
    domVersion: nextVersion,
    confidence: Math.max(0, Math.min(100, analysis.confidence)),
    newSnapshotId: changed.id,
    metadata: {
      snapshotId: changed.id,
      parentSnapshotId: previous.id,
      staleSignals: signals,
      changeReport: analysis.changeReport
    }
  });

  return {
    mode: "changed_pending_review" as const,
    confidence: 0,
    escalationId,
    snapshotId: changed.id,
    domVersion: changed.domVersion,
    status: changed.status,
    cache: { ...currentCache, dynamicState: "changed" as const },
    staleSignals: signals,
    currentFingerprint,
    previousFingerprint: effectiveSnapshotFingerprint(previous),
    changeReport: analysis.changeReport
  };
}
