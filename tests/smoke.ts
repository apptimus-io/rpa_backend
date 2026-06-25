import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { buildApp } from "../src/http-app.js";
import { env } from "../src/config/env.js";
import { DomSnapshot } from "../src/db/models.js";
import { shouldUseDatabase } from "../src/db/runtime.js";
import { requirePermission, requireRoles } from "../src/middleware/auth.js";
import { permissions } from "../src/permissions/permissions.js";
import { matchDomSnapshot, storeDomSnapshot } from "../src/services/agent-dom.service.js";
import { createJobScreenshotUpload, createSignedDeliveryUrl } from "../src/services/cloudinary.service.js";
import { analyzeDomChange } from "../src/services/gemini.service.js";
import { sendMail } from "../src/services/mail.service.js";
import { createEscalation, listEscalationsPage, resolveEscalation } from "../src/services/escalations.service.js";
import { findEscalationSlaBreaches, notifyEscalationSlaBreaches } from "../src/services/escalation-sla.service.js";
import { renderMetrics } from "../src/services/metrics.service.js";
import { createTotpProvisioningUri, generateTotpCode, generateTotpSecret, verifyTotpCode } from "../src/services/mfa.service.js";
import { buildPortalJobPayload, enqueuePortalJob, listQueuedPortalJobs, removeQueuedPortalJobsForSubmission } from "../src/queue/portal-jobs.queue.js";
import { idParamSchema, paginationQuerySchema, withDateRange } from "../src/validation/common.schemas.js";
import { logRedactionPaths, safeLogError } from "../src/utils/logger.js";
import { BCRYPT_COST, hashPassword, verifyPassword } from "../src/utils/password.js";
import { deadLetterJobs, markJobFailure, recordAgentAction, recordQuote, retryJob } from "../src/services/jobs.service.js";
import { exportAuditCsv, listAuditLog } from "../src/services/audit.service.js";
import { trendQuerySchema } from "../src/routes/dashboard.routes.js";
import { createManagedUser, listManagedUsers, updateManagedUser } from "../src/services/users.service.js";
import { getAuthenticatedUser, login, logout } from "../src/services/auth.service.js";
import { cancelSubmission, createSubmission, getSubmissionDetail, listSubmissions } from "../src/services/submissions.service.js";
import { createPortal, createPortalOnboarding, getPortal, listPortals, recordPortalHealthCheck, updatePortal } from "../src/services/portals.service.js";
import { readPortalCredentialsForAgent, writePortalCredentials } from "../src/services/credentials.service.js";
import { computeDailyStats, runNightlyDashboardAggregation } from "../src/services/dashboard-aggregation.service.js";
import { buildGeminiPromptReview } from "../src/services/gemini-prompt-review.service.js";

function createReplyCapture() {
  return {
    statusCode: 200,
    payload: undefined as unknown,
    code(statusCode: number) {
      this.statusCode = statusCode;
      return this;
    },
    send(payload: unknown) {
      this.payload = payload;
      return this;
    }
  };
}

async function run() {
  assert.equal(BCRYPT_COST, 12);
  const passwordHash = await hashPassword("ChangeMe123!");
  assert.equal(await verifyPassword("ChangeMe123!", passwordHash), true);
  assert.equal(await verifyPassword("WrongPass123!", passwordHash), false);
  assert.equal(passwordHash.includes("ChangeMe123!"), false);

  assert.equal(idParamSchema.safeParse({ id: "abc_123" }).success, true);
  assert.equal(paginationQuerySchema.safeParse({ page: "1", limit: "10" }).success, true);
  assert.equal(withDateRange({ q: idParamSchema.shape.id.optional() }).safeParse({
    dateFrom: "2026-06-01T00:00:00.000Z",
    dateTo: "2026-06-02T00:00:00.000Z"
  }).success, true);
  assert.equal(trendQuerySchema.safeParse({ range: "7" }).success, true);
  assert.equal(trendQuerySchema.safeParse({ range: "30" }).success, true);
  assert.equal(trendQuerySchema.safeParse({ range: "14" }).success, false);
  const dailyStatsMigration = readFileSync("src/db/migrations/001_core_schema.sql", "utf8");
  const modelsSource = readFileSync("src/db/models.ts", "utf8");
  const backendPackage = readFileSync("package.json", "utf8");
  const dashboardAggregationJob = readFileSync("src/jobs/dashboard-aggregation.job.ts", "utf8");
  const escalationSlaJob = readFileSync("src/jobs/escalation-sla.job.ts", "utf8");
  const geminiPromptReviewJob = readFileSync("src/jobs/gemini-prompt-review.job.ts", "utf8");
  assert.equal(dailyStatsMigration.includes("CREATE TABLE IF NOT EXISTS daily_stats"), true);
  assert.equal(modelsSource.includes("export class DailyStat"), true);
  assert.equal(backendPackage.includes("dashboard:aggregate"), true);
  assert.equal(backendPackage.includes("sla:check"), true);
  assert.equal(backendPackage.includes("gemini:prompt-review"), true);
  assert.equal(dashboardAggregationJob.includes("runNightlyDashboardAggregation"), true);
  assert.equal(escalationSlaJob.includes("notifyEscalationSlaBreaches"), true);
  assert.equal(geminiPromptReviewJob.includes("buildGeminiPromptReview"), true);

  const payload = buildPortalJobPayload({
    portalJobId: "JOB-SMOKE",
    submissionId: "SUB-SMOKE",
    portalId: "por_smoke",
    customerId: "cus_smoke",
    documentUrls: ["https://example.test/document.pdf"]
  });
  const queued = await enqueuePortalJob(payload);
  assert.match(queued.queueJobId, /^portal-jobs:/);
  assert.equal(listQueuedPortalJobs().some((job) => job.payload.submissionId === "SUB-SMOKE"), true);
  assert.equal(removeQueuedPortalJobsForSubmission("SUB-SMOKE").removed, 1);

  const screenshotUpload = createJobScreenshotUpload({ jobId: "JOB-SMOKE", stage: "before" });
  assert.equal(screenshotUpload.folder, "jobs/JOB-SMOKE/screenshots/before");
  const signedUrl = createSignedDeliveryUrl({ publicId: "sample/path", expiresInSeconds: 60 });
  assert.equal(typeof signedUrl.expiresAt, "number");
  assert.equal(JSON.stringify({ screenshotUpload, signedUrl }).includes("CLOUDINARY_API_SECRET"), false);

  const domChange = await analyzeDomChange({
    portalId: "por_smoke",
    jobId: "JOB-SMOKE",
    url: "https://portal.example.test/quote",
    previousDomVersion: 1,
    previousFingerprint: "dom_old",
    currentDomVersion: 2,
    currentFingerprint: "dom_new",
    previousLabels: ["Customer name"],
    currentLabels: ["Customer name", "Date of birth"],
    staleSignals: ["dom_fingerprint_changed", "visible_labels_changed"],
    reason: "Portal DOM changed after refetch."
  });
  assert.equal(domChange.provider, "gemini");
  assert.equal(Array.isArray(domChange.changeReport.addedFields), true);
  assert.equal(JSON.stringify(domChange).includes("suggestedMapping"), false);
  assert.equal(JSON.stringify(domChange).includes("GEMINI_API_KEY"), false);
  assert.equal(JSON.stringify(domChange).includes("AIza"), false);

  const mailResult = await sendMail({
    toUserId: "usr_smoke",
    toEmail: "operator@example.test",
    subject: "Smoke notification",
    body: "Smoke notification body"
  });
  assert.equal(mailResult.notification.channel, "email");
  assert.equal(JSON.stringify(mailResult).includes("MAIL_PASSWORD"), false);
  assert.equal(JSON.stringify(mailResult).includes("SMTP_PASSWORD"), false);

  const mfaSecret = generateTotpSecret();
  const mfaCode = generateTotpCode(mfaSecret);
  assert.equal(/^[A-Z2-7]+$/.test(mfaSecret), true);
  assert.equal(/^\d{6}$/.test(mfaCode), true);
  assert.equal(verifyTotpCode({ secret: mfaSecret, code: mfaCode }), true);
  assert.equal(verifyTotpCode({ secret: mfaSecret, code: "000000", window: 0 }), false);
  assert.equal(createTotpProvisioningUri({ email: "admin@example.test", secret: mfaSecret }).startsWith("otpauth://totp/"), true);

  const storedDom = await storeDomSnapshot({
    portalId: "por_seed_motor",
    jobId: "JOB-SEED-1",
    url: "https://portal.example.test/quote",
    step: "smoke_risk_details",
    sanitizedDom: "<form><input type=\"password\" value=\"portal-secret\" /><label>Vehicle count</label><input /></form>",
    visibleLabels: ["Vehicle count"]
  });
  assert.equal(storedDom.sanitizedDom.includes("portal-secret"), false);
  const domMatch = await matchDomSnapshot({
    portalId: "por_seed_motor",
    jobId: "JOB-SEED-1",
    url: "https://portal.example.test/quote",
    step: "smoke_risk_details",
    currentSanitizedDom: "<form><input type=\"password\" value=\"portal-secret\" /><label>Vehicle count</label><input /></form>",
    visibleLabels: ["Vehicle count"],
    reason: "Smoke cache verification"
  });
  assert.equal(domMatch.mode, "cache_hit");
  if (shouldUseDatabase()) {
    await DomSnapshot.update({ parentSnapshotId: null }, { where: { portalId: "por_seed_motor", step: "smoke_unmatched_state" } });
    await DomSnapshot.destroy({ where: { portalId: "por_seed_motor", step: "smoke_unmatched_state" } });
  }
  const firstDomMatch = await matchDomSnapshot({
    portalId: "por_seed_motor",
    jobId: "JOB-9092",
    url: "https://portal.example.test/quote",
    step: "smoke_unmatched_state",
    currentSanitizedDom: "<form><input name=\"x1\" /></form>",
    visibleLabels: [],
    reason: "Smoke unmatched DOM verification"
  });
  assert.equal(firstDomMatch.mode, "first_observation_stored");
  const changedDomMatch = await matchDomSnapshot({
    portalId: "por_seed_motor",
    jobId: "JOB-9093",
    url: "https://portal.example.test/quote",
    step: "smoke_unmatched_state",
    currentSanitizedDom: "<form><label>Customer name</label><input /></form>",
    visibleLabels: ["Customer name"],
    reason: "Smoke changed DOM verification"
  });
  assert.equal(changedDomMatch.mode, "changed_pending_review");
  assert.equal(changedDomMatch.domVersion, 2);
  assert.equal(JSON.stringify(changedDomMatch).includes("suggestedMapping"), false);
  if (shouldUseDatabase()) {
    await DomSnapshot.destroy({ where: { portalId: "por_seed_motor", step: "smoke_risk_details" } });
    await DomSnapshot.update({ parentSnapshotId: null }, { where: { portalId: "por_seed_motor", step: "smoke_unmatched_state" } });
    await DomSnapshot.destroy({ where: { portalId: "por_seed_motor", step: "smoke_unmatched_state" } });
  }

  if (existsSync("../frontend/.env.example")) {
    const frontendEnvExample = readFileSync("../frontend/.env.example", "utf8");
    const frontendEnvKeys = frontendEnvExample
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("=")[0]);
    assert.equal(frontendEnvKeys.every((key) => key.startsWith("NEXT_PUBLIC_")), true);
  }

  const backendEnvExample = readFileSync(".env.example", "utf8");
  const rootEnvExample = existsSync("../.env.example") ? readFileSync("../.env.example", "utf8") : "";
  assert.equal(`${backendEnvExample}\n${rootEnvExample}`.includes("ChangeMe123!"), false);
  assert.equal(`${backendEnvExample}\n${rootEnvExample}`.includes("DB_PASSWORD=admin"), false);

  const gitignore = existsSync(".gitignore") ? readFileSync(".gitignore", "utf8") : readFileSync("../.gitignore", "utf8");
  assert.equal(gitignore.includes(".env"), true);
  assert.equal(gitignore.includes("*.tsbuildinfo"), true);
  const apiInventoryPath = existsSync("../docs/api-route-inventory.md") ? "../docs/api-route-inventory.md" : "src/routes/internal.routes.ts";
  const apiInventory = readFileSync(apiInventoryPath, "utf8");
  const jobStatusWebSocket = readFileSync("src/realtime/job-status.websocket.ts", "utf8");
  const submissionsRoutes = readFileSync("src/routes/submissions.routes.ts", "utf8");
  assert.equal(
    apiInventory.includes("/api/internal/jobs/:id/actions") ||
      apiInventory.includes("/internal/jobs/:id/actions") ||
      apiInventory.includes("/api/jobs/status-stream?token=<access-token>"),
    true
  );
  assert.equal(jobStatusWebSocket.includes("registerJobStatusWebSocket"), true);
  assert.equal(jobStatusWebSocket.includes("Sec-WebSocket-Accept"), true);
  assert.equal(jobStatusWebSocket.includes("getAuthenticatedUser"), true);
  assert.equal(submissionsRoutes.includes("feedbackSchema"), true);
  assert.equal(submissionsRoutes.includes("submission_feedback_"), true);

  const permissionGuard = requirePermission(permissions.usersManage);
  const unauthenticatedReply = createReplyCapture();
  await permissionGuard({ user: null } as never, unauthenticatedReply as never);
  assert.equal(unauthenticatedReply.statusCode, 401);
  assert.deepEqual(unauthenticatedReply.payload, {
    error: "UNAUTHORIZED",
    message: "Sign in to continue."
  });

  const forbiddenReply = createReplyCapture();
  await permissionGuard({
    user: { permissions: [permissions.dashboardView], role: "staff" }
  } as never, forbiddenReply as never);
  assert.equal(forbiddenReply.statusCode, 403);

  const allowedReply = createReplyCapture();
  await permissionGuard({
    user: { permissions: [permissions.usersManage], role: "admin" }
  } as never, allowedReply as never);
  assert.equal(allowedReply.payload, undefined);

  const roleGuard = requireRoles(["admin"]);
  const roleReply = createReplyCapture();
  await roleGuard({
    user: { permissions: [], role: "staff" }
  } as never, roleReply as never);
  assert.equal(roleReply.statusCode, 403);

  assert.equal(logRedactionPaths.includes("req.headers.authorization"), true);
  const safeError = safeLogError(new Error("provider failed password=super-secret token=abc123"));
  assert.equal(JSON.stringify(safeError).includes("super-secret"), false);
  assert.equal(JSON.stringify(safeError).includes("abc123"), false);
  const metrics = renderMetrics();
  assert.equal(metrics.includes("brokerflow_portal_jobs_queue_depth"), true);
  assert.equal(metrics.includes("brokerflow_integration_configured"), true);
  assert.equal(metrics.includes("admin@example.test"), false);
  assert.equal(metrics.includes("AIza"), false);

  const slaBreaches = await findEscalationSlaBreaches(30);
  assert.equal(Array.isArray(slaBreaches), true);

  if (!shouldUseDatabase()) {
    assert.equal(slaBreaches.some((breach) => breach.escalationId === "ESC-401"), true);
    const slaNotificationResult = await notifyEscalationSlaBreaches(30);
    assert.equal(slaNotificationResult.checked >= 1, true);
    assert.equal(slaNotificationResult.notified, 0);
    const escalationPage = await listEscalationsPage({ page: 1, limit: 1 });
    assert.equal(escalationPage.data.length, 1);
    assert.equal(escalationPage.meta.page, 1);
    assert.equal(escalationPage.meta.limit, 1);
    assert.equal(escalationPage.data[0]?.status, "pending");
    const auditBySubmission = await listAuditLog({ submissionId: "SUB-2026-1001" });
    assert.equal(auditBySubmission.every((record) => record.submissionId === "SUB-2026-1001"), true);
    const auditByPortalAndAction = await listAuditLog({ portalId: "por_axa", actionType: "dom_snapshot" });
    assert.equal(auditByPortalAndAction.some((record) => record.target === "JOB-9091"), true);
    const auditCsv = await exportAuditCsv({ portalId: "por_axa" });
    assert.equal(auditCsv.startsWith("id,timestamp,actor,action,target,submissionId,portalId,status,hash"), true);
    assert.equal(auditCsv.includes("portal-secret"), false);
    const axaPortal = (await listPortals()).find((portal) => portal.id === "por_axa");
    assert.equal(axaPortal?.credentialsConfigured, true);
    assert.equal(typeof axaPortal?.credentialRotationDue, "boolean");
    assert.equal(typeof axaPortal?.credentialAgeDays, "number");
    const managerUsers = await listManagedUsers({ role: "manager" });
    assert.equal(managerUsers.every((user) => user.role === "manager"), true);
    const createdUser = await createManagedUser({
      name: "Smoke User",
      email: `smoke-${Date.now()}@example.test`,
      role: "staff"
    });
    assert.equal(createdUser.user.role, "staff");
    assert.equal(JSON.stringify(createdUser.user).includes(createdUser.temporaryPassword), false);
    const updatedUser = await updateManagedUser(createdUser.user.id, { role: "manager", status: "active" });
    assert.equal(updatedUser?.role, "manager");
    assert.equal(updatedUser?.status, "active");

    const authResult = await login("admin@brokerflow.local", "ChangeMe123!");
    assert.ok(authResult && "token" in authResult);
    assert.equal(authResult.user.email, "admin@brokerflow.local");
    assert.deepEqual(await getAuthenticatedUser(`Bearer ${authResult.token}`), authResult.user);
    assert.equal((await logout(authResult.refreshToken)).ok, true);

    const createdSubmission = await createSubmission({
      customer: { fullName: "Smoke Backend Customer", email: "smoke.customer@example.test" },
      coverageType: "Motor Fleet",
      portalIds: ["por_axa"],
      documentCount: 0,
      actor: "usr_smoke"
    });
    assert.ok("data" in createdSubmission);
    assert.equal(createdSubmission.data.jobs.length, 1);
    assert.equal(createdSubmission.data.jobs[0].payload.portalId, "por_axa");
    assert.equal(JSON.stringify(createdSubmission).includes("password"), false);
    const createdSubmissionId = createdSubmission.data.submission.id;
    assert.equal((await getSubmissionDetail(createdSubmissionId))?.portalJobs.length, 1);
    assert.equal((await listSubmissions({ portalId: "por_axa" })).some((submission) => submission.id === createdSubmissionId), true);
    assert.equal((await cancelSubmission(createdSubmissionId, "usr_smoke"))?.status, "cancelled");

    const createdPortal = await createPortal({
      name: "Smoke Carrier",
      loginUrl: "https://portal.example.test/smoke",
      portalType: "smoke"
    });
    assert.equal(createdPortal.credentialsConfigured, false);
    const updatedPortal = await updatePortal(createdPortal.id, { name: "Smoke Carrier Updated", isActive: false });
    assert.equal(updatedPortal?.name, "Smoke Carrier Updated");
    assert.equal((await listPortals({ portalType: "smoke" })).some((portal) => portal.id === createdPortal.id), true);
    const credentialWrite = await writePortalCredentials(createdPortal.id, {
      username: "smoke-user",
      password: "smoke-password",
      totpSeed: "SMOKESEED"
    }, { actor: "usr_smoke", action: "portal_credentials_rotated" });
    assert.equal(credentialWrite.portalId, createdPortal.id);
    assert.equal(JSON.stringify(credentialWrite).includes("smoke-password"), false);
    assert.equal((await readPortalCredentialsForAgent(createdPortal.id, { actor: "agent-worker", action: "portal_credentials_read" }))?.username, "smoke-user");
    const credentialAudits = await listAuditLog({ target: createdPortal.id });
    assert.equal(credentialAudits.some((record) => record.action === "portal_credentials_rotated" && record.actor === "usr_smoke"), true);
    assert.equal(credentialAudits.some((record) => record.action === "portal_credentials_read" && record.actor === "agent-worker"), true);
    assert.equal(JSON.stringify(credentialAudits).includes("smoke-password"), false);
    const healthCheck = await recordPortalHealthCheck(createdPortal.id, { captureScreenshot: false });
    assert.equal(healthCheck?.checkStatus, "healthy");
    assert.equal(healthCheck?.screenshotUpload.folder, `portals/${createdPortal.id}/health`);
    assert.equal(healthCheck?.screenshotUpload.resourceType, "image");
    assert.equal(JSON.stringify(healthCheck).includes(env.CLOUDINARY_API_SECRET ?? "development-cloudinary-secret"), false);
    assert.equal((await getPortal(createdPortal.id))?.id, createdPortal.id);
    const onboarding = await createPortalOnboarding({
      name: "Smoke Onboarding Portal",
      loginUrl: "https://portal.example.test/onboarding",
      portalType: "onboarding"
    });
    assert.equal(onboarding.onboarding.adapterPath.includes("agent/src/brokerflow_agent/portals/"), true);
    assert.equal(JSON.stringify(onboarding).includes("password"), false);

    const todayStats = await computeDailyStats(new Date().toISOString().slice(0, 10));
    assert.equal(todayStats.submissionsCount >= 1, true);
    assert.equal(Array.isArray(todayStats.operatorStats), true);
    const nightlyStats = await runNightlyDashboardAggregation(new Date("2026-06-02T00:00:00.000Z"));
    assert.equal(nightlyStats.statDate, "2026-06-01");
    const promptReview = await buildGeminiPromptReview();
    assert.equal(promptReview.length >= 1, true);
    assert.equal(JSON.stringify(promptReview).includes("portal-secret"), false);

    const demoData = await import("../src/data/demo-data.js");
    const retryCandidate = demoData.jobs.find((job) => job.id === "JOB-9093");
    assert.ok(retryCandidate);
    retryCandidate.status = "failed";
    retryCandidate.attempts = 1;
    retryCandidate.errorMessage = "password=[redacted]";
    const retriedJob = await retryJob("JOB-9093", "usr_smoke");
    assert.equal(retriedJob?.status, "queued");
    assert.equal(retriedJob?.attempts, 2);
    assert.equal(retriedJob?.errorMessage, null);
    const deadLetterCandidate = demoData.jobs.find((job) => job.id === "JOB-9092");
    assert.ok(deadLetterCandidate);
    deadLetterCandidate.status = "processing";
    deadLetterCandidate.attempts = 0;
    await markJobFailure({ id: "JOB-9092", error: new Error("Portal failed password=super-secret token=abc123"), actor: "agent-worker" });
    await markJobFailure({ id: "JOB-9092", error: new Error("Portal failed again"), actor: "agent-worker" });
    const failedJob = await markJobFailure({ id: "JOB-9092", error: new Error("Portal failed finally"), actor: "agent-worker" });
    assert.equal(failedJob?.status, "failed");
    assert.equal(failedJob?.attempts, 3);
    assert.equal(JSON.stringify(failedJob).includes("super-secret"), false);
    assert.equal(JSON.stringify(failedJob).includes("abc123"), false);
    assert.equal((await deadLetterJobs()).some((job) => job.id === "JOB-9092"), true);

    const action = await recordAgentAction({
      portalJobId: "JOB-9091",
      actionType: "dom_match",
      confidenceScore: 88.5,
      status: "success",
      executedBy: "agent-worker",
      actionPayload: {
        mode: "cache_hit",
        password: "portal-secret",
        authorization: "Bearer abc123"
      }
    });
    assert.equal(action?.action, "dom_match");
    assert.equal(JSON.stringify(action).includes("portal-secret"), false);
    assert.equal(JSON.stringify(action).includes("abc123"), false);

    const quote = await recordQuote({
      portalJobId: "JOB-9091",
      premium: 1250,
      currency: "usd",
      quoteReference: "MOTOR-JOB-9091",
      quotePayload: {
        premium: 1250,
        currency: "usd",
        token: "abc123"
      }
    });
    assert.equal(quote?.premium, 1250);
    assert.equal(quote?.currency, "USD");
    assert.equal(JSON.stringify(quote).includes("abc123"), false);

    const escalation = await createEscalation({
      jobId: "JOB-9091",
      submissionId: "SUB-2026-1001",
      reason: "Smoke escalation",
      suggestedAction: "Review portal state.",
      confidence: 42
    });
    assert.equal(escalation.status, "pending");
    assert.equal(demoData.jobs.find((job) => job.id === "JOB-9091")?.status, "escalated");
    const resolvedEscalation = await resolveEscalation(escalation.id, "usr_smoke", {
      action: "override",
      overrideValue: "Reviewed smoke value"
    });
    assert.equal(resolvedEscalation?.status, "overridden");
    assert.equal(demoData.jobs.find((job) => job.id === "JOB-9091")?.status, "queued");
    assert.equal(
      listQueuedPortalJobs().some((job) =>
        job.payload.portalJobId === "JOB-9091" &&
        job.payload.escalationResolution?.decision === "override" &&
        job.payload.escalationResolution.overrideValue === "Reviewed smoke value"
      ),
      true
    );
    removeQueuedPortalJobsForSubmission("SUB-2026-1001");
  }

  const app = await buildApp();
  app.get("/__smoke_queue_error", async () => {
    throw new Error("Portal job payload requires documentUrls password=super-secret");
  });
  const health = await app.inject({
    method: "GET",
    url: "/api/health",
    headers: { origin: "http://localhost:3000" }
  });
  assert.equal(health.statusCode, 200);
  assert.equal(health.headers["access-control-allow-credentials"], "true");
  assert.equal(typeof health.headers["x-ratelimit-limit"], "string");
  assert.equal(health.headers["x-content-type-options"], "nosniff");

  const invalidLogin = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "not-an-email", password: "short" }
  });
  assert.equal(invalidLogin.statusCode, 400);
  assert.equal(JSON.parse(invalidLogin.body).error, "VALIDATION_ERROR");

  const logoutResponse = await app.inject({ method: "POST", url: "/api/auth/logout" });
  assert.equal(logoutResponse.statusCode, 200);
  assert.equal(JSON.parse(logoutResponse.body).ok, true);
  assert.equal(String(logoutResponse.headers["set-cookie"]).includes("brokerflow_access_token="), true);

  const invalidMfaVerify = await app.inject({
    method: "POST",
    url: "/api/auth/mfa/verify",
    payload: { code: "123" }
  });
  assert.equal(invalidMfaVerify.statusCode, 400);

  const deleteUserUnauthorized = await app.inject({
    method: "DELETE",
    url: "/api/users/usr_001"
  });
  assert.equal([200, 401, 403].includes(deleteUserUnauthorized.statusCode), true);

  const escalationDetailUnauthorized = await app.inject({
    method: "GET",
    url: "/api/escalations/ESC-401"
  });
  assert.equal([200, 401, 403].includes(escalationDetailUnauthorized.statusCode), true);

  const internalDomUnauthorized = await app.inject({
    method: "POST",
    url: "/api/internal/agent/dom-match",
    payload: {
      portalId: "por_smoke_dom",
      jobId: "JOB-SMOKE-DOM",
      url: "https://portal.example.test/quote",
      step: "risk_details",
      currentSanitizedDom: "<form></form>",
      visibleLabels: [],
      reason: "Unauthorized smoke"
    }
  });
  assert.equal(internalDomUnauthorized.statusCode, 401);

  const internalActionUnauthorized = await app.inject({
    method: "POST",
    url: "/api/internal/jobs/JOB-SMOKE/actions",
    payload: {
      actionType: "dom_match",
      confidenceScore: 90,
      status: "success",
      actionPayload: { mode: "cache_hit" }
    }
  });
  assert.equal(internalActionUnauthorized.statusCode, 401);

  const internalQuoteUnauthorized = await app.inject({
    method: "POST",
    url: "/api/internal/jobs/JOB-SMOKE/quotes",
    payload: {
      premium: 1250,
      currency: "USD",
      quoteReference: "MOTOR-JOB-SMOKE",
      quotePayload: { premium: 1250 }
    }
  });
  assert.equal(internalQuoteUnauthorized.statusCode, 401);

  const internalScreenshotUnauthorized = await app.inject({
    method: "POST",
    url: "/api/internal/jobs/JOB-SMOKE/screenshots/sign-upload",
    payload: {
      stage: "before",
      publicId: "JOB-SMOKE-before-fill"
    }
  });
  assert.equal(internalScreenshotUnauthorized.statusCode, 401);

  const metricsUnauthorized = await app.inject({ method: "GET", url: "/api/metrics" });
  assert.equal(metricsUnauthorized.statusCode, 401);

  const errorResponse = await app.inject({ method: "GET", url: "/__smoke_queue_error" });
  const errorBody = JSON.parse(errorResponse.body) as { error?: string; message?: string };
  assert.equal(errorResponse.statusCode, 502);
  assert.equal(errorBody.error, "QUEUE_ERROR");
  assert.equal(errorResponse.body.includes("super-secret"), false);
  await app.close();

  console.log("backend-smoke-ok");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
