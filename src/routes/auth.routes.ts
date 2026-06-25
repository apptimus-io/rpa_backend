import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { User } from "../db/models.js";
import { shouldUseDatabase } from "../db/runtime.js";
import { AuthDatabaseUnavailableError, getAuthenticatedUser, login, logout, verifyMfaLogin } from "../services/auth.service.js";
import { encryptSecret, decryptSecret } from "../services/credentials.service.js";
import { createTotpProvisioningUri, generateTotpSecret, verifyTotpCode } from "../services/mfa.service.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const mfaVerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  challengeToken: z.string().optional()
});

const expiredAuthCookies = [
  "brokerflow_access_token=; Path=/; Max-Age=0; SameSite=Lax",
  "brokerflow_refresh_token=; Path=/; Max-Age=0; SameSite=Lax"
];

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", {
    config: {
      rateLimit: {
        max: env.AUTH_RATE_LIMIT_MAX,
        timeWindow: env.AUTH_RATE_LIMIT_WINDOW
      }
    }
  }, async (request, reply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
    }

    let result;
    try {
      result = await login(body.data.email, body.data.password);
    } catch (error) {
      if (error instanceof AuthDatabaseUnavailableError) {
        return reply.code(503).send({
          error: "AUTH_DATABASE_UNAVAILABLE",
          message: "Authentication database is unavailable. Confirm MySQL is running and migrations are applied."
        });
      }
      throw error;
    }
    if (!result) {
      return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
    }

    return result;
  });

  app.post("/auth/logout", async (request, reply) => {
    const refreshToken = request.headers["x-refresh-token"];
    await logout(Array.isArray(refreshToken) ? refreshToken[0] : refreshToken);
    reply.header("set-cookie", expiredAuthCookies);
    return { ok: true };
  });

  app.get("/auth/me", async (request, reply) => {
    const user = await getAuthenticatedUser(request.headers.authorization);
    if (!user) {
      return reply.code(401).send({ error: "UNAUTHORIZED", message: "Sign in to continue." });
    }
    return { user };
  });

  app.post("/auth/mfa/setup", async (request, reply) => {
    if (!shouldUseDatabase()) {
      return reply.code(503).send({ error: "MFA_DATABASE_REQUIRED", message: "MFA setup requires database-backed auth." });
    }

    const user = await getAuthenticatedUser(request.headers.authorization);
    if (!user) {
      return reply.code(401).send({ error: "UNAUTHORIZED", message: "Sign in to continue." });
    }
    if (!["admin", "super_admin"].includes(user.role)) {
      return reply.code(403).send({ error: "FORBIDDEN", message: "Admin role is required for MFA setup." });
    }

    const secret = generateTotpSecret();
    await User.update(
      { mfaSecretCiphertext: encryptSecret(secret) },
      { where: { id: user.id } }
    );

    return {
      data: {
        secret,
        provisioningUri: createTotpProvisioningUri({ email: user.email, secret }),
        verified: false
      }
    };
  });

  app.post("/auth/mfa/verify", {
    config: {
      rateLimit: {
        max: env.AUTH_RATE_LIMIT_MAX,
        timeWindow: env.AUTH_RATE_LIMIT_WINDOW
      }
    }
  }, async (request, reply) => {
    const body = mfaVerifySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
    }

    if (body.data.challengeToken) {
      const result = await verifyMfaLogin(body.data.challengeToken, body.data.code);
      if (!result) {
        return reply.code(401).send({ error: "INVALID_MFA_CODE" });
      }
      return result;
    }

    if (!shouldUseDatabase()) {
      return reply.code(503).send({ error: "MFA_DATABASE_REQUIRED", message: "MFA verification requires database-backed auth." });
    }

    const user = await getAuthenticatedUser(request.headers.authorization);
    if (!user) {
      return reply.code(401).send({ error: "UNAUTHORIZED", message: "Sign in to continue." });
    }

    const row = await User.findByPk(user.id, { raw: true }) as Record<string, unknown> | null;
    if (!row?.mfaSecretCiphertext) {
      return reply.code(404).send({ error: "MFA_NOT_CONFIGURED" });
    }

    const secret = decryptSecret(String(row.mfaSecretCiphertext));
    if (!verifyTotpCode({ secret, code: body.data.code })) {
      return reply.code(401).send({ error: "INVALID_MFA_CODE" });
    }

    return { data: { verified: true } };
  });
}
