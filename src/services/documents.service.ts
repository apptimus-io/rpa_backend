import { recordAudit } from "./audit.service.js";
import { createSignedUpload, deleteCloudinaryAsset } from "./cloudinary.service.js";
import { submissions } from "../data/demo-data.js";
import { PortalJob, Submission, SubmissionDocument as SubmissionDocumentModel } from "../db/models.js";
import { canFallbackFromDatabaseError, shouldUseDatabase } from "../db/runtime.js";

export type SubmissionDocument = {
  id: string;
  submissionId: string;
  filename: string;
  documentType: DocumentType;
  cloudinaryPublicId: string;
  cloudinaryUrl: string;
  uploadedBy: string;
  createdAt: string;
};

export const documentTypes = ["pdf", "docx", "spreadsheet", "csv", "image", "other"] as const;
export type DocumentType = (typeof documentTypes)[number];

const documents: SubmissionDocument[] = [
  {
    id: "doc_001",
    submissionId: "SUB-2026-1001",
    filename: "vehicle-schedule.pdf",
    documentType: "pdf",
    cloudinaryPublicId: "submissions/SUB-2026-1001/vehicle-schedule",
    cloudinaryUrl: "https://res.cloudinary.com/demo/raw/upload/vehicle-schedule.pdf",
    uploadedBy: "usr_002",
    createdAt: "2026-06-01T08:16:00.000Z"
  }
];

export class DocumentDeletionBlockedError extends Error {
  constructor() {
    super("Document cannot be deleted after portal jobs are queued.");
    this.name = "DocumentDeletionBlockedError";
  }
}

export class SubmissionDocumentTargetNotFoundError extends Error {
  constructor() {
    super("Submission was not found for document operation.");
    this.name = "SubmissionDocumentTargetNotFoundError";
  }
}

function normalizePublicIdPart(value: string) {
  return value
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function fromModel(row: Record<string, unknown>): SubmissionDocument {
  return {
    id: String(row.id),
    submissionId: String(row.submissionId),
    filename: String(row.filename),
    documentType: row.documentType as DocumentType,
    cloudinaryPublicId: String(row.cloudinaryPublicId),
    cloudinaryUrl: String(row.cloudinaryUrl),
    uploadedBy: String(row.uploadedBy),
    createdAt: new Date(row.createdAt as string | Date).toISOString()
  };
}

function inferCloudinaryResourceType(url: string): "image" | "raw" | "video" {
  if (url.includes("/image/upload/")) return "image";
  if (url.includes("/video/upload/")) return "video";
  return "raw";
}

async function deleteDocumentAsset(document: SubmissionDocument) {
  await deleteCloudinaryAsset({
    publicId: document.cloudinaryPublicId,
    resourceType: inferCloudinaryResourceType(document.cloudinaryUrl)
  });
}

async function assertSubmissionExists(submissionId: string) {
  if (shouldUseDatabase()) {
    try {
      const count = await Submission.count({ where: { id: submissionId } });
      if (count === 0) {
        throw new SubmissionDocumentTargetNotFoundError();
      }
      return;
    } catch (error) {
      if (error instanceof SubmissionDocumentTargetNotFoundError) throw error;
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  if (!submissions.some((submission) => submission.id === submissionId)) {
    throw new SubmissionDocumentTargetNotFoundError();
  }
}

export async function listSubmissionDocuments(submissionId: string) {
  if (shouldUseDatabase()) {
    try {
      const rows = await SubmissionDocumentModel.findAll({
        where: { submissionId },
        order: [["createdAt", "DESC"]],
        raw: true
      });
      return rows.map((row) => fromModel(row as unknown as Record<string, unknown>));
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  return documents.filter((document) => document.submissionId === submissionId);
}

export async function prepareSubmissionDocumentUpload(submissionId: string, filename: string, documentType: DocumentType, actor: string) {
  await assertSubmissionExists(submissionId);
  const publicId = `${submissionId}/${documentType}/${normalizePublicIdPart(filename)}-${Date.now()}`;
  const upload = createSignedUpload({
    folder: `submissions/${submissionId}/documents`,
    publicId,
    resourceType: "auto"
  });
  recordAudit({ actor, action: "submission_document_upload_prepared", target: submissionId, status: "success" });
  return upload;
}

export async function saveSubmissionDocument(input: Omit<SubmissionDocument, "id" | "createdAt">) {
  await assertSubmissionExists(input.submissionId);
  const document: SubmissionDocument = {
    id: `doc_${Math.floor(Math.random() * 90_000 + 10_000)}`,
    createdAt: new Date().toISOString(),
    ...input
  };

  if (shouldUseDatabase()) {
    try {
      const row = await SubmissionDocumentModel.create(document);
      recordAudit({ actor: input.uploadedBy, action: "submission_document_saved", target: input.submissionId, status: "success" });
      return fromModel(row.get({ plain: true }) as unknown as Record<string, unknown>);
    } catch (error) {
      if (!canFallbackFromDatabaseError()) {
        await deleteDocumentAsset(document).catch(() => undefined);
      }
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  documents.unshift(document);
  recordAudit({ actor: input.uploadedBy, action: "submission_document_saved", target: input.submissionId, status: "success" });
  return document;
}

export async function deleteSubmissionDocument(submissionId: string, documentId: string, actor: string) {
  if (shouldUseDatabase()) {
    try {
      const activeJobCount = await PortalJob.count({
        where: {
          submissionId,
          status: ["queued", "processing", "completed", "failed", "escalated"]
        }
      });
      if (activeJobCount > 0) {
        throw new DocumentDeletionBlockedError();
      }
    } catch (error) {
      if (error instanceof DocumentDeletionBlockedError) throw error;
      if (!canFallbackFromDatabaseError()) throw error;
    }
  } else if (documents.some((document) => document.submissionId === submissionId)) {
    // Demo mode keeps deletion permissive for design review.
  }

  if (shouldUseDatabase()) {
    try {
      const row = await SubmissionDocumentModel.findOne({ where: { id: documentId, submissionId }, raw: true });
      if (!row) {
        return null;
      }
      await deleteDocumentAsset(fromModel(row as unknown as Record<string, unknown>));
      await SubmissionDocumentModel.destroy({ where: { id: documentId, submissionId } });
      recordAudit({ actor, action: "submission_document_deleted", target: submissionId, status: "success" });
      return fromModel(row as unknown as Record<string, unknown>);
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  const index = documents.findIndex((document) => document.submissionId === submissionId && document.id === documentId);
  if (index === -1) {
    return null;
  }
  const deleted = documents[index];
  await deleteDocumentAsset(deleted);
  documents.splice(index, 1);
  recordAudit({ actor, action: "submission_document_deleted", target: submissionId, status: "success" });
  return deleted;
}
