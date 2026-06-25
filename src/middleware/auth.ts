import type { FastifyReply, FastifyRequest } from "fastify";
import { getAuthenticatedUser, type SessionUser } from "../services/auth.service.js";
import type { Permission, Role } from "../permissions/permissions.js";

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export async function attachUser(request: FastifyRequest) {
  request.user = await getAuthenticatedUser(request.headers.authorization);
}

function sendUnauthorized(reply: FastifyReply) {
  return reply.code(401).send({
    error: "UNAUTHORIZED",
    message: "Sign in to continue."
  });
}

function sendForbidden(reply: FastifyReply) {
  return reply.code(403).send({
    error: "FORBIDDEN",
    message: "You do not have permission to perform this action."
  });
}

export function requirePermission(permission: Permission) {
  return async function permissionGuard(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return sendUnauthorized(reply);
    }

    if (!request.user.permissions.includes(permission)) {
      return sendForbidden(reply);
    }
  };
}

export function requireRoles(roles: Role[]) {
  return async function roleGuard(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return sendUnauthorized(reply);
    }

    if (!roles.includes(request.user.role)) {
      return sendForbidden(reply);
    }
  };
}
