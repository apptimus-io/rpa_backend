import type { ZodIssue } from "zod";

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly fields?: Array<{ path: string; message: string }>;

  constructor(statusCode: number, code: string, message: string, fields?: Array<{ path: string; message: string }>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.fields = fields;
  }
}

export function validationError(issues: ZodIssue[]) {
  return new ApiError(
    400,
    "VALIDATION_ERROR",
    "Request validation failed.",
    issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message
    }))
  );
}

export function conflictError(message = "Resource already exists.") {
  return new ApiError(409, "CONFLICT", message);
}

export function notFoundError(message = "Resource not found.") {
  return new ApiError(404, "RESOURCE_NOT_FOUND", message);
}

export function redactSensitiveText(value: unknown) {
  return String(value)
    .replace(/(password|token|secret|credential|authorization|api[_-]?key)=?[^,\s}]*/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]");
}
