import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { permissions } from "../permissions/permissions.js";
import { requirePermission } from "../middleware/auth.js";
import { exportAuditCsv, listAuditLog } from "../services/audit.service.js";
import { withDateRange } from "../validation/common.schemas.js";

const auditQuerySchema = withDateRange({
  actor: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  action_type: z.string().min(1).optional(),
  target: z.string().min(1).optional(),
  submission_id: z.string().min(1).optional(),
  portal: z.string().min(1).optional(),
  status: z.enum(["success", "failed", "escalated"]).optional(),
  q: z.string().min(1).optional()
}).transform((value) => ({
  ...value,
  actionType: value.action_type,
  submissionId: value.submission_id,
  portalId: value.portal
}));

export async function auditRoutes(app: FastifyInstance) {
  app.get(
    "/audit",
    { preHandler: [requirePermission(permissions.auditView)] },
    async (request, reply) => {
      const query = auditQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: query.error.issues });
      }
      return { data: await listAuditLog(query.data) };
    }
  );

  app.get(
    "/audit/export",
    { preHandler: [requirePermission(permissions.auditExport)] },
    async (request, reply) => {
      const query = auditQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", issues: query.error.issues });
      }
      const csv = await exportAuditCsv(query.data);
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="audit-export-${new Date().toISOString().slice(0, 10)}.csv"`)
        .send(csv);
    }
  );
}
