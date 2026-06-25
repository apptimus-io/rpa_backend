import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildObservationDraftMapping, createObservationSession, listObservationSessions, recordObservationEvents } from "../services/observation.service.js";

const selectorSchema = z.object({
  strategy: z.string().min(1),
  value: z.string().min(1),
  priority: z.number().int().positive().optional()
});

const eventSchema = z.object({
  eventType: z.string().min(1),
  step: z.string().optional().nullable(),
  url: z.string().optional().nullable(),
  fieldLabel: z.string().optional().nullable(),
  fieldType: z.string().optional().nullable(),
  normalizedTarget: z.string().optional().nullable(),
  selectorCandidates: z.array(selectorSchema).default([]),
  valueSample: z.string().optional().nullable(),
  frameIndex: z.number().int().optional().nullable()
});

export async function observationRoutes(app: FastifyInstance) {
  app.get("/agent/observation-sessions", async () => ({
    data: await listObservationSessions()
  }));

  app.post("/agent/observation-sessions", async (request, reply) => {
    const body = z.object({
      portalId: z.string().min(1),
      coverageType: z.string().optional().nullable(),
      notes: z.string().optional().nullable()
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
    return { data: await createObservationSession(body.data, request.user?.id ?? "admin") };
  });

  app.post("/agent/observation-sessions/:id/events", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ events: z.array(eventSchema).min(1) }).safeParse(request.body);
    if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
    if (!body.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
    return { data: await recordObservationEvents(params.data.id, body.data.events) };
  });

  app.post("/agent/observation-sessions/:id/build-draft", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
    const result = await buildObservationDraftMapping(params.data.id, request.user?.id ?? "admin");
    if (!result) return reply.code(404).send({ error: "OBSERVATION_SESSION_NOT_FOUND" });
    return { data: result };
  });
}
