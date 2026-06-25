import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ForeignKeyConstraintError, UniqueConstraintError, ValidationError as SequelizeValidationError } from "sequelize";
import { ZodError } from "zod";
import { ApiError, redactSensitiveText } from "../utils/http-errors.js";

type SafeErrorBody = {
  error: string;
  message: string;
  requestId: string;
  fields?: Array<{ path: string; message: string }>;
};

function mapError(error: FastifyError | Error): { statusCode: number; body: Omit<SafeErrorBody, "requestId"> } {
  if (error instanceof ApiError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: error.code,
        message: error.message,
        fields: error.fields
      }
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      body: {
        error: "VALIDATION_ERROR",
        message: "Request validation failed.",
        fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
      }
    };
  }

  if (error instanceof UniqueConstraintError) {
    return {
      statusCode: 409,
      body: { error: "CONFLICT", message: "Resource already exists." }
    };
  }

  if (error instanceof ForeignKeyConstraintError) {
    return {
      statusCode: 409,
      body: { error: "CONFLICT", message: "Related resource is missing or cannot be changed." }
    };
  }

  if (error instanceof SequelizeValidationError) {
    return {
      statusCode: 400,
      body: {
        error: "VALIDATION_ERROR",
        message: "Database validation failed.",
        fields: error.errors.map((issue) => ({ path: issue.path ?? "unknown", message: issue.message }))
      }
    };
  }

  if (/credential|encrypted secret|CREDENTIAL_ENCRYPTION_KEY/i.test(error.message)) {
    return {
      statusCode: 502,
      body: { error: "CREDENTIAL_STORAGE_ERROR", message: "Credential storage operation failed." }
    };
  }

  if (/cloudinary/i.test(error.message)) {
    return {
      statusCode: 502,
      body: { error: "CLOUDINARY_ERROR", message: "Cloudinary operation failed." }
    };
  }

  if (/portal job payload|queue|bullmq|redis/i.test(error.message)) {
    return {
      statusCode: 502,
      body: { error: "QUEUE_ERROR", message: "Queue operation failed." }
    };
  }

  const fastifyStatus = "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : undefined;
  if (fastifyStatus === 429) {
    return { statusCode: 429, body: { error: "RATE_LIMITED", message: "Too many requests." } };
  }

  return {
    statusCode: fastifyStatus && fastifyStatus >= 400 && fastifyStatus < 500 ? fastifyStatus : 500,
    body: {
      error: fastifyStatus === 401 ? "UNAUTHORIZED" : fastifyStatus === 403 ? "FORBIDDEN" : "INTERNAL_ERROR",
      message: fastifyStatus && fastifyStatus < 500 ? redactSensitiveText(error.message) : "Unexpected server error."
    }
  };
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const mapped = mapError(error);
    request.log.error({
      error: {
        name: error.name,
        message: redactSensitiveText(error.message),
        statusCode: mapped.statusCode
      },
      requestId: request.id
    }, "API error");
    reply.code(mapped.statusCode).send({ ...mapped.body, requestId: request.id });
  });
}
