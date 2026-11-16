import { env } from 'cloudflare:workers';

/**
 * Single transactional email through Resend from the platform sender
 * (`<local>@MAIL_FROM_DOMAIN`). Campaign fan-out uses the batch endpoint in
 * dispatch.ts; everything else (magic links, invites, confirmations) goes here.
 *
 * In local dev the message is logged instead of sent, so sign-in links can be
 * followed from the terminal.
 */

type Env = { RESEND_API_KEY?: string; MAIL_FROM_DOMAIN?: string };

export const mailFromDomain = (): string =>
  ((env as unknown as Env).MAIL_FROM_DOMAIN ?? '').trim() || 'mail.edgeletter.blog';

export const platformFrom = (name: string, local = 'posts'): string =>
  `${name.replace(/[<>"]/g, '')} <${local}@${mailFromDomain()}>`;

export type Mail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  from: string;
  replyTo?: string;
  headers?: Record<string, string>;
};

export const sendMail = async (mail: Mail): Promise<void> => {
  if (import.meta.env.DEV) {
    console.log(`\n[mail:dev] to=${mail.to} subject="${mail.subject}"\n${mail.text}\n`);
    return;
  }
  const key = (env as unknown as Env).RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
      ...(mail.headers ? { headers: mail.headers } : {}),
    }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
};
