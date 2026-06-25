import { PortalObservationEvent, PortalObservationSession } from "../db/models.js";
import { canFallbackFromDatabaseError, shouldUseDatabase } from "../db/runtime.js";
import { savePortalFieldMapping } from "./member-data.service.js";

type SelectorCandidate = { strategy: string; value: string; priority?: number };

export type ObservationEventInput = {
  eventType: string;
  step?: string | null;
  url?: string | null;
  fieldLabel?: string | null;
  fieldType?: string | null;
  normalizedTarget?: string | null;
  selectorCandidates: SelectorCandidate[];
  valueSample?: string | null;
  frameIndex?: number | null;
};

const memorySessions: Array<Record<string, unknown>> = [];
const memoryEvents: Array<Record<string, unknown>> = [];

function id(prefix: string) {
  return `${prefix}_${Math.floor(Math.random() * 900_000 + 100_000)}`;
}

export async function createObservationSession(input: { portalId: string; coverageType?: string | null; notes?: string | null }, actor = "admin") {
  const record = {
    id: id("obs"),
    portalId: input.portalId,
    coverageType: input.coverageType ?? null,
    status: "recording",
    startedBy: actor,
    startedAt: new Date(),
    completedAt: null,
    notes: input.notes ?? null,
    draftMappingId: null
  };
  if (shouldUseDatabase()) {
    try {
      const row = await PortalObservationSession.create(record);
      return row.get({ plain: true });
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }
  memorySessions.unshift(record);
  return record;
}

export async function listObservationSessions() {
  if (shouldUseDatabase()) {
    try {
      return PortalObservationSession.findAll({ order: [["createdAt", "DESC"]], raw: true });
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }
  return memorySessions;
}

export async function recordObservationEvents(sessionId: string, events: ObservationEventInput[]) {
  const existingCount = await eventCount(sessionId);
  const records = events.map((event, index) => ({
    id: id("obe"),
    sessionId,
    eventIndex: existingCount + index + 1,
    eventType: event.eventType,
    step: event.step ?? null,
    url: event.url ?? null,
    fieldLabel: event.fieldLabel ?? null,
    fieldType: event.fieldType ?? null,
    normalizedTarget: event.normalizedTarget ?? null,
    selectorCandidates: event.selectorCandidates,
    valueSample: event.valueSample ?? null,
    frameIndex: event.frameIndex ?? null
  }));
  if (shouldUseDatabase()) {
    try {
      await PortalObservationEvent.bulkCreate(records);
      return records;
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }
  memoryEvents.push(...records);
  return records;
}

export async function buildObservationDraftMapping(sessionId: string, actor = "admin") {
  const session = await findSession(sessionId);
  if (!session) return null;
  const events = await listEvents(sessionId);
  const fields = events
    .filter((event) => event.eventType !== "click_submit")
    .filter((event) => Array.isArray(event.selectorCandidates) && event.selectorCandidates.length)
    .map((event, index) => ({
      target: event.normalizedTarget || `review.required.${index + 1}`,
      type: normalizeFieldType(event.fieldType),
      required: false,
      label: event.fieldLabel || `Observed field ${index + 1}`,
      selectors: event.selectorCandidates,
      transform: {},
      verification: { rule: normalizeFieldType(event.fieldType) === "select" ? "selected_label_equals" : "value_equals" }
    }));
  const submitEvent = events.find((event) => event.eventType === "click_submit" && Array.isArray(event.selectorCandidates) && event.selectorCandidates.length);
  const mapping = await savePortalFieldMapping({
    portalId: String(session.portalId),
    coverageType: String(session.coverageType || "Default"),
    mappings: {
      fields,
      submit: {
        type: "button",
        selectors: submitEvent?.selectorCandidates ?? [],
        verification: { rule: "exists" }
      }
    },
    requiredFields: [],
    status: "draft"
  }, actor);
  await updateSession(sessionId, { status: "draft_ready", completedAt: new Date(), draftMappingId: String((mapping as Record<string, unknown>).id) });
  return { sessionId, draftMappingId: (mapping as Record<string, unknown>).id, mapping };
}

async function findSession(sessionId: string) {
  if (shouldUseDatabase()) {
    try {
      return PortalObservationSession.findByPk(sessionId, { raw: true }) as Promise<Record<string, unknown> | null>;
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }
  return memorySessions.find((session) => session.id === sessionId) ?? null;
}

async function listEvents(sessionId: string) {
  if (shouldUseDatabase()) {
    try {
      return PortalObservationEvent.findAll({ where: { sessionId }, order: [["eventIndex", "ASC"]], raw: true }) as Promise<Array<Record<string, any>>>;
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }
  return memoryEvents.filter((event) => event.sessionId === sessionId) as Array<Record<string, any>>;
}

async function eventCount(sessionId: string) {
  if (shouldUseDatabase()) {
    try {
      return PortalObservationEvent.count({ where: { sessionId } });
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }
  return memoryEvents.filter((event) => event.sessionId === sessionId).length;
}

async function updateSession(sessionId: string, patch: Record<string, unknown>) {
  if (shouldUseDatabase()) {
    try {
      await PortalObservationSession.update(patch, { where: { id: sessionId } });
      return;
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }
  const session = memorySessions.find((item) => item.id === sessionId);
  if (session) Object.assign(session, patch);
}

function normalizeFieldType(value: unknown) {
  const type = String(value || "text").toLowerCase();
  if (["select", "date", "checkbox", "file", "button", "table"].includes(type)) return type;
  if (type === "email" || type === "tel" || type === "number" || type === "password") return "text";
  return "text";
}
