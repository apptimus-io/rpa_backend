import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { requirePermission } from "../middleware/auth.js";
import { permissions } from "../permissions/permissions.js";
import {
  deleteSubmissionDocument,
  DocumentDeletionBlockedError,
  documentTypes,
  listSubmissionDocuments,
  prepareSubmissionDocumentUpload,
  saveSubmissionDocument,
  SubmissionDocumentTargetNotFoundError
} from "../services/documents.service.js";

const prepareUploadSchema = z.object({
  filename: z.string().min(1),
  documentType: z.enum(documentTypes),
  fileSizeBytes: z.number().int().positive().max(env.DOCUMENT_MAX_UPLOAD_BYTES).optional()
});

const saveDocumentSchema = z.object({
  filename: z.string().min(1),
  documentType: z.enum(documentTypes),
  cloudinaryPublicId: z.string().min(1),
  cloudinaryUrl: z.string().url()
});

const submissionDocumentParamsSchema = z.object({
  id: z.string().min(1).max(64)
});

const deleteDocumentParamsSchema = submissionDocumentParamsSchema.extend({
  documentId: z.string().min(1).max(64)
});

export async function documentsRoutes(app: FastifyInstance) {
  app.get(
    "/submissions/:id/documents",
    { preHandler: [requirePermission(permissions.submissionsView)] },
    async (request, reply) => {
      const params = submissionDocumentParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      }
      const { id } = params.data;
      return { data: await listSubmissionDocuments(id) };
    }
  );

  app.post(
    "/submissions/:id/documents/prepare-upload",
    {
      preHandler: [requirePermission(permissions.submissionsCreate)],
      config: {
        rateLimit: {
          max: env.UPLOAD_RATE_LIMIT_MAX,
          timeWindow: env.UPLOAD_RATE_LIMIT_WINDOW
        }
      }
    },
    async (request, reply) => {
      const params = submissionDocumentParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      }
      const { id } = params.data;
      const body = prepareUploadSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      }
      try {
        return { data: await prepareSubmissionDocumentUpload(id, body.data.filename, body.data.documentType, request.user!.id) };
      } catch (error) {
        if (error instanceof SubmissionDocumentTargetNotFoundError) {
          return reply.code(404).send({ error: "SUBMISSION_NOT_FOUND" });
        }
        throw error;
      }
    }
  );

  app.post(
    "/submissions/:id/documents",
    {
      preHandler: [requirePermission(permissions.submissionsCreate)],
      config: {
        rateLimit: {
          max: env.UPLOAD_RATE_LIMIT_MAX,
          timeWindow: env.UPLOAD_RATE_LIMIT_WINDOW
        }
      }
    },
    async (request, reply) => {
      const params = submissionDocumentParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      }
      const { id } = params.data;
      const body = saveDocumentSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      }
      try {
        return {
          data: await saveSubmissionDocument({
            submissionId: id,
            uploadedBy: request.user!.id,
            ...body.data
          })
        };
      } catch (error) {
        if (error instanceof SubmissionDocumentTargetNotFoundError) {
          return reply.code(404).send({ error: "SUBMISSION_NOT_FOUND" });
        }
        throw error;
      }
    }
  );

  app.delete(
    "/submissions/:id/documents/:documentId",
    { preHandler: [requirePermission(permissions.submissionsEdit)] },
    async (request, reply) => {
      const params = deleteDocumentParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      }
      const { id, documentId } = params.data;
      try {
        const deleted = await deleteSubmissionDocument(id, documentId, request.user!.id);
        if (!deleted) {
          return reply.code(404).send({ error: "DOCUMENT_NOT_FOUND" });
        }
        return { data: deleted };
      } catch (error) {
        if (error instanceof DocumentDeletionBlockedError) {
          return reply.code(409).send({ error: "DOCUMENT_DELETE_BLOCKED", message: "Document cannot be deleted after portal jobs are queued." });
        }
        throw error;
      }
    }
  );
}
