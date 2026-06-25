import { users } from "../data/demo-data.js";
import { User } from "../db/models.js";
import { canFallbackFromDatabaseError, shouldUseDatabase } from "../db/runtime.js";
import { rolePermissions, type Permission, type Role } from "../permissions/permissions.js";
import { hashPassword } from "../utils/password.js";

export type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: string;
  permissions: Permission[];
  lastLoginAt: string | null;
  lastLogin: string;
};

export class DuplicateUserEmailError extends Error {
  constructor() {
    super("A user with this email already exists.");
    this.name = "DuplicateUserEmailError";
  }
}

function temporaryPassword() {
  return `Tmp-${Math.random().toString(36).slice(2, 8)}!26`;
}

function parsePermissions(value: unknown, role: Role): Permission[] {
  if (Array.isArray(value)) {
    return value as Permission[];
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed as Permission[];
      }
    } catch {
      return rolePermissions[role] ?? [];
    }
  }
  return rolePermissions[role] ?? [];
}

function formatLastLogin(value: unknown) {
  if (!value) {
    return "Never";
  }
  return new Date(value as string | Date).toLocaleString();
}

function toManagedUser(row: Record<string, unknown>): ManagedUser {
  const role = String(row.role) as Role;
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role,
    status: String(row.status),
    permissions: parsePermissions(row.permissions, role),
    lastLoginAt: row.lastLoginAt ? new Date(row.lastLoginAt as string | Date).toISOString() : null,
    lastLogin: formatLastLogin(row.lastLoginAt)
  };
}

function demoUsers() {
  return users.map(({ temporaryPassword: _hidden, ...user }) => ({
    ...user,
    lastLogin: user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"
  }));
}

export { temporaryPassword };

export async function listManagedUsers(filters: { role?: Role } = {}) {
  if (shouldUseDatabase()) {
    try {
      const rows = await User.findAll({
        where: {
          ...(filters.role ? { role: filters.role } : {})
        },
        order: [["createdAt", "ASC"]],
        raw: true
      });
      return rows.map((row) => toManagedUser(row as unknown as Record<string, unknown>));
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  return demoUsers().filter((user) => !filters.role || user.role === filters.role);
}

export async function createManagedUser(input: { name: string; email: string; role: Role }) {
  const temp = temporaryPassword();
  const permissions = rolePermissions[input.role];

  if (shouldUseDatabase()) {
    try {
      const existing = await User.findOne({ where: { email: input.email.toLowerCase() }, raw: true });
      if (existing) {
        throw new DuplicateUserEmailError();
      }
      const user = {
        id: `usr_${Math.floor(Math.random() * 9000 + 1000)}`,
        name: input.name,
        email: input.email.toLowerCase(),
        passwordHash: await hashPassword(temp),
        role: input.role,
        status: "password_reset_required",
        permissions,
        mustChangePassword: true
      };
      const row = await User.create(user);
      return { user: toManagedUser(row.get({ plain: true }) as unknown as Record<string, unknown>), temporaryPassword: temp };
    } catch (error) {
      if (error instanceof DuplicateUserEmailError) throw error;
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  if (users.some((user) => user.email.toLowerCase() === input.email.toLowerCase())) {
    throw new DuplicateUserEmailError();
  }

  const user = {
    id: `usr_${Math.floor(Math.random() * 9000 + 1000)}`,
    name: input.name,
    email: input.email.toLowerCase(),
    role: input.role,
    status: "password_reset_required" as const,
    permissions,
    lastLoginAt: null,
    temporaryPassword: true
  };
  users.push(user);
  return { user: { ...user, lastLogin: "Never" }, temporaryPassword: temp };
}

export async function updateManagedUser(id: string, input: { role?: Role; status?: string; permissions?: string[] }) {
  if (shouldUseDatabase()) {
    try {
      const row = await User.findByPk(id);
      if (!row) {
        return null;
      }
      const role = input.role ?? String(row.get("role")) as Role;
      await row.update({
        ...(input.role ? { role: input.role, permissions: rolePermissions[input.role] } : {}),
        ...(input.permissions ? { permissions: input.permissions } : {}),
        ...(input.status ? { status: input.status, mustChangePassword: input.status === "password_reset_required" } : {})
      });
      return toManagedUser(row.get({ plain: true }) as unknown as Record<string, unknown>);
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  const user = users.find((item) => item.id === id);
  if (!user) {
    return null;
  }
  if (input.role) {
    user.role = input.role;
    user.permissions = rolePermissions[input.role];
  }
  if (input.permissions) {
    user.permissions = input.permissions as Permission[];
  }
  if (input.status) {
    user.status = input.status as typeof user.status;
  }
  return { ...user, lastLogin: user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never" };
}

export async function resetManagedUserTemporaryPassword(id: string) {
  const temp = temporaryPassword();

  if (shouldUseDatabase()) {
    try {
      const row = await User.findByPk(id);
      if (!row) {
        return null;
      }
      await row.update({
        passwordHash: await hashPassword(temp),
        status: "password_reset_required",
        mustChangePassword: true
      });
      return { userId: id, temporaryPassword: temp };
    } catch (error) {
      if (!canFallbackFromDatabaseError()) throw error;
    }
  }

  const user = users.find((item) => item.id === id);
  if (!user) {
    return null;
  }
  user.status = "password_reset_required";
  user.temporaryPassword = true;
  return { userId: id, temporaryPassword: temp };
}
