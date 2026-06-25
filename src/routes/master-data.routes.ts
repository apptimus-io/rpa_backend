import type { FastifyInstance } from "fastify";
import { requirePermission } from "../middleware/auth.js";
import { permissions } from "../permissions/permissions.js";
import { listCoverageTypes } from "../services/master-data.service.js";

export async function masterDataRoutes(app: FastifyInstance) {
  app.get(
    "/master-data/coverage-types",
    { preHandler: [requirePermission(permissions.submissionsView)] },
    async () => ({ data: await listCoverageTypes() })
  );
}
