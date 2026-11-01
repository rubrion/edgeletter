type WrapArgs = {
  clientName: string;
  clientDomain: string;
  themeColor: string;
  postTitle: string;
  postUrl: string;
  postHtml: string;
  unsubscribeUrl: string;
  lang?: 'en' | 'pt';
};

const WORDS = {
  en: { read: 'Read on the web →', why: 'You received this because you subscribed at', unsubscribe: 'Unsubscribe' },
  pt: { read: 'Ler na web →', why: 'Você recebeu este e-mail porque assinou em', unsubscribe: 'Cancelar inscrição' },
};

export type WrappedEmail = { html: string; text: string };

export const wrapPostInEmail = ({
  clientName,
  clientDomain,
  themeColor,
  postTitle,
  postUrl,
  postHtml,
  unsubscribeUrl,
  lang = 'en',
}: WrapArgs): WrappedEmail => {
  const w = WORDS[lang];

  const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><title>${escapeHtml(postTitle)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,Segoe UI,sans-serif;color:#1a1a1a;">
  <div style="max-width:640px;margin:0 auto;padding:32px 16px;">
    <div style="background:#fff;border-radius:12px;padding:32px;border-top:4px solid ${themeColor};">
      <p style="margin:0 0 8px;font-size:13px;color:#666;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(clientName)}</p>
      <h1 style="margin:0 0 24px;font-size:28px;line-height:1.2;">${escapeHtml(postTitle)}</h1>
      <div style="font-size:16px;line-height:1.6;">${postHtml}</div>
      <p style="margin:32px 0 0;padding-top:24px;border-top:1px solid #eee;font-size:14px;color:#666;">
        <a href="${postUrl}" style="color:${themeColor};">${w.read}</a>
      </p>
    </div>
    <p style="text-align:center;margin:24px 0 0;font-size:12px;color:#999;">
      ${w.why} ${escapeHtml(clientDomain)}.
      &nbsp;·&nbsp;
      <a href="${unsubscribeUrl}" style="color:#999;">${w.unsubscribe}</a>
    </p>
  </div>
</body></html>`;

  const text = [
    clientName.toUpperCase(),
    '',
    postTitle,
    '─'.repeat(40),
    stripHtml(postHtml),
    '',
    `${w.read.replace(' →', '')}: ${postUrl}`,
    '',
    '─'.repeat(40),
    `${w.why} ${clientDomain}.`,
    `${w.unsubscribe}: ${unsubscribeUrl}`,
  ].join('\n');

  return { html, text };
};

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const stripHtml = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
