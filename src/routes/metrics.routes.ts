import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { renderMetrics } from "../services/metrics.service.js";

function hasMetricsToken(request: { headers: { authorization?: string } }) {
  const token = request.headers.authorization?.replace("Bearer ", "");
  return Boolean(env.METRICS_TOKEN && token === env.METRICS_TOKEN);
}

export async function metricsRoutes(app: FastifyInstance) {
  app.get("/metrics", async (request, reply) => {
    if (!hasMetricsToken(request)) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }

    return reply.type("text/plain; version=0.0.4").send(renderMetrics());
  });
}
