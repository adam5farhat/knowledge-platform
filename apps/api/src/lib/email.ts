import nodemailer from "nodemailer";

const RESET_SUBJECT = "Reset your Knowledge Platform password";

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[auth] SMTP not configured — password reset link for ${to}:\n  ${resetUrl}`);
    } else {
      console.warn("[auth] SMTP_HOST not set — password reset email was not sent.");
    }
    return;
  }

  const port = Number(process.env.SMTP_PORT ?? "587");
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER ?? "";
  const pass = process.env.SMTP_PASS ?? "";
  const from = process.env.SMTP_FROM ?? user;

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
