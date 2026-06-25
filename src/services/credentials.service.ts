import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { PortalCredential } from "../db/models.js";
import { canFallbackFromDatabaseError, shouldUseDatabase } from "../db/runtime.js";
import { recordAudit } from "./audit.service.js";

type PortalCredentials = {
  username: string;
  password: string;
  totpSeed?: string;
};

type CredentialAuditContext = {
  actor?: string;
  action?: string;
};

const memoryStore = new Map<string, { username: string; password: string; totpSeed?: string }>();

function key() {
  if (env.NODE_ENV === "production" && !env.CREDENTIAL_ENCRYPTION_KEY) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is required in production");
  }

  return createHash("sha256")
    .update(env.CREDENTIAL_ENCRYPTION_KEY ?? "development-only-key")
    .digest();
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${ciphertext.toString("base64")}`;
}

export function decryptSecret(payload: string) {
  const [ivRaw, tagRaw, ciphertextRaw] = payload.split(".");
  if (!ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error("Invalid encrypted secret payload");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivRaw, "base64"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64")),
    decipher.final()
  ]).toString("utf8");
}

function recordCredentialAudit(portalId: string, context: CredentialAuditContext | undefined, defaults: { action: string; status: "success" | "failed" }) {
  recordAudit({
    actor: context?.actor ?? "system",
    action: context?.action ?? defaults.action,
    target: portalId,
    status: defaults.status
  });
}

export async function writePortalCredentials(portalId: string, credentials: PortalCredentials, audit?: CredentialAuditContext) {
  const encrypted = {
    username: encryptSecret(credentials.username),
    password: encryptSecret(credentials.password),
    totpSeed: credentials.totpSeed ? encryptSecret(credentials.totpSeed) : undefined
  };

  if (shouldUseDatabase()) {
    try {
      await PortalCredential.upsert({
        id: `cred_${portalId}`,
        portalId,
        usernameCiphertext: encrypted.username,
        passwordCiphertext: encrypted.password,
        totpSeedCiphertext: encrypted.totpSeed ?? null,
        encryptionKeyVersion: "v1",
        rotatedAt: new Date()
      });
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
      memoryStore.set(portalId, encrypted);
    }
  } else {
    memoryStore.set(portalId, encrypted);
  }

  recordCredentialAudit(portalId, audit, { action: "portal_credentials_written", status: "success" });
  return {
    portalId,
    encryptionKeyVersion: "v1",
    rotatedAt: new Date().toISOString()
  };
}

export async function readPortalCredentialsForAgent(portalId: string, audit?: CredentialAuditContext) {
  let encrypted = memoryStore.get(portalId);

  if (!encrypted && shouldUseDatabase()) {
    try {
      const row = await PortalCredential.findOne({ where: { portalId }, raw: true });
      if (row) {
        const data = row as unknown as Record<string, unknown>;
        encrypted = {
          username: String(data.usernameCiphertext),
          password: String(data.passwordCiphertext),
          totpSeed: data.totpSeedCiphertext ? String(data.totpSeedCiphertext) : undefined
        };
      }
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  if (!encrypted) {
    recordCredentialAudit(portalId, audit, { action: "portal_credentials_read_missing", status: "failed" });
    return null;
  }

  recordCredentialAudit(portalId, audit, { action: "portal_credentials_read", status: "success" });
  return {
    username: decryptSecret(encrypted.username),
    password: decryptSecret(encrypted.password),
    totpSeed: encrypted.totpSeed ? decryptSecret(encrypted.totpSeed) : undefined
  };
}
