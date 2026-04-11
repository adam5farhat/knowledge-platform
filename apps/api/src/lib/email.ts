import nodemailer from "nodemailer";
import { config } from "./config.js";
import { logger } from "./logger.js";

const RESET_SUBJECT = "Reset your Knowledge Platform password";

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const { host, port, secure, user, pass, from } = config.smtp;
  if (!host) {
    if (!config.isProd) {
      const maskedUrl = resetUrl.replace(/token=[^&]+/, "token=***REDACTED***");
      logger.debug("SMTP not configured — password reset requested", { to, resetUrl: maskedUrl });
    } else {
      logger.warn("SMTP_HOST not set — password reset email was not sent");
    }
    return;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
    ...(!secure ? { requireTLS: true } : {}),
  });

  await transporter.sendMail({
    from,
    to,
    subject: RESET_SUBJECT,
    text: `You requested a password reset. Open this link (valid for 1 hour):\n\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
    html: `<p>You requested a password reset.</p><p><a href="${resetUrl}">Reset your password</a> (valid for 1 hour)</p><p>If you did not request this, ignore this email.</p>`,
  });
}
