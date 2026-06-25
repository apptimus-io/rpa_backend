import bcrypt from "bcryptjs";

export const BCRYPT_COST = 12;

export function hashPassword(plainPassword: string) {
  return bcrypt.hash(plainPassword, BCRYPT_COST);
}

export function verifyPassword(plainPassword: string, passwordHash: string) {
  return bcrypt.compare(plainPassword, passwordHash);
}
