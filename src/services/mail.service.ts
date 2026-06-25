import { env } from "../config/env.js";
import { notify } from "./notification.service.js";

type MailPayload = {
  toUserId: string;
  toEmail: string;
  subject: string;
  body: string;
};

export function isMailConfigured() {
  return Boolean((env.MAIL_HOST || env.SMTP_HOST) && (env.MAIL_FROM_ADDRESS || env.NOTIFICATION_FROM_EMAIL));
}

export async function sendMail(payload: MailPayload) {
  const notification = notify({
    userId: payload.toUserId,
    channel: "email",
    title: payload.subject,
    body: payload.body
  });

  return {
    configured: isMailConfigured(),
    mailer: env.MAIL_MAILER,
    host: env.MAIL_HOST ?? env.SMTP_HOST,
    from: env.MAIL_FROM_ADDRESS ?? env.NOTIFICATION_FROM_EMAIL,
    to: payload.toEmail,
    notification
  };
}
