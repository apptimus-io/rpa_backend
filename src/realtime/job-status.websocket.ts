import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Duplex } from "node:stream";
import type { IncomingMessage } from "node:http";
import { getAuthenticatedUser } from "../services/auth.service.js";
import type { JobRecord } from "../services/jobs.service.js";

type WebSocketClient = {
  id: string;
  socket: Duplex;
  heartbeat: NodeJS.Timeout;
};

export type JobStatusEvent =
  | {
      type: "job_status_changed";
      job: Pick<JobRecord, "id" | "submissionId" | "portalId" | "portalName" | "status" | "step" | "confidence" | "attempts" | "errorMessage">;
    }
  | {
      type: "escalation_count_changed";
      pendingEscalations: number;
    };

const clients = new Set<WebSocketClient>();

function websocketAcceptKey(key: string) {
  return createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
}

function frameText(payload: string) {
  const body = Buffer.from(payload);
  if (body.length < 126) {
    return Buffer.concat([Buffer.from([0x81, body.length]), body]);
  }
  if (body.length < 65_536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
    return Buffer.concat([header, body]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(body.length), 2);
  return Buffer.concat([header, body]);
}

function send(client: WebSocketClient, event: JobStatusEvent | { type: "connected"; pendingEscalations: number } | { type: "heartbeat" }) {
  if (client.socket.destroyed) {
    return;
  }
  client.socket.write(frameText(JSON.stringify(event)));
}

function closeClient(client: WebSocketClient) {
  clearInterval(client.heartbeat);
  clients.delete(client);
  if (!client.socket.destroyed) {
    client.socket.end();
  }
}

async function pendingEscalationCount() {
  const { listEscalations } = await import("../services/escalations.service.js");
  const escalations = await listEscalations();
  return escalations.filter((item) => item.status === "pending").length;
}

async function authorize(request: IncomingMessage) {
  const requestUrl = new URL(request.url ?? "", "http://localhost");
  const token = requestUrl.searchParams.get("token");
  const header = token ? `Bearer ${token}` : request.headers.authorization;
  const user = await getAuthenticatedUser(header);
  return user?.permissions.includes("dashboard:view") || user?.permissions.includes("escalations:view");
}

export function broadcastJobStatus(event: JobStatusEvent) {
  for (const client of clients) {
    send(client, event);
  }
}

export async function broadcastEscalationCount() {
  broadcastJobStatus({
    type: "escalation_count_changed",
    pendingEscalations: await pendingEscalationCount()
  });
}

export function registerJobStatusWebSocket(app: FastifyInstance) {
  app.server.on("upgrade", async (request, socket) => {
    const requestUrl = new URL(request.url ?? "", "http://localhost");
    if (requestUrl.pathname !== "/api/jobs/status-stream") {
      return;
    }

    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string" || request.headers.upgrade?.toLowerCase() !== "websocket") {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    if (!(await authorize(request))) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${websocketAcceptKey(key)}`,
      "\r\n"
    ].join("\r\n"));

    const client: WebSocketClient = {
      id: `ws_${Math.random().toString(36).slice(2)}`,
      socket,
      heartbeat: setInterval(() => {
        send(client, { type: "heartbeat" });
      }, 30_000)
    };
    clients.add(client);
    socket.on("close", () => closeClient(client));
    socket.on("error", () => closeClient(client));
    send(client, { type: "connected", pendingEscalations: await pendingEscalationCount() });
  });
}
