import { env } from 'cloudflare:workers';
import { senderName as safeSenderName, sendResend, type Mail } from '@rubrion/core/mail';

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

/**
 * Display name for mail from the shared platform domain. Writers choose
 * their publication name, so strip characters that can fake an address or
 * header structure and cap the length; the address itself is always ours.
 */
export const senderName = (name: string): string => safeSenderName(name, 'EdgeLetter');

export const platformFrom = (name: string, local = 'posts'): string => `${senderName(name)} <${local}@${mailFromDomain()}>`;

export type { Mail };

export const sendMail = async (mail: Mail): Promise<void> => {
  if (import.meta.env.DEV) {
    console.log(`\n[mail:dev] to=${mail.to} subject="${mail.subject}"\n${mail.text}\n`);
    return;
  }
  await sendResend((env as unknown as Env).RESEND_API_KEY, mail);
};
