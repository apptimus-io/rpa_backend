import assert from "node:assert/strict";
import { env } from "../src/config/env.js";
import { createJobScreenshotUpload, createPortalHealthScreenshotUpload, createSignedDeliveryUrl, createSignedUpload } from "../src/services/cloudinary.service.js";

function assertNoApiSecret(payload: unknown) {
  if (env.CLOUDINARY_API_SECRET) {
    assert.equal(JSON.stringify(payload).includes(env.CLOUDINARY_API_SECRET), false);
  }
}

function run() {
  const documentUpload = createSignedUpload({
    folder: "submissions/SUB-1/documents",
    publicId: "SUB-1-policy",
    resourceType: "raw"
  });
  assert.equal(documentUpload.folder, "submissions/SUB-1/documents");
  assert.equal(documentUpload.publicId, "SUB-1-policy");
  assert.equal(documentUpload.resourceType, "raw");
  assert.equal(typeof documentUpload.signature, "string");
  assertNoApiSecret(documentUpload);

  const beforeScreenshot = createJobScreenshotUpload({
    jobId: "JOB-1",
    stage: "before",
    publicId: "JOB-1-before-fill"
  });
  assert.equal(beforeScreenshot.folder, "jobs/JOB-1/screenshots/before");
  assert.equal(beforeScreenshot.resourceType, "image");
  assertNoApiSecret(beforeScreenshot);

  const healthScreenshot = createPortalHealthScreenshotUpload({
    portalId: "por_test",
    publicId: "por_test-health"
  });
  assert.equal(healthScreenshot.folder, "portals/por_test/health");
  assert.equal(healthScreenshot.resourceType, "image");
  assertNoApiSecret(healthScreenshot);

  const delivery = createSignedDeliveryUrl({
    publicId: "jobs/JOB-1/screenshots/before/JOB-1-before-fill",
    expiresInSeconds: 60
  });
  assert.equal(typeof delivery.expiresAt, "number");
  assertNoApiSecret(delivery);

  console.log("cloudinary-unit-ok");
}

run();
