import { portals } from "../data/demo-data.js";
import { CensusTemplate, DomSnapshot, ExcelMappingTemplate, InsurerWorkflow, Portal, PortalCredential, PortalDialog, PortalFieldMapping, PortalJob, PortalTemplate, Quote } from "../db/models.js";
import { canFallbackFromDatabaseError, shouldUseDatabase } from "../db/runtime.js";
import { readPortalCredentialsForAgent } from "./credentials.service.js";
import { captureAndUploadPortalHealthScreenshot } from "./portal-health-screenshot.service.js";

const CREDENTIAL_ROTATION_DAYS = 90;

type CredentialRotationMetadata = {
  credentialRotatedAt: string | null;
  credentialAgeDays: number | null;
  credentialRotationDue: boolean;
};

type PortalV2Metadata = {
  quotationUrl?: string | null;
  loginType?: string;
  workflowType?: string;
  censusDownloadRequired?: boolean;
  calculateRequired?: boolean;
  quotePdfStrategy?: string;
  portalConfig?: Record<string, unknown> | null;
};

type PortalRecord = (typeof portals)[number] & { isActive?: boolean } & CredentialRotationMetadata & PortalV2Metadata;

export class PortalDeleteBlockedError extends Error {
  constructor(public readonly details: Record<string, number>) {
    super("Portal cannot be deleted because automation history or mappings reference it. Deactivate it instead, or remove linked records first.");
    this.name = "PortalDeleteBlockedError";
  }
}

function rotationMetadata(rotatedAt: unknown, configured: boolean): CredentialRotationMetadata {
  if (!configured || !rotatedAt) {
    return {
      credentialRotatedAt: null,
      credentialAgeDays: null,
      credentialRotationDue: configured
    };
  }

  const rotated = new Date(rotatedAt as string | Date);
  if (Number.isNaN(rotated.getTime())) {
    return {
      credentialRotatedAt: null,
      credentialAgeDays: null,
      credentialRotationDue: true
    };
  }

  const ageDays = Math.max(0, Math.floor((Date.now() - rotated.getTime()) / 86_400_000));
  return {
    credentialRotatedAt: rotated.toISOString(),
    credentialAgeDays: ageDays,
    credentialRotationDue: ageDays >= CREDENTIAL_ROTATION_DAYS
  };
}

function toPortalRecord(row: Record<string, unknown>, credentialMetadata: Map<string, CredentialRotationMetadata>): PortalRecord {
  const credentialState = credentialMetadata.get(String(row.id)) ?? rotationMetadata(null, false);
  return {
    id: String(row.id),
    name: String(row.name),
    loginUrl: String(row.loginUrl),
    portalType: String(row.portalType),
    quotationUrl: row.quotationUrl ? String(row.quotationUrl) : String(row.loginUrl),
    loginType: row.loginType ? String(row.loginType) : "credentials",
    workflowType: row.workflowType ? String(row.workflowType) : normalizeWorkflowType(String(row.portalType)),
    censusDownloadRequired: Boolean(row.censusDownloadRequired),
    calculateRequired: Boolean(row.calculateRequired),
    quotePdfStrategy: row.quotePdfStrategy ? String(row.quotePdfStrategy) : "direct_download",
    portalConfig: row.portalConfig && typeof row.portalConfig === "object" ? row.portalConfig as Record<string, unknown> : null,
    health: row.health as PortalRecord["health"],
    lastHealthCheck: row.lastHealthCheck ? new Date(row.lastHealthCheck as string | Date).toISOString() : new Date().toISOString(),
    successRate: Number(row.successRate ?? 0),
    credentialsConfigured: Boolean(credentialState.credentialRotatedAt) || credentialState.credentialRotationDue,
    isActive: row.isActive !== false,
    ...credentialState
  };
}

async function credentialRotationMetadata() {
  const rows = await PortalCredential.findAll({ attributes: ["portalId", "rotatedAt"], raw: true });
  return new Map(rows.map((row) => {
    const record = row as unknown as Record<string, unknown>;
    return [String(record.portalId), rotationMetadata(record.rotatedAt, true)];
  }));
}

function demoPortalRecord(portal: (typeof portals)[number]): PortalRecord {
  return {
    ...portal,
    ...rotationMetadata(portal.credentialsConfigured ? portal.lastHealthCheck : null, portal.credentialsConfigured)
  };
}

export type PortalListFilters = {
  isActive?: boolean;
  portalType?: string;
  page?: number;
  limit?: number;
};

function applyPortalFilters(records: PortalRecord[], filters: PortalListFilters = {}) {
  const filtered = records.filter((portal) => {
    if (filters.isActive !== undefined && (portal.isActive !== false) !== filters.isActive) return false;
    if (filters.portalType && portal.portalType !== filters.portalType) return false;
    return true;
  });
  const page = filters.page ?? 1;
  const limit = filters.limit ?? (filtered.length || 1);
  return filtered.slice((page - 1) * limit, page * limit);
}

export async function listPortals(filters: PortalListFilters = {}) {
  if (shouldUseDatabase()) {
    try {
      const [rows, credentialMetadata] = await Promise.all([
        Portal.findAll({
          where: {
            ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
            ...(filters.portalType ? { portalType: filters.portalType } : {})
          },
          order: [["name", "ASC"]],
          offset: filters.page && filters.limit ? (filters.page - 1) * filters.limit : undefined,
          limit: filters.limit,
          raw: true
        }),
        credentialRotationMetadata()
      ]);
      return rows.map((row) => toPortalRecord(row as unknown as Record<string, unknown>, credentialMetadata));
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  return applyPortalFilters(portals.map(demoPortalRecord), filters);
}

export async function getPortal(id: string) {
  if (shouldUseDatabase()) {
    try {
      const row = await Portal.findByPk(id, { raw: true });
      if (!row) {
        return null;
      }
      return toPortalRecord(row as unknown as Record<string, unknown>, await credentialRotationMetadata());
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  const portal = portals.find((item) => item.id === id);
  return portal ? demoPortalRecord(portal) : null;
}

export async function createPortal(input: { name: string; loginUrl: string; portalType: string; quotationUrl?: string; loginType?: string; workflowType?: string; censusDownloadRequired?: boolean; calculateRequired?: boolean; quotePdfStrategy?: string; portalConfig?: Record<string, unknown> | null }) {
  const portal: PortalRecord = {
    id: `por_${Math.floor(Math.random() * 9000 + 1000)}`,
    name: input.name,
    loginUrl: input.loginUrl,
    portalType: input.portalType,
    quotationUrl: input.quotationUrl ?? input.loginUrl,
    loginType: input.loginType ?? "credentials",
    workflowType: input.workflowType ?? normalizeWorkflowType(input.portalType),
    censusDownloadRequired: Boolean(input.censusDownloadRequired),
    calculateRequired: Boolean(input.calculateRequired),
    quotePdfStrategy: input.quotePdfStrategy ?? "direct_download",
    portalConfig: input.portalConfig ?? null,
    health: "healthy",
    lastHealthCheck: new Date().toISOString(),
    successRate: 0,
    credentialsConfigured: false,
    isActive: true,
    ...rotationMetadata(null, false)
  };

  if (shouldUseDatabase()) {
    try {
      const row = await Portal.create({
        id: portal.id,
        name: portal.name,
        loginUrl: portal.loginUrl,
        portalType: portal.portalType,
        quotationUrl: portal.quotationUrl,
        loginType: portal.loginType,
        workflowType: portal.workflowType,
        censusDownloadRequired: portal.censusDownloadRequired,
        calculateRequired: portal.calculateRequired,
        quotePdfStrategy: portal.quotePdfStrategy,
        portalConfig: portal.portalConfig,
        health: portal.health,
        successRate: portal.successRate,
        lastHealthCheck: portal.lastHealthCheck,
        isActive: true
      });
      return toPortalRecord(row.get({ plain: true }) as unknown as Record<string, unknown>, new Map());
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  portals.push(portal);
  return portal;
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "portal";
}

export async function createPortalOnboarding(input: { name: string; loginUrl: string; portalType: string; quotationUrl?: string; loginType?: string; workflowType?: string; censusDownloadRequired?: boolean; calculateRequired?: boolean; quotePdfStrategy?: string; portalConfig?: Record<string, unknown> | null }) {
  const portal = await createPortal(input);
  const adapterSlug = slug(`${portal.portalType}-${portal.name}`);
  return {
    portal,
    onboarding: {
      adapterSlug,
      adapterPath: `agent/src/brokerflow_agent/portals/${adapterSlug}.py`,
      registryEntry: `register_portal("${portal.id}", ${adapterSlug}_rules)`,
      requiredSteps: [
        "Create rule-based Playwright adapter for login, form fill, document upload, quote extraction, and health check.",
        "Register adapter in agent/src/brokerflow_agent/portals/registry.py.",
        "Capture sanitized DOM snapshots through the backend internal DOM APIs.",
        "Verify selectors with Playwright before caching Gemini-assisted mappings.",
        "Store credentials through POST /api/portals/:id/credentials; do not place credentials in adapter code."
      ],
      verificationCommands: [
        "npm run test:agent",
        "npm run test:smoke"
      ]
    }
  };
}

export async function updatePortal(id: string, input: { name?: string; loginUrl?: string; portalType?: string; quotationUrl?: string; loginType?: string; workflowType?: string; censusDownloadRequired?: boolean; calculateRequired?: boolean; quotePdfStrategy?: string; portalConfig?: Record<string, unknown> | null; isActive?: boolean }) {
  if (shouldUseDatabase()) {
    try {
      const [updated] = await Portal.update(input, { where: { id } });
      if (!updated) {
        return null;
      }
      return getPortal(id);
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  const portal = portals.find((item) => item.id === id) as PortalRecord | undefined;
  if (!portal) {
    return null;
  }
  Object.assign(portal, input);
  return portal;
}

function normalizeWorkflowType(portalType: string) {
  const normalized = portalType.toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized.includes("census")) return "census_upload";
  if (normalized.includes("benefit")) return "benefits_builder";
  return "hybrid";
}

export async function deletePortal(id: string) {
  if (shouldUseDatabase()) {
    try {
      const portal = await Portal.findByPk(id);
      if (!portal) {
        return null;
      }

      const [jobCount, snapshotCount, mappingCount, workflowCount, templateCount, quoteCount, portalTemplateCount, censusTemplateCount, dialogCount] = await Promise.all([
        PortalJob.count({ where: { portalId: id } }),
        DomSnapshot.count({ where: { portalId: id } }),
        PortalFieldMapping.count({ where: { portalId: id } }),
        InsurerWorkflow.count({ where: { portalId: id } }),
        ExcelMappingTemplate.count({ where: { portalId: id } }),
        Quote.count({ where: { portalId: id } }),
        PortalTemplate.count({ where: { portalId: id } }),
        CensusTemplate.count({ where: { portalId: id } }),
        PortalDialog.count({ where: { portalId: id } })
      ]);
      const blockers = {
        jobs: jobCount,
        domSnapshots: snapshotCount,
        fieldMappings: mappingCount,
        workflows: workflowCount,
        mappingTemplates: templateCount,
        portalTemplates: portalTemplateCount,
        censusTemplates: censusTemplateCount,
        dialogs: dialogCount,
        quotes: quoteCount
      };
      if (Object.values(blockers).some((count) => count > 0)) {
        throw new PortalDeleteBlockedError(blockers);
      }

      await PortalCredential.destroy({ where: { portalId: id } });
      await portal.destroy();
      return { id, deleted: true };
    } catch (error) {
      if (error instanceof PortalDeleteBlockedError) throw error;
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  const index = portals.findIndex((item) => item.id === id);
  if (index === -1) {
    return null;
  }
  portals.splice(index, 1);
  return { id, deleted: true };
}

export async function markPortalCredentialsConfigured(id: string) {
  if (!shouldUseDatabase()) {
    const portal = portals.find((item) => item.id === id);
    if (portal) {
      portal.credentialsConfigured = true;
    }
  }
}

export async function recordPortalHealthCheck(id: string, options: { captureScreenshot?: boolean } = {}) {
  const portal = await getPortal(id);
  if (!portal) {
    return null;
  }

  const credentials = await readPortalCredentialsForAgent(id);
  const nextHealth = credentials ? "healthy" : "degraded";
  const safeMessage = credentials
    ? "Credentials resolved from encrypted storage; lightweight metadata health check passed."
    : "Credentials are not configured; portal login health cannot be verified.";
  const screenshot = options.captureScreenshot === false
    ? await captureAndUploadPortalHealthScreenshot(id, portal.loginUrl, { capture: false })
    : await captureAndUploadPortalHealthScreenshot(id, portal.loginUrl);

  if (shouldUseDatabase()) {
    try {
      const [updated] = await Portal.update(
        { lastHealthCheck: new Date(), health: nextHealth },
        { where: { id } }
      );
      if (!updated) {
        return null;
      }
      const updatedPortal = await getPortal(id);
      return updatedPortal ? { ...updatedPortal, checkStatus: nextHealth, message: safeMessage, ...screenshot } : null;
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  const demoPortal = portals.find((item) => item.id === id);
  if (!demoPortal) {
    return null;
  }
  demoPortal.lastHealthCheck = new Date().toISOString();
  demoPortal.health = nextHealth;
  return { ...demoPortal, checkStatus: nextHealth, message: safeMessage, ...screenshot };
}
