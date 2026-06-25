import { createHash } from "node:crypto";
import { env } from "../config/env.js";

export type SignedUploadRequest = {
  folder: string;
  publicId?: string;
  resourceType?: "image" | "raw" | "auto";
};

export type DeleteCloudinaryAssetRequest = {
  publicId: string;
  resourceType?: "image" | "raw" | "video";
};

export type SignedDeliveryUrlRequest = {
  publicId: string;
  resourceType?: "image" | "raw" | "video";
  format?: string;
  expiresInSeconds?: number;
};

export type JobScreenshotUploadRequest = {
  jobId: string;
  stage: "before" | "after";
  publicId?: string;
};

export type JobQuotePdfUploadRequest = {
  jobId: string;
  publicId?: string;
  resourceType?: "image" | "raw" | "auto";
};

export type PortalHealthScreenshotUploadRequest = {
  portalId: string;
  publicId?: string;
};

export type UploadImageBufferRequest = {
  buffer: Buffer;
  folder: string;
  publicId: string;
};

function getCloudName() {
  if (env.CLOUDINARY_CLOUD_NAME) {
    return env.CLOUDINARY_CLOUD_NAME;
  }
  if (!env.CLOUDINARY_URL) {
    return undefined;
  }
  try {
    return new URL(env.CLOUDINARY_URL).hostname;
  } catch {
    return undefined;
  }
}

export function isCloudinaryConfigured() {
  return Boolean(getCloudName() && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
}

export function createSignedUpload(input: SignedUploadRequest) {
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = input.publicId ?? `upload_${timestamp}`;
  const params = `folder=${input.folder}&public_id=${publicId}&timestamp=${timestamp}`;
  const signature = createHash("sha1")
    .update(`${params}${env.CLOUDINARY_API_SECRET ?? "development-cloudinary-secret"}`)
    .digest("hex");

  return {
    configured: isCloudinaryConfigured(),
    cloudName: getCloudName(),
    apiKey: env.CLOUDINARY_API_KEY,
    uploadPreset: env.CLOUDINARY_UPLOAD_PRESET,
    folder: input.folder,
    publicId,
    timestamp,
    signature,
    resourceType: input.resourceType ?? "auto",
    maxUploadBytes: env.DOCUMENT_MAX_UPLOAD_BYTES
  };
}

export function createJobScreenshotUpload(input: JobScreenshotUploadRequest) {
  const timestamp = Math.floor(Date.now() / 1000);
  return createSignedUpload({
    folder: `jobs/${input.jobId}/screenshots/${input.stage}`,
    publicId: input.publicId ?? `${input.jobId}-${input.stage}-${timestamp}`,
    resourceType: "image"
  });
}

export function createJobQuotePdfUpload(input: JobQuotePdfUploadRequest) {
  const timestamp = Math.floor(Date.now() / 1000);
  return createSignedUpload({
    folder: `jobs/${input.jobId}/quotes`,
    publicId: input.publicId ?? `${input.jobId}-quote-${timestamp}`,
    resourceType: input.resourceType ?? "raw"
  });
}

export function createPortalHealthScreenshotUpload(input: PortalHealthScreenshotUploadRequest) {
  const timestamp = Math.floor(Date.now() / 1000);
  return createSignedUpload({
    folder: `portals/${input.portalId}/health`,
    publicId: input.publicId ?? `${input.portalId}-health-${timestamp}`,
    resourceType: "image"
  });
}

export async function uploadImageBufferToCloudinary(input: UploadImageBufferRequest) {
  const cloudName = getCloudName();
  if (!isCloudinaryConfigured() || !cloudName) {
    return {
      configured: false,
      uploaded: false,
      publicId: input.publicId,
      secureUrl: null,
      result: "not_configured"
    };
  }

  const upload = createSignedUpload({
    folder: input.folder,
    publicId: input.publicId,
    resourceType: "image"
  });
  const body = new URLSearchParams({
    file: `data:image/png;base64,${input.buffer.toString("base64")}`,
    folder: upload.folder,
    public_id: upload.publicId,
    timestamp: String(upload.timestamp),
    api_key: env.CLOUDINARY_API_KEY ?? "",
    signature: upload.signature
  });
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body
  });

  if (!response.ok) {
    return {
      configured: true,
      uploaded: false,
      publicId: upload.publicId,
      secureUrl: null,
      result: `upload_failed_${response.status}`
    };
  }

  const result = await response.json() as { public_id?: string; secure_url?: string };
  return {
    configured: true,
    uploaded: Boolean(result.secure_url),
    publicId: result.public_id ?? upload.publicId,
    secureUrl: result.secure_url ?? null,
    result: result.secure_url ? "uploaded" : "missing_secure_url"
  };
}

export function createSignedDeliveryUrl(input: SignedDeliveryUrlRequest) {
  const cloudName = getCloudName();
  const resourceType = input.resourceType ?? "image";
  const expiresAt = Math.floor(Date.now() / 1000) + (input.expiresInSeconds ?? 10 * 60);
  const publicId = input.format ? `${input.publicId}.${input.format}` : input.publicId;
  const signature = createHash("sha1")
    .update(`expires_at=${expiresAt}&public_id=${input.publicId}${env.CLOUDINARY_API_SECRET ?? "development-cloudinary-secret"}`)
    .digest("hex");

  return {
    configured: isCloudinaryConfigured(),
    expiresAt,
    url: cloudName
      ? `https://res.cloudinary.com/${cloudName}/${resourceType}/upload/${publicId}?expires_at=${expiresAt}&signature=${signature}&api_key=${env.CLOUDINARY_API_KEY ?? ""}`
      : ""
  };
}

export async function deleteCloudinaryAsset(input: DeleteCloudinaryAssetRequest) {
  if (!isCloudinaryConfigured()) {
    return { configured: false, deleted: false, result: "not_configured" };
  }

  const cloudName = getCloudName();
  const resourceType = input.resourceType ?? "raw";
  const timestamp = Math.floor(Date.now() / 1000);
  const params = `public_id=${input.publicId}&timestamp=${timestamp}`;
  const signature = createHash("sha1")
    .update(`${params}${env.CLOUDINARY_API_SECRET ?? ""}`)
    .digest("hex");
  const body = new URLSearchParams({
    public_id: input.publicId,
    timestamp: String(timestamp),
    api_key: env.CLOUDINARY_API_KEY ?? "",
    signature
  });
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`, {
    method: "POST",
    body
  });

  if (!response.ok) {
    throw new Error(`Cloudinary delete failed with status ${response.status}`);
  }

  const result = await response.json() as { result?: string };
  return {
    configured: true,
    deleted: result.result === "ok" || result.result === "not found",
    result: result.result ?? "unknown"
  };
}
