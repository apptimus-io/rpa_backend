import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "../config/env.js";
import type { PortalJobPayload } from "./portal-jobs.queue.js";

function isTestLifecycle() {
  return process.env.NODE_ENV === "test" || process.env.npm_lifecycle_event?.includes("test");
}

function pythonCommand() {
  if (!env.AGENT_PYTHON_PATH) {
    return "python";
  }
  const configured = resolve(process.cwd(), env.AGENT_PYTHON_PATH);
  return existsSync(configured) ? configured : env.AGENT_PYTHON_PATH;
}

export function dispatchPortalJobToAgent(payload: PortalJobPayload) {
  if (!env.AGENT_AUTO_RUN || isTestLifecycle()) {
    return { dispatched: false, reason: "disabled" };
  }

  if (!env.INTERNAL_AGENT_TOKEN) {
    return { dispatched: false, reason: "missing_internal_agent_token" };
  }

  if (!env.AGENT_WORKDIR) {
    return { dispatched: false, reason: "missing_agent_workdir" };
  }

  const agentWorkdir = resolve(process.cwd(), env.AGENT_WORKDIR);
  if (!existsSync(agentWorkdir)) {
    return { dispatched: false, reason: "missing_agent_workdir" };
  }

  const child = spawn(
    pythonCommand(),
    ["-m", "brokerflow_agent.worker", JSON.stringify(payload)],
    {
      cwd: agentWorkdir,
      windowsHide: true,
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONPATH: "src",
        BACKEND_API_BASE_URL: `${env.API_PUBLIC_URL.replace(/\/$/, "")}/api`,
        INTERNAL_AGENT_TOKEN: env.INTERNAL_AGENT_TOKEN,
        REDIS_URL: env.REDIS_URL ?? "redis://localhost:6379"
      }
    }
  );

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[agent:${payload.portalJobId}] ${chunk.toString()}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[agent:${payload.portalJobId}] ${chunk.toString()}`);
  });
  child.on("error", (error) => {
    process.stderr.write(`[agent:${payload.portalJobId}] failed to start: ${error.message}\n`);
  });
  child.on("exit", (code) => {
    process.stdout.write(`[agent:${payload.portalJobId}] exited with code ${code ?? "unknown"}\n`);
  });

  return { dispatched: true, pid: child.pid };
}
