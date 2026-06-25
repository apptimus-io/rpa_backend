export const permissions = {
  dashboardView: "dashboard:view",
  submissionsView: "submissions:view",
  submissionsCreate: "submissions:create",
  submissionsEdit: "submissions:edit",
  submissionsCancel: "submissions:cancel",
  escalationsView: "escalations:view",
  escalationsApprove: "escalations:approve",
  portalsView: "portals:view",
  portalsManage: "portals:manage",
  usersManage: "users:manage",
  auditView: "audit:view",
  auditExport: "audit:export",
  reportsView: "reports:view",
  notificationsView: "notifications:view",
  settingsManage: "settings:manage"
} as const;

export type Permission = (typeof permissions)[keyof typeof permissions];
export type Role = "super_admin" | "admin" | "manager" | "staff" | "custom";

export const rolePermissions: Record<Role, Permission[]> = {
  super_admin: Object.values(permissions),
  admin: [
    permissions.dashboardView,
    permissions.submissionsView,
    permissions.submissionsCreate,
    permissions.submissionsEdit,
    permissions.escalationsView,
    permissions.escalationsApprove,
    permissions.portalsView,
    permissions.portalsManage,
    permissions.usersManage,
    permissions.auditView,
    permissions.auditExport,
    permissions.notificationsView,
    permissions.settingsManage
  ],
  manager: [
    permissions.dashboardView,
    permissions.submissionsView,
    permissions.submissionsCreate,
    permissions.escalationsView,
    permissions.escalationsApprove,
    permissions.portalsView,
    permissions.auditView,
    permissions.notificationsView,
    permissions.reportsView
  ],
  staff: [
    permissions.dashboardView,
    permissions.submissionsView,
    permissions.submissionsCreate,
    permissions.escalationsView,
    permissions.notificationsView
  ],
  custom: [permissions.dashboardView]
};

export function can(userPermissions: string[], permission: Permission) {
  return userPermissions.includes(permission);
}
