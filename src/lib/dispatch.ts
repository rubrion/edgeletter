import type { Post } from '../db';
import { wrapPostInEmail } from './email-template';
import { platformFrom } from './mailer';
import { sanitizeHtml } from './sanitize';
import type { Settings } from './settings';

export type Provider = 'RESEND';

export type Recipient = { id: string; email: string };

/**
 * Per-recipient outcome of one batch: retry `transient`, give up on
 * `permanent`. `providerIds` maps subscriber id → provider email id, used to
 * attribute open/click webhooks.
 */
export type BatchOutcome = {
  sent: string[];
  transient: string[];
  permanent: string[];
  providerIds: Record<string, string>;
};

type SendArgs = {
  env: Env;
  settings: Settings;
  /** Public hostname of the publication (links, unsubscribe, report). */
  host: string;
  /** Owner's address: replies go to the writer, not the platform sender. */
  replyTo: string | null;
  showWatermark: boolean;
  post: Pick<Post, 'title' | 'slug' | 'contentHtml' | 'lang' | 'canonicalUrl'>;
  recipients: Recipient[];
};

export const providerFor = (_env: Env): Provider => 'RESEND';

const render = (args: Omit<SendArgs, 'env' | 'recipients'>, r: Recipient) => {
  const { settings, host, post, showWatermark } = args;
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
    reportUrl: `https://${host}/report`,
    showWatermark,
  });
  return { html, text, unsubscribeUrl };
};

/** Send one batch (≤ 100) and classify every recipient. Never throws. */
export const sendBatch = async (args: SendArgs): Promise<BatchOutcome> => {
  const { env, settings, post, recipients, replyTo } = args;
  const ids = recipients.map((r) => r.id);
  const none: BatchOutcome = { sent: [], transient: [], permanent: [], providerIds: {} };
  if (recipients.length === 0) return none;

  const key = (env as unknown as { RESEND_API_KEY?: string }).RESEND_API_KEY;
  if (!key) return { ...none, permanent: ids };

  let payload;
  try {
    const from = platformFrom(settings.clientName);
    payload = recipients.map((r) => {
      const { html, text, unsubscribeUrl } = render(args, r);
      return {
        from,
        to: r.email,
        subject: post.title,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      };
    });
  } catch (err) {
    // Rendering is deterministic: retrying won't help.
    console.error('email render failed', err);
    return { ...none, permanent: ids };
  }

  try {
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { data?: { id?: string }[] };
      const providerIds: Record<string, string> = {};
      body.data?.forEach((d, i) => {
        if (d?.id && ids[i]) providerIds[ids[i]] = d.id;
      });
      return { ...none, sent: ids, providerIds };
    }
    // Rate limits and provider outages are worth retrying; validation errors are not.
    if (res.status === 429 || res.status >= 500) return { ...none, transient: ids };
    console.error('resend batch rejected', res.status, await res.text());
    return { ...none, permanent: ids };
  } catch (err) {
    console.error('resend batch network error', err);
    return { ...none, transient: ids };
  }
};
