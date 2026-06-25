import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listNotifications, markNotificationRead } from "../services/notification.service.js";
import { requirePermission } from "../middleware/auth.js";
import { permissions } from "../permissions/permissions.js";

const readSchema = z.object({
  read: z.literal(true)
});

const notificationParamsSchema = z.object({
  id: z.string().min(1).max(64)
});

export async function notificationsRoutes(app: FastifyInstance) {
  app.get(
    "/notifications",
    { preHandler: [requirePermission(permissions.notificationsView)] },
    async (request) => ({
      data: listNotifications(request.user!.id),
      unreadCount: listNotifications(request.user!.id).filter((item) => !item.read).length
    })
  );

  app.patch(
    "/notifications/:id",
    { preHandler: [requirePermission(permissions.notificationsView)] },
    async (request, reply) => {
      const params = notificationParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: params.error.issues });
      }
      const body = readSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: body.error.issues });
      }

      const { id } = params.data;
      const notification = markNotificationRead(id, request.user!.id);
      if (!notification) {
        return reply.code(404).send({ error: "NOTIFICATION_NOT_FOUND" });
      }
      return { data: notification };
    }
  );
}
