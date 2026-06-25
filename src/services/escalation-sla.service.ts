import { listEscalations } from "./escalations.service.js";
import { listNotifications, notify } from "./notification.service.js";

export type EscalationSlaAlert = {
  escalationId: string;
  ageMinutes: number;
  notified: boolean;
};

const defaultSlaMinutes = 30;
const defaultAdminUserId = "usr_seed_admin";

function notificationBody(escalationId: string, ageMinutes: number) {
  return `${escalationId} has been pending for ${ageMinutes} minutes.`;
}

function alreadyNotified(escalationId: string) {
  return listNotifications(defaultAdminUserId).some((item) =>
    item.title === "Escalation SLA warning" && item.body.includes(escalationId)
  );
}

export async function findEscalationSlaBreaches(slaMinutes = defaultSlaMinutes): Promise<EscalationSlaAlert[]> {
  const escalations = await listEscalations();
  return escalations
    .filter((item) => item.status === "pending" && item.ageMinutes >= slaMinutes)
    .map((item) => ({
      escalationId: item.id,
      ageMinutes: item.ageMinutes,
      notified: alreadyNotified(item.id)
    }));
}

export async function notifyEscalationSlaBreaches(slaMinutes = defaultSlaMinutes) {
  const breaches = await findEscalationSlaBreaches(slaMinutes);
  const notifications = breaches
    .filter((breach) => !breach.notified)
    .map((breach) => notify({
      userId: defaultAdminUserId,
      channel: "system",
      title: "Escalation SLA warning",
      body: notificationBody(breach.escalationId, breach.ageMinutes)
    }));

  return {
    checked: breaches.length,
    notified: notifications.length,
    breaches,
    notifications
  };
}
