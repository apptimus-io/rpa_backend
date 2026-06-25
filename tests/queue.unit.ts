import assert from "node:assert/strict";
import { buildPortalJobPayload, enqueuePortalJob, listQueuedPortalJobs, removeQueuedPortalJobsForSubmission } from "../src/queue/portal-jobs.queue.js";

async function run() {
  const submissionId = `SUB-QUEUE-${Date.now()}`;
  const payload = buildPortalJobPayload({
    portalJobId: "JOB-QUEUE-1",
    submissionId,
    portalId: "por_test",
    customerId: "cus_test",
    documentUrls: ["https://cloudinary.example.test/documents/policy.pdf"]
  });

  assert.equal(payload.payloadVersion, "v1");
  assert.equal(JSON.stringify(payload).includes("password"), false);

  const enqueued = await enqueuePortalJob(payload);
  assert.equal(enqueued.queueJobId.startsWith("portal-jobs:JOB-QUEUE-1:"), true);
  assert.equal(listQueuedPortalJobs().some((job) => job.queueJobId === enqueued.queueJobId), true);

  assert.throws(
    () => buildPortalJobPayload({ ...payload, documentUrls: ["file:///tmp/secret.pdf"] }),
    /safe HTTP URLs/
  );

  assert.equal(removeQueuedPortalJobsForSubmission(submissionId).removed, 1);
  assert.equal(listQueuedPortalJobs().some((job) => job.payload.submissionId === submissionId), false);

  console.log("queue-unit-ok");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
