import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { PortalFieldMapping, PortalObservationEvent, PortalObservationSession } from "../src/db/models.js";
import { shouldUseDatabase } from "../src/db/runtime.js";
import { deletePortal, createPortal } from "../src/services/portals.service.js";

const portal = await createPortal({
  name: `Observation Smoke ${Date.now()}`,
  loginUrl: "https://portal.example.test/observation",
  portalType: "smoke"
});

const app = await buildApp();
let sessionId = "";
let draftMappingId = "";

try {
  const created = await app.inject({
    method: "POST",
    url: "/api/agent/observation-sessions",
    payload: {
      portalId: portal.id,
      coverageType: "Medical",
      notes: "observation route smoke"
    }
  });
  assert.equal(created.statusCode, 200);
  const createdBody = created.json();
  sessionId = createdBody.data.id;
  assert.equal(typeof sessionId, "string");

  const events = await app.inject({
    method: "POST",
    url: `/api/agent/observation-sessions/${sessionId}/events`,
    payload: {
      events: [
        {
          eventType: "fill",
          step: "manual_observation",
          url: "https://portal.example.test/observation",
          fieldLabel: "Email",
          fieldType: "text",
          normalizedTarget: "contact.email",
          selectorCandidates: [{ strategy: "label", value: "Email", priority: 1 }],
          valueSample: "customer@example.test",
          frameIndex: 0
        },
        {
          eventType: "click_submit",
          step: "manual_observation",
          url: "https://portal.example.test/observation",
          fieldLabel: "Generate Quotation PDF",
          fieldType: "button",
          selectorCandidates: [{ strategy: "role", value: "button:Generate Quotation PDF", priority: 1 }],
          frameIndex: 0
        }
      ]
    }
  });
  assert.equal(events.statusCode, 200);
  assert.equal(events.json().data.length, 2);

  const draft = await app.inject({
    method: "POST",
    url: `/api/agent/observation-sessions/${sessionId}/build-draft`
  });
  assert.equal(draft.statusCode, 200);
  draftMappingId = draft.json().data.draftMappingId;
  assert.equal(typeof draftMappingId, "string");

  const listed = await app.inject({ method: "GET", url: "/api/agent/observation-sessions" });
  assert.equal(listed.statusCode, 200);
  assert.equal(Array.isArray(listed.json().data), true);
  console.log("observation-unit-ok");
} finally {
  await app.close();
  if (shouldUseDatabase()) {
    if (sessionId) await PortalObservationEvent.destroy({ where: { sessionId } });
    if (sessionId) await PortalObservationSession.destroy({ where: { id: sessionId } });
    if (draftMappingId) await PortalFieldMapping.destroy({ where: { id: draftMappingId } });
  }
  await deletePortal(portal.id).catch(() => null);
}
