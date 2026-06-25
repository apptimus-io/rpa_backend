import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { permissions } from "../permissions/permissions.js";
import { requirePermission } from "../middleware/auth.js";
import { writePortalCredentials } from "../services/credentials.service.js";
import { recordAudit } from "../services/audit.service.js";
import { createPortal, createPortalOnboarding, deletePortal, getPortal, listPortals, markPortalCredentialsConfigured, PortalDeleteBlockedError, recordPortalHealthCheck, updatePortal } from "../services/portals.service.js";
import { idParamSchema, paginationQuerySchema } from "../validation/common.schemas.js";

const credentialSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(8),
  totpSeed: z.string().optional()
});

const createPortalSchema = z.object({
  name: z.string().min(2),
  loginUrl: z.string().url(),
  portalType: z.string().min(2),
  quotationUrl: z.string().url().optional(),
  loginType: z.enum(["credentials", "public"]).optional(),
  workflowType: z.enum(["census_upload", "benefits_builder", "hybrid"]).optional(),
  censusDownloadRequired: z.boolean().optional(),
  calculateRequired: z.boolean().optional(),
  quotePdfStrategy: z.enum(["direct_download", "modal_select", "action_menu", "none"]).optional(),
  portalConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  credentials: credentialSchema.optional()
}).strict();

const updatePortalSchema = z.object({
  name: z.string().min(2).optional(),
  loginUrl: z.string().url().optional(),
  portalType: z.string().min(2).optional(),
  quotationUrl: z.string().url().optional(),
  loginType: z.enum(["credentials", "public"]).optional(),
  workflowType: z.enum(["census_upload", "benefits_builder", "hybrid"]).optional(),
  censusDownloadRequired: z.boolean().optional(),
  calculateRequired: z.boolean().optional(),
  quotePdfStrategy: z.enum(["direct_download", "modal_select", "action_menu", "none"]).optional(),
  portalConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  isActive: z.boolean().optional()
}).strict().refine((value) => Object.keys(value).length > 0, "At least one portal metadata field is required.");

const listPortalQuerySchema = paginationQuerySchema.extend({
  isActive: z.preprocess((value) => {
    if (value === undefined) return undefined;
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean().optional()),
  portalType: z.string().min(1).max(100).optional()
});

export async function portalsRoutes(app: FastifyInstance) {
  app.get(
    "/portals",
    { preHandler: [requirePermission(permissions.portalsView)] },
    async (request, reply) => {
      const query = listPortalQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: query.error.issues });
      }
      return { data: await listPortals(query.data) };
    }
  );

  app.post(
    "/portals",
    { preHandler: [requirePermission(permissions.portalsManage)] },
    async (request, reply) => {
      const body = createPortalSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      }

      const { credentials, ...portalInput } = body.data;
      const portal = await createPortal(portalInput);
      if (credentials) {
        await writePortalCredentials(portal.id, credentials, { actor: request.user!.id, action: "portal_credentials_created" });
        await markPortalCredentialsConfigured(portal.id);
      }
      recordAudit({ actor: request.user!.id, action: "portal_created", target: portal.id, status: "success" });
      const responsePortal = credentials ? await getPortal(portal.id) : portal;
      return reply.code(201).send({ data: responsePortal ?? { ...portal, credentialsConfigured: Boolean(credentials) || portal.credentialsConfigured } });
    }
  );

  app.post(
    "/portals/onboarding",
    { preHandler: [requirePermission(permissions.portalsManage)] },
    async (request, reply) => {
      const body = createPortalSchema.omit({ credentials: true }).safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      }

      const result = await createPortalOnboarding(body.data);
      recordAudit({ actor: request.user!.id, action: "portal_onboarding_created", target: result.portal.id, status: "success" });
      return reply.code(201).send({ data: result });
    }
  );

  app.get(
    "/portals/:id",
    { preHandler: [requirePermission(permissions.portalsManage)] },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      }
      const { id } = params.data;
      const portal = await getPortal(id);
      if (!portal) {
        return reply.code(404).send({ error: "PORTAL_NOT_FOUND" });
      }
      return { data: portal };
    }
  );

  app.patch(
    "/portals/:id",
    { preHandler: [requirePermission(permissions.portalsManage)] },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      }
      const { id } = params.data;
      const body = updatePortalSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      }

      const portal = await updatePortal(id, body.data);
      if (!portal) {
        return reply.code(404).send({ error: "PORTAL_NOT_FOUND" });
      }

      recordAudit({ actor: request.user!.id, action: "portal_updated", target: id, status: "success" });
      return { data: portal };
    }
  );

  app.delete(
    "/portals/:id",
    { preHandler: [requirePermission(permissions.portalsManage)] },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      }
      const { id } = params.data;
      try {
        const result = await deletePortal(id);
        if (!result) {
          return reply.code(404).send({ error: "PORTAL_NOT_FOUND" });
        }
        recordAudit({ actor: request.user!.id, action: "portal_deleted", target: id, status: "success" });
        return { data: result };
      } catch (error) {
        if (error instanceof PortalDeleteBlockedError) {
          recordAudit({ actor: request.user!.id, action: "portal_delete_blocked", target: id, status: "failed" });
          return reply.code(409).send({
            error: "PORTAL_DELETE_BLOCKED",
            message: error.message,
            details: error.details
          });
        }
        throw error;
      }
    }
  );

  app.post(
    "/portals/:id/credentials",
    {
      preHandler: [requirePermission(permissions.portalsManage)],
      config: {
        rateLimit: {
          max: env.AUTH_RATE_LIMIT_MAX,
          timeWindow: env.AUTH_RATE_LIMIT_WINDOW
        }
      }
    },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      }
      const { id } = params.data;
      const portal = await getPortal(id);
      if (!portal) {
        return reply.code(404).send({ error: "PORTAL_NOT_FOUND" });
      }

      const body = credentialSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      }

      const result = await writePortalCredentials(id, body.data, { actor: request.user!.id, action: "portal_credentials_rotated" });
      await markPortalCredentialsConfigured(id);
      return { data: result };
    }
  );

  app.post(
    "/portals/:id/health-check",
    { preHandler: [requirePermission(permissions.portalsManage)] },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      }
      const { id } = params.data;
      const portal = await recordPortalHealthCheck(id);
      if (!portal) {
        return reply.code(404).send({ error: "PORTAL_NOT_FOUND" });
      }
      return { data: portal };
    }
  );
}
