import { createHash, createHmac, randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { users } from "../data/demo-data.js";
import { AuthSession, User } from "../db/models.js";
import { canFallbackFromDatabaseError, shouldUseDatabase } from "../db/runtime.js";
import { rolePermissions, type Permission, type Role } from "../permissions/permissions.js";
import { verifyPassword } from "../utils/password.js";
import { literal } from "sequelize";
import { decryptSecret } from "./credentials.service.js";
import { verifyTotpCode } from "./mfa.service.js";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  permissions: Permission[];
  mustChangePassword: boolean;
};

type AuthTokenPayload = {
  sub: string;
  email: string;
  role: Role;
  type: "access" | "refresh" | "mfa";
  iat: number;
  exp: number;
  nonce: string;
};

export class AuthDatabaseUnavailableError extends Error {
  constructor() {
    super("Authentication database is unavailable.");
    this.name = "AuthDatabaseUnavailableError";
  }
}

function base64Url(input: string) {
  return Buffer.from(input).toString("base64url");
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function hashRefreshToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function durationToSeconds(value: string, fallbackSeconds: number) {
  const match = value.trim().match(/^(\d+)\s*([smhd])?$/i);
  if (!match) return fallbackSeconds;
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase() ?? "s";
  if (unit === "m") return amount * 60;
  if (unit === "h") return amount * 60 * 60;
  if (unit === "d") return amount * 24 * 60 * 60;
  return amount;
}

function issueToken(user: SessionUser, type: "access" | "refresh" | "mfa") {
  const secret = type === "access"
    ? env.ACCESS_TOKEN_SECRET ?? "development-access-token-secret"
    : env.REFRESH_TOKEN_SECRET ?? "development-refresh-token-secret";
  const now = Math.floor(Date.now() / 1000);
  const payload: AuthTokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    type,
    iat: now,
    exp: now + (type === "access" ? durationToSeconds(env.ACCESS_TOKEN_TTL, 60 * 60 * 8) : type === "mfa" ? 60 * 5 : 60 * 60 * 24 * 14),
    nonce: randomBytes(8).toString("hex")
  };
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64Url(JSON.stringify(payload));
  return `${header}.${body}.${sign(`${header}.${body}`, secret)}`;
}

function parsePermissions(value: unknown, role: Role): Permission[] {
  if (Array.isArray(value)) {
    return value as Permission[];
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed as Permission[];
      }
    } catch {
      return rolePermissions[role] ?? [];
    }
  }
  return rolePermissions[role] ?? [];
}

function toSessionUser(row: Record<string, unknown>): SessionUser {
  const role = String(row.role) as Role;
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role,
    permissions: parsePermissions(row.permissions, role),
    mustChangePassword: Boolean(row.mustChangePassword)
  };
}

function demoCurrentUser(): SessionUser {
  const user = users[0];
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    permissions: user.permissions,
    mustChangePassword: user.temporaryPassword
  };
}

async function getDbUserByEmail(email: string) {
  const row = await User.findOne({ where: { email }, raw: true });
  return row as Record<string, unknown> | null;
}

async function getDbUserById(id: string) {
  const row = await User.findByPk(id, { raw: true });
  return row as Record<string, unknown> | null;
}

function isLocked(row: Record<string, unknown>) {
  return Boolean(row.lockedUntil) && new Date(row.lockedUntil as string | Date).getTime() > Date.now();
}

async function recordFailedLogin(row: Record<string, unknown>) {
  await User.update(
    {
      failedLoginAttempts: literal("failed_login_attempts + 1"),
      lockedUntil: literal("CASE WHEN failed_login_attempts + 1 >= 5 THEN DATE_ADD(NOW(), INTERVAL 15 MINUTE) ELSE NULL END")
    },
    { where: { id: String(row.id) } }
  );
}

async function recordSuccessfulLogin(userId: string) {
  await User.update(
    {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date()
    },
    { where: { id: userId } }
  );
}

async function createAuthSession(userId: string, refreshToken: string) {
  await AuthSession.create({
    id: `ses_${randomBytes(8).toString("hex")}`,
    userId,
    refreshTokenHash: hashRefreshToken(refreshToken),
    expiresAt: new Date(Date.now() + 60 * 60 * 24 * 14 * 1000)
  });
}

export async function logout(refreshToken?: string) {
  if (shouldUseDatabase() && refreshToken) {
    try {
      await AuthSession.update(
        { revokedAt: new Date() },
        {
          where: {
            refreshTokenHash: hashRefreshToken(refreshToken),
            revokedAt: null
          }
        }
      );
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  return { ok: true };
}

function decodeToken(authorization?: string) {
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }
  const token = authorization.slice("Bearer ".length).trim();
  const [header, body, signature] = token.split(".");
  if (!header || !body || !signature) {
    return null;
  }

  const expected = sign(`${header}.${body}`, env.ACCESS_TOKEN_SECRET ?? "development-access-token-secret");
  if (signature !== expected) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AuthTokenPayload;
    if (payload.type !== "access" || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function decodeMfaToken(token?: string) {
  if (!token) {
    return null;
  }
  const [header, body, signature] = token.trim().split(".");
  if (!header || !body || !signature) {
    return null;
  }

  const expected = sign(`${header}.${body}`, env.REFRESH_TOKEN_SECRET ?? "development-refresh-token-secret");
  if (signature !== expected) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AuthTokenPayload;
    if (payload.type !== "mfa" || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function getAuthenticatedUser(authorization?: string): Promise<SessionUser | null> {
  if (shouldUseDatabase()) {
    try {
      const tokenPayload = decodeToken(authorization);
      const row = tokenPayload?.sub ? await getDbUserById(tokenPayload.sub) : null;
      if (row) {
        if (String(row.status) !== "active") {
          return null;
        }
        return toSessionUser(row);
      }
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
      return null;
    }
    return null;
  }

  return demoCurrentUser();
}

export async function getCurrentUser(authorization?: string): Promise<SessionUser> {
  const user = await getAuthenticatedUser(authorization);
  if (user) {
    return user;
  }
  return demoCurrentUser();
}

export async function login(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();

  if (shouldUseDatabase()) {
    try {
      const row = await getDbUserByEmail(normalizedEmail);
      if (!row || String(row.status) !== "active" || isLocked(row)) {
        return null;
      }

      const passwordMatches = await verifyPassword(password, String(row.passwordHash));
      if (!passwordMatches) {
        await recordFailedLogin(row);
        return null;
      }

      const user = toSessionUser(row);
      await recordSuccessfulLogin(user.id);
      if (row.mfaSecretCiphertext) {
        return {
          mfaRequired: true,
          challengeToken: issueToken(user, "mfa"),
          user: {
            id: user.id,
            email: user.email,
            role: user.role
          }
        };
      }

      const refreshToken = issueToken(user, "refresh");
      await createAuthSession(user.id, refreshToken);

      return {
        token: issueToken(user, "access"),
        refreshToken,
        user
      };
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw new AuthDatabaseUnavailableError();
      return null;
    }
  }

  const user = users.find((candidate) => candidate.email === normalizedEmail);
  if (!user || password.length < 8) {
    return null;
  }

  const sessionUser: SessionUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    permissions: rolePermissions[user.role],
    mustChangePassword: user.temporaryPassword
  };

  return {
    token: issueToken(sessionUser, "access"),
    refreshToken: issueToken(sessionUser, "refresh"),
    user: sessionUser
  };
}

export async function verifyMfaLogin(challengeToken: string, code: string) {
  if (!shouldUseDatabase()) {
    return null;
  }

  const payload = decodeMfaToken(challengeToken);
  if (!payload) {
    return null;
  }

  const row = await getDbUserById(payload.sub);
  if (!row || String(row.status) !== "active" || !row.mfaSecretCiphertext) {
    return null;
  }

  const secret = decryptSecret(String(row.mfaSecretCiphertext));
  if (!verifyTotpCode({ secret, code })) {
    return null;
  }

  const user = toSessionUser(row);
  await recordSuccessfulLogin(user.id);
  const refreshToken = issueToken(user, "refresh");
  await createAuthSession(user.id, refreshToken);

  return {
    token: issueToken(user, "access"),
    refreshToken,
    user
  };
}
