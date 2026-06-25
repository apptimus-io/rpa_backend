import { rolePermissions, type Role } from "../permissions/permissions.js";

export type UserStatus = "active" | "inactive" | "invited" | "password_reset_required";
export type SubmissionStatus = "queued" | "processing" | "completed" | "escalated" | "failed" | "cancelled";
export type JobStatus = "queued" | "processing" | "completed" | "escalated" | "failed" | "cancelled";
export type PortalHealth = "healthy" | "degraded" | "offline";

export const users = [
  {
    id: "usr_001",
    name: "Kumar Admin",
    email: "admin@brokerflow.local",
    role: "super_admin" as Role,
    status: "active" as UserStatus,
    permissions: rolePermissions.super_admin,
    lastLoginAt: "2026-06-01T08:35:00.000Z",
    temporaryPassword: false
  },
  {
    id: "usr_002",
    name: "Maya Manager",
    email: "maya@brokerflow.local",
    role: "manager" as Role,
    status: "active" as UserStatus,
    permissions: rolePermissions.manager,
    lastLoginAt: "2026-06-01T07:12:00.000Z",
    temporaryPassword: false
  },
  {
    id: "usr_003",
    name: "Naveen Staff",
    email: "naveen@brokerflow.local",
    role: "staff" as Role,
    status: "password_reset_required" as UserStatus,
    permissions: rolePermissions.staff,
    lastLoginAt: null,
    temporaryPassword: true
  }
];

export const portals = [
  {
    id: "por_axa",
    name: "AXA Broker Portal",
    loginUrl: "https://portal.example/axa",
    portalType: "motor",
    health: "healthy" as PortalHealth,
    lastHealthCheck: "2026-06-01T08:50:00.000Z",
    successRate: 96,
    credentialsConfigured: true
  },
  {
    id: "por_allianz",
    name: "Allianz Commercial",
    loginUrl: "https://portal.example/allianz",
    portalType: "commercial",
    health: "degraded" as PortalHealth,
    lastHealthCheck: "2026-06-01T08:20:00.000Z",
    successRate: 82,
    credentialsConfigured: true
  },
  {
    id: "por_zurich",
    name: "Zurich SME",
    loginUrl: "https://portal.example/zurich",
    portalType: "sme",
    health: "offline" as PortalHealth,
    lastHealthCheck: "2026-06-01T07:55:00.000Z",
    successRate: 41,
    credentialsConfigured: false
  }
];

export const submissions = [
  {
    id: "SUB-2026-1001",
    customer: "Avery Collins",
    coverageType: "Motor Fleet",
    status: "processing" as SubmissionStatus,
    portalCount: 3,
    documentCount: 4,
    createdAt: "2026-06-01T08:15:00.000Z",
    confidence: 92,
    createdBy: "usr_002"
  },
  {
    id: "SUB-2026-1002",
    customer: "Northline Foods",
    coverageType: "Commercial Property",
    status: "escalated" as SubmissionStatus,
    portalCount: 2,
    documentCount: 7,
    createdAt: "2026-06-01T07:42:00.000Z",
    confidence: 61,
    createdBy: "usr_003"
  },
  {
    id: "SUB-2026-1003",
    customer: "Iris Fernando",
    coverageType: "Personal Auto",
    status: "completed" as SubmissionStatus,
    portalCount: 3,
    documentCount: 2,
    createdAt: "2026-06-01T06:58:00.000Z",
    confidence: 97,
    createdBy: "usr_003"
  }
];

export const jobs = [
  {
    id: "JOB-9091",
    submissionId: "SUB-2026-1001",
    portalId: "por_axa",
    portalName: "AXA Broker Portal",
    status: "processing" as JobStatus,
    step: "Document upload",
    confidence: 92,
    startedAt: "2026-06-01T08:17:00.000Z"
  },
  {
    id: "JOB-9092",
    submissionId: "SUB-2026-1002",
    portalId: "por_allianz",
    portalName: "Allianz Commercial",
    status: "escalated" as JobStatus,
    step: "Risk class mapping",
    confidence: 61,
    startedAt: "2026-06-01T07:46:00.000Z"
  },
  {
    id: "JOB-9093",
    submissionId: "SUB-2026-1003",
    portalId: "por_axa",
    portalName: "AXA Broker Portal",
    status: "completed" as JobStatus,
    step: "Quote extraction",
    confidence: 97,
    startedAt: "2026-06-01T07:00:00.000Z"
  }
];

export const escalations = [
  {
    id: "ESC-401",
    jobId: "JOB-9092",
    submissionId: "SUB-2026-1002",
    reason: "Portal DOM changed: deterministic field match failed for Risk Class",
    suggestedAction: "Map visible label 'Business category' to internal risk_class",
    status: "pending",
    confidence: 61,
    ageMinutes: 34,
    screenshotUrl: "/mock/portal-risk-class.png"
  }
];

export const auditLog = [
  {
    id: "AUD-7001",
    timestamp: "2026-06-01T08:18:32.000Z",
    actor: "agent",
    action: "dom_snapshot_stored",
    target: "JOB-9091",
    status: "success",
    hash: "sha256:91ce0a7f"
  },
  {
    id: "AUD-7002",
    timestamp: "2026-06-01T07:47:12.000Z",
    actor: "agent",
    action: "gemini_fallback_requested",
    target: "JOB-9092",
    status: "escalated",
    hash: "sha256:18b40f9e"
  },
  {
    id: "AUD-7003",
    timestamp: "2026-06-01T06:59:40.000Z",
    actor: "usr_002",
    action: "submission_created",
    target: "SUB-2026-1003",
    status: "success",
    hash: "sha256:ab8c372d"
  }
];
