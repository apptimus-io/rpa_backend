import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createJobScreenshotUpload, createPortalHealthScreenshotUpload, createSignedDeliveryUrl, createSignedUpload } from "../services/cloudinary.service.js";
import { analyzeDomChange } from "../services/gemini.service.js";
import { sendMail } from "../services/mail.service.js";
import { requirePermission } from "../middleware/auth.js";
import { permissions } from "../permissions/permissions.js";

const signedUploadSchema = z.object({
  folder: z.string().min(1),
  publicId: z.string().optional(),
  resourceType: z.enum(["image", "raw", "auto"]).optional()
});

const signedDeliverySchema = z.object({
  publicId: z.string().min(1),
  resourceType: z.enum(["image", "raw", "video"]).optional(),
  format: z.string().min(1).optional(),
  expiresInSeconds: z.number().int().positive().max(60 * 60).optional()
});

const jobScreenshotUploadSchema = z.object({
  jobId: z.string().min(1).max(64),
  stage: z.enum(["before", "after"]),
  publicId: z.string().optional()
});

const portalHealthScreenshotUploadSchema = z.object({
  portalId: z.string().min(1).max(64),
  publicId: z.string().optional()
});

const domChangeSchema = z.object({
  portalId: z.string().min(1),
  jobId: z.string().min(1),
  url: z.string().url(),
  previousDomVersion: z.number().int().positive().default(1),
  previousFingerprint: z.string().min(1),
  currentDomVersion: z.number().int().positive().default(2),
  currentFingerprint: z.string().min(1),
  previousLabels: z.array(z.string()).default([]),
  currentLabels: z.array(z.string()).default([]),
  staleSignals: z.array(z.string()).default([]),
  reason: z.string().min(1)
});

const testMailSchema = z.object({
  toUserId: z.string().min(1),
  toEmail: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1)
});

export async function integrationsRoutes(app: FastifyInstance) {
  app.post(
    "/integrations/cloudinary/sign-upload",
    { preHandler: [requirePermission(permissions.settingsManage)] },
    async (request, reply) => {
      const body = signedUploadSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      }
      return { data: createSignedUpload(body.data) };
    }
  );

  app.post(
    "/integrations/cloudinary/sign-job-screenshot-upload",
    { preHandler: [requirePermission(permissions.settingsManage)] },
    async (request, reply) => {
      const body = jobScreenshotUploadSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      }
      return { data: createJobScreenshotUpload(body.data) };
    }
  );

  app.post(
    "/integrations/cloudinary/sign-portal-health-upload",
    { preHandler: [requirePermission(permissions.settingsManage)] },
    async (request, reply) => {
      const body = portalHealthScreenshotUploadSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      }
      return { data: createPortalHealthScreenshotUpload(body.data) };
    }
  );

  app.post(
    "/integrations/cloudinary/sign-delivery-url",
    { preHandler: [requirePermission(permissions.settingsManage)] },
    async (request, reply) => {
      const body = signedDeliverySchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      }
      return { data: createSignedDeliveryUrl(body.data) };
    }
  );

  app.post(
    "/integrations/gemini/dom-fallback",
    { preHandler: [requirePermission(permissions.settingsManage)] },
    async (request, reply) => {
      const body = domChangeSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      }
      return { data: await analyzeDomChange(body.data) };
    }
  );

  app.post(
    "/integrations/mail/test",
    { preHandler: [requirePermission(permissions.settingsManage)] },
    async (request, reply) => {
      const body = testMailSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      }
      return { data: await sendMail(body.data) };
    }
  );
}
