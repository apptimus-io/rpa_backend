import { env } from "../config/env.js";
import { redactSensitiveText } from "./http-errors.js";

export const logRedactionPaths = [
  "req.headers.authorization",
  "req.headers.x-refresh-token",
  "req.headers.cookie",
  "res.headers.set-cookie",
  "password",
  "*.password",
  "passwordHash",
  "*.passwordHash",
  "mfaSecret",
  "*.mfaSecret",
  "mfaSecretCiphertext",
  "*.mfaSecretCiphertext",
  "token",
  "*.token",
  "accessToken",
  "refreshToken",
  "*.accessToken",
  "*.refreshToken",
  "authorization",
  "*.authorization",
  "apiKey",
  "*.apiKey",
  "apiSecret",
  "*.apiSecret",
  "cloudinaryApiSecret",
  "*.cloudinaryApiSecret",
  "ciphertext",
  "*.ciphertext",
  "usernameCiphertext",
  "passwordCiphertext",
  "totpSeedCiphertext",
  "*.usernameCiphertext",
  "*.passwordCiphertext",
  "*.totpSeedCiphertext",
  "customer",
  "*.customer",
  "riskDetails",
  "*.riskDetails",
  "risk_details",
  "*.risk_details"
];

export function backendLogLevel() {
  return env.NODE_ENV === "development" ? "info" : "warn";
}

export function safeLogError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactSensitiveText(error.message)
    };
  }

  return { message: redactSensitiveText(error) };
}
