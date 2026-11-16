import type { Post } from '../db';
import { sendBatchGmail } from './smtp';
import { wrapPostInEmail } from './email-template';
import { sanitizeHtml } from './sanitize';
import type { Settings } from './settings';

export type Provider = 'RESEND' | 'GMAIL';

export type Recipient = { id: string; email: string };

/** Per-recipient outcome of one batch: retry `transient`, give up on `permanent`. */
export type BatchOutcome = { sent: string[]; transient: string[]; permanent: string[] };

type SendArgs = {
  env: Env;
  settings: Settings;
  /** Public hostname of the publication (links, unsubscribe). */
  host: string;
  post: Pick<Post, 'title' | 'slug' | 'contentHtml' | 'lang' | 'canonicalUrl'>;
  recipients: Recipient[];
};

/** Resend's batch endpoint takes at most 100 emails per call. */
export const MAX_BATCH = 100;

export const providerFor = (env: Env): Provider =>
  (env.EMAIL_PROVIDER as string) === 'GMAIL' ? 'GMAIL' : 'RESEND';

const render = ({ settings, host, post }: Omit<SendArgs, 'env' | 'recipients'>, r: Recipient) => {
  const unsubscribeUrl = `https://${host}/api/unsubscribe?id=${r.id}`;
  const { html, text } = wrapPostInEmail({
    clientName: settings.clientName,
    clientDomain: host,
    themeColor: settings.themePrimaryColor,
    postTitle: post.title,
    postUrl: post.canonicalUrl ?? `https://${host}/blog/${post.slug}`,
    postHtml: sanitizeHtml(post.contentHtml),
    lang: post.lang,
    unsubscribeUrl,
  });
  return { html, text, unsubscribeUrl };
};

/** Send one batch (≤ MAX_BATCH) and classify every recipient. Never throws. */
export const sendBatch = async (args: SendArgs): Promise<BatchOutcome> => {
  if (args.recipients.length === 0) return { sent: [], transient: [], permanent: [] };
  return providerFor(args.env) === 'RESEND' ? sendViaResend(args) : sendViaGmail(args);
};

const sendViaResend = async (args: SendArgs): Promise<BatchOutcome> => {
  const { env, settings, host, post, recipients } = args;
  const ids = recipients.map((r) => r.id);
  const e = env as unknown as { RESEND_API_KEY?: string; EMAIL_FROM_DOMAIN?: string };
  if (!e.RESEND_API_KEY) return { sent: [], transient: [], permanent: ids };

  const fromDomain = e.EMAIL_FROM_DOMAIN || host;
  const local = settings.emailFromLocal.trim() || 'noreply';
  const from = `${settings.clientName} <${local}@${fromDomain}>`;

  const payload = recipients.map((r) => {
    const { html, text, unsubscribeUrl } = render(args, r);
    return {
      from,
      to: r.email,
      subject: post.title,
      html,
      text,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    };
  });

  try {
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return { sent: ids, transient: [], permanent: [] };
    // Rate limits and provider outages are worth retrying; validation errors are not.
    if (res.status === 429 || res.status >= 500) return { sent: [], transient: ids, permanent: [] };
    console.error('resend batch rejected', res.status, await res.text());
    return { sent: [], transient: [], permanent: ids };
  } catch (err) {
    console.error('resend batch network error', err);
    return { sent: [], transient: ids, permanent: [] };
  }
};

const sendViaGmail = async (args: SendArgs): Promise<BatchOutcome> => {
  const { env, settings, recipients, post } = args;
  const e = env as unknown as { GMAIL_USER?: string; GMAIL_APP_PASSWORD?: string };
  const out: BatchOutcome = { sent: [], transient: [], permanent: [] };
  if (!e.GMAIL_USER || !e.GMAIL_APP_PASSWORD) {
    out.permanent = recipients.map((r) => r.id);
    return out;
  }
  // One message per recipient so each gets its own unsubscribe URL.
  for (const r of recipients) {
    const { html } = render(args, r);
    try {
      const res = await sendBatchGmail({
        user: e.GMAIL_USER,
        pass: e.GMAIL_APP_PASSWORD,
        fromAddress: e.GMAIL_USER,
        fromName: settings.clientName,
        recipients: [r.email],
        subject: post.title,
        html,
      });
      (res.sent > 0 ? out.sent : out.transient).push(r.id);
    } catch {
      out.transient.push(r.id);
    }
  }
  return out;
};
