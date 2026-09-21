import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '@/env';

/**
 * Outbound staff email (invitations, password resets).
 *
 * Local development points at Mailpit on :1025, so an invitation flow can be
 * exercised end to end without sending anything to a real mailbox. If SMTP is
 * not configured the mail is written to the log instead of silently
 * "succeeding" — an unsent invitation must be visible.
 */

let transporter: Transporter | null = null;

function getTransport(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
  }
  return transporter;
}

export type StaffMail = {
  to: string;
  subject: string;
  text: string;
};

export type MailResult =
  | { status: 'sent'; messageId: string }
  | { status: 'unavailable'; reason: string };

export async function sendStaffMail(mail: StaffMail): Promise<MailResult> {
  const transport = getTransport();
  if (!transport) {
    console.warn(
      `[mail] SMTP is not configured; "${mail.subject}" for ${mail.to} was NOT sent. ` +
        'Set SMTP_HOST (Mailpit locally) to exercise the invitation and reset flows.',
    );
    return { status: 'unavailable', reason: 'SMTP_HOST is not configured' };
  }
  const info = await transport.sendMail({
    from: env.MAIL_FROM,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
  });
  return { status: 'sent', messageId: info.messageId };
}
