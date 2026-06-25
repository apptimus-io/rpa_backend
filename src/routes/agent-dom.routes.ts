import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { approveDomSnapshot, getDomSnapshotDiff, getDomSnapshotFields, listDomSnapshots, matchDomSnapshot, storeDomSnapshot } from "../services/agent-dom.service.js";
import { analyzeSnapshotWithVision, suggestMappingForSnapshot } from "../services/mapping-suggester.service.js";

const snapshotSchema = z.object({
  portalId: z.string().min(1),
  jobId: z.string().min(1),
  url: z.string().url(),
  step: z.string().min(1),
  sanitizedDom: z.string().min(1),
  visibleLabels: z.array(z.string()).default([]),
  frameCount: z.number().int().nonnegative().optional(),
  frameMetadata: z.array(z.record(z.string(), z.unknown())).default([])
});

const matchSchema = z.object({
  portalId: z.string().min(1),
  jobId: z.string().min(1),
  url: z.string().url(),
  step: z.string().min(1),
  currentSanitizedDom: z.string().min(1),
  visibleLabels: z.array(z.string()).default([]),
  frameCount: z.number().int().nonnegative().optional(),
  frameMetadata: z.array(z.record(z.string(), z.unknown())).default([]),
  reason: z.string().min(1)
});

function requireAgentToken(headers: { authorization?: string }) {
  const token = headers.authorization?.replace("Bearer ", "");
  return Boolean(env.INTERNAL_AGENT_TOKEN && token === env.INTERNAL_AGENT_TOKEN);
}

export async function agentDomRoutes(app: FastifyInstance) {
  app.get("/agent/dom-snapshots", async () => ({
    data: await listDomSnapshots()
  }));

  app.get("/agent/dom-snapshots/:id/diff", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
    const diff = await getDomSnapshotDiff(params.data.id);
    if (!diff) return reply.code(404).send({ error: "DOM_SNAPSHOT_NOT_FOUND" });
    return { data: diff };
  });

  app.get("/agent/dom-snapshots/:id/fields", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
    const fields = await getDomSnapshotFields(params.data.id);
    if (!fields) return reply.code(404).send({ error: "DOM_SNAPSHOT_NOT_FOUND" });
    return { data: fields };
  });

  app.post("/agent/dom-snapshots/:id/approve", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
    const approved = await approveDomSnapshot(params.data.id, "admin");
    if (!approved) return reply.code(404).send({ error: "DOM_SNAPSHOT_NOT_FOUND" });
    return { data: approved };
  });

  app.post("/agent/dom-snapshots/:id/suggest-mapping", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
    const result = await suggestMappingForSnapshot(params.data.id, "admin");
    if (!result) return reply.code(404).send({ error: "MAPPING_SUGGESTION_NOT_AVAILABLE" });
    return { data: result };
  });

  app.post("/agent/dom-snapshots/:id/vision-analysis", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
    const result = await analyzeSnapshotWithVision(params.data.id);
    if (!result) return reply.code(404).send({ error: "VISION_ANALYSIS_NOT_AVAILABLE" });
    return { data: result };
  });

  app.post("/internal/agent/dom-snapshots", async (request, reply) => {
    if (!requireAgentToken(request.headers)) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    const body = snapshotSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
    }

    return { data: await storeDomSnapshot(body.data) };
  });

  app.post("/internal/agent/dom-match", async (request, reply) => {
    if (!requireAgentToken(request.headers)) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    const body = matchSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
    }

    return { data: await matchDomSnapshot(body.data) };
  });
}
