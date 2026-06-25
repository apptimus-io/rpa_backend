import { dispatchPortalJobToAgent } from "./agent-dispatcher.js";

export type PortalJobPayload = {
  payloadVersion: "v1";
  portalJobId: string;
  submissionId: string;
  portalId: string;
  portalName?: string;
  portalLoginUrl?: string;
  portalQuotationUrl?: string;
  customerId: string;
  submissionDataId?: string;
  customerDataId?: string;
  memberId?: string;
  coverageType?: string;
  coverageTypeCode?: string;
  portalTemplateId?: string;
  censusTemplateId?: string;
  workflowMode?: "individual_entry" | "bulk_upload";
  mappingVersion?: number;
  quoteBatch?: {
    groupBy: "location" | "category" | "salaryBand" | "nationality";
    groupValue?: string;
    locationValue: string;
    label: string;
    memberCount: number;
  };
  documentUrls: string[];
  escalationResolution?: {
    decision: "approve" | "override";
    actor: string;
    overrideValue?: string;
  };
};

export type EnqueuedPortalJob = {
  queueJobId: string;
};

const queuedJobs: Array<{ queueJobId: string; payload: PortalJobPayload; createdAt: string }> = [];

function requiredString(value: string, field: keyof PortalJobPayload) {
  if (!value || typeof value !== "string") {
    throw new Error(`Portal job payload requires ${field}.`);
  }
}

function validateDocumentUrls(documentUrls: string[]) {
  if (!Array.isArray(documentUrls)) {
    throw new Error("Portal job payload requires documentUrls.");
  }
  for (const url of documentUrls) {
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
      throw new Error("Portal job payload documentUrls must contain safe HTTP URLs.");
    }
  }
}

function validateOptionalHttpUrl(url: string | undefined, field: keyof PortalJobPayload) {
  if (url === undefined) {
    return;
  }
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
    throw new Error(`Portal job payload ${field} must be a safe HTTP URL.`);
  }
}

export function buildPortalJobPayload(input: Omit<PortalJobPayload, "payloadVersion">): PortalJobPayload {
  requiredString(input.portalJobId, "portalJobId");
  requiredString(input.submissionId, "submissionId");
  requiredString(input.portalId, "portalId");
  requiredString(input.customerId, "customerId");
  validateDocumentUrls(input.documentUrls);
  validateOptionalHttpUrl(input.portalLoginUrl, "portalLoginUrl");
  validateOptionalHttpUrl(input.portalQuotationUrl, "portalQuotationUrl");

  return {
    payloadVersion: "v1",
    ...input
  };
}

export async function enqueuePortalJob(payload: PortalJobPayload): Promise<EnqueuedPortalJob> {
  const queueJobId = `portal-jobs:${payload.portalJobId}:${Date.now()}`;
  queuedJobs.push({ queueJobId, payload, createdAt: new Date().toISOString() });
  setImmediate(() => {
    const result = dispatchPortalJobToAgent(payload);
    if (!result.dispatched && result.reason !== "disabled") {
      process.stderr.write(`[agent:${payload.portalJobId}] dispatch skipped: ${result.reason}\n`);
    }
  });
  return { queueJobId };
}

export function listQueuedPortalJobs() {
  return [...queuedJobs];
}

export function removeQueuedPortalJobsForSubmission(submissionId: string) {
  const before = queuedJobs.length;
  for (let index = queuedJobs.length - 1; index >= 0; index -= 1) {
    if (queuedJobs[index].payload.submissionId === submissionId) {
      queuedJobs.splice(index, 1);
    }
  }
  return { removed: before - queuedJobs.length };
}
