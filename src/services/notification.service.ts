type NotificationPayload = {
  userId: string;
  channel: "email" | "in_app" | "system";
  title: string;
  body: string;
};

const notifications: Array<NotificationPayload & { id: string; read: boolean; createdAt: string }> = [
  {
    id: "ntf_001",
    userId: "usr_seed_admin",
    channel: "in_app",
    title: "Escalation SLA warning",
    body: "ESC-401 has been pending for more than 30 minutes.",
    read: false,
    createdAt: "2026-06-01T08:30:00.000Z"
  },
  {
    id: "ntf_002",
    userId: "usr_seed_admin",
    channel: "system",
    title: "Portal DOM snapshot refreshed",
    body: "AXA Broker Portal snapshot was updated after successful verification.",
    read: false,
    createdAt: "2026-06-01T08:19:00.000Z"
  }
];

export function notify(payload: NotificationPayload) {
  const notification = {
    id: `ntf_${Math.floor(Math.random() * 90_000 + 10_000)}`,
    read: false,
    createdAt: new Date().toISOString(),
    ...payload
  };
  notifications.unshift(notification);
  return notification;
}

export function listNotifications(userId?: string) {
  return userId ? notifications.filter((item) => item.userId === userId) : notifications;
}

export function markNotificationRead(id: string, userId?: string) {
  const notification = notifications.find((item) => item.id === id && (!userId || item.userId === userId));
  if (!notification) {
    return null;
  }
  notification.read = true;
  return notification;
}
