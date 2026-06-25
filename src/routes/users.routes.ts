import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { permissions } from "../permissions/permissions.js";
import { requirePermission } from "../middleware/auth.js";
import { notify } from "../services/notification.service.js";
import { recordAudit } from "../services/audit.service.js";
import { createManagedUser, DuplicateUserEmailError, listManagedUsers, resetManagedUserTemporaryPassword, updateManagedUser } from "../services/users.service.js";

const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  role: z.enum(["super_admin", "admin", "manager", "staff", "custom"])
});

const updateUserSchema = z.object({
  role: z.enum(["super_admin", "admin", "manager", "staff", "custom"]).optional(),
  status: z.enum(["active", "inactive", "invited", "password_reset_required"]).optional(),
  permissions: z.array(z.string()).optional()
});

const userListQuerySchema = z.object({
  role: z.enum(["super_admin", "admin", "manager", "staff", "custom"]).optional()
});

export async function usersRoutes(app: FastifyInstance) {
  app.get(
    "/users",
    { preHandler: [requirePermission(permissions.usersManage)] },
    async (request, reply) => {
      const query = userListQuerySchema.safeParse(request.query ?? {});
      if (!query.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: query.error.issues });
      }
      return { data: await listManagedUsers(query.data) };
    }
  );

  app.post(
    "/users",
    { preHandler: [requirePermission(permissions.usersManage)] },
    async (request, reply) => {
      const body = createUserSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      }

      let user;
      let temporaryPassword;
      try {
        ({ user, temporaryPassword } = await createManagedUser(body.data));
      } catch (error) {
        if (error instanceof DuplicateUserEmailError) {
          return reply.code(409).send({ error: "USER_EMAIL_EXISTS", message: "A user with this email already exists." });
        }
        throw error;
      }
      notify({
        userId: user.id,
        channel: "email",
        title: "Temporary password generated",
        body: `Temporary password created and must be changed on first login. Reference: ${temporaryPassword.slice(0, 4)}...`
      });
      recordAudit({ actor: request.user!.id, action: "user_invited", target: user.id, status: "success" });
      return reply.code(201).send({ data: user });
    }
  );

  app.patch(
    "/users/:id",
    { preHandler: [requirePermission(permissions.usersManage)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = updateUserSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      }

      const user = await updateManagedUser(id, body.data);
      if (!user) {
        return reply.code(404).send({ error: "USER_NOT_FOUND" });
      }
      recordAudit({ actor: request.user!.id, action: "user_updated", target: user.id, status: "success" });
      return { data: user };
    }
  );

  app.post(
    "/users/:id/temporary-password",
    { preHandler: [requirePermission(permissions.usersManage)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await resetManagedUserTemporaryPassword(id);
      if (!result) {
        return reply.code(404).send({ error: "USER_NOT_FOUND" });
      }

      notify({
        userId: result.userId,
        channel: "email",
        title: "Temporary password regenerated",
        body: `A temporary password was regenerated and must be changed on next login. Reference: ${result.temporaryPassword.slice(0, 4)}...`
      });
      recordAudit({ actor: request.user!.id, action: "temporary_password_regenerated", target: result.userId, status: "success" });

      return {
        data: {
          userId: result.userId,
          mustChangePassword: true,
          deliveredBy: "email"
        }
      };
    }
  );

  app.delete(
    "/users/:id",
    { preHandler: [requirePermission(permissions.usersManage)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = await updateManagedUser(id, { status: "inactive" });
      if (!user) {
        return reply.code(404).send({ error: "USER_NOT_FOUND" });
      }
      recordAudit({ actor: request.user!.id, action: "user_deactivated", target: user.id, status: "success" });
      return { data: user };
    }
  );
}
