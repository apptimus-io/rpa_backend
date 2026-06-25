import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { permissions } from "../permissions/permissions.js";
import { requirePermission } from "../middleware/auth.js";
import { recordAudit } from "../services/audit.service.js";
import { EscalationAlreadyResolvedError, getEscalation, listEscalationsPage, resolveEscalation } from "../services/escalations.service.js";
import { paginationQuerySchema } from "../validation/common.schemas.js";

const resolveSchema = z.object({
  action: z.enum(["approve", "override", "abort"]).default("approve"),
  overrideValue: z.string().trim().min(1).optional()
}).superRefine((value, context) => {
  if (value.action === "override" && !value.overrideValue) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["overrideValue"],
      message: "Override value is required when action is override."
    });
  }
});

const escalationParamsSchema = z.object({
  id: z.string().min(1).max(64)
});

export async function escalationsRoutes(app: FastifyInstance) {
  app.get(
    "/escalations",
    { preHandler: [requirePermission(permissions.escalationsView)] },
    async (request, reply) => {
      const query = paginationQuerySchema.safeParse(request.query ?? {});
      if (!query.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: query.error.issues });
      }
      return listEscalationsPage(query.data);
    }
  );

  app.get(
    "/escalations/:id",
    { preHandler: [requirePermission(permissions.escalationsView)] },
    async (request, reply) => {
      const params = escalationParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      }

      const escalation = await getEscalation(params.data.id);
      if (!escalation) {
        return reply.code(404).send({ error: "ESCALATION_NOT_FOUND" });
      }
      return { data: escalation };
    }
  );

  app.post(
    "/escalations/:id/resolve",
    { preHandler: [requirePermission(permissions.escalationsApprove)] },
    async (request, reply) => {
      const params = escalationParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      }
      const { id } = params.data;
      const body = resolveSchema.safeParse(request.body ?? {});
      if (!body.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      }

      let escalation;
      try {
        escalation = await resolveEscalation(id, request.user!.id, body.data);
      } catch (error) {
        if (error instanceof EscalationAlreadyResolvedError) {
          return reply.code(409).send({ error: "ESCALATION_ALREADY_RESOLVED", message: "Escalation is already resolved." });
        }
        throw error;
      }
      if (!escalation) {
        return reply.code(404).send({ error: "ESCALATION_NOT_FOUND" });
      }

      recordAudit({ actor: request.user!.id, action: `escalation_${body.data.action}`, target: id, status: "success" });
      return { data: escalation };
    }
  );
}
