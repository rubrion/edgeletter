import { EMAIL, deepen, microStyle } from './email-style';

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

  const deep = deepen(themeColor);
  const logoUrl = clientDomain ? `https://${clientDomain}/logo.png` : '';
  const E = EMAIL;

  const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(postTitle)}</title>
${E.fontsLink}
<style>
  .el-content h1, .el-content h2, .el-content h3, .el-content h4 { font-family:${E.display}; font-weight:500; letter-spacing:0.005em; word-spacing:0.05em; line-height:1.15; color:${E.ink}; margin:28px 0 10px; }
  .el-content h2 { font-size:28px; } .el-content h3 { font-size:22px; }
  .el-content p { margin:0 0 18px; }
  .el-content a { color:${themeColor}; }
  .el-content img { max-width:100%; height:auto; border:0; }
  .el-content blockquote { margin:24px 0; padding:0 0 0 18px; border-left:1px solid ${themeColor}; font-family:${E.display}; font-style:italic; font-size:22px; line-height:1.3; color:${E.ink}; }
  .el-content pre { padding:14px 16px; border:1px solid ${E.hairline}; background:${E.paper}; overflow-x:auto; font-size:13px; }
  @media (max-width:600px) { .el-pad { padding-left:24px !important; padding-right:24px !important; } .el-title { font-size:34px !important; } }
</style>
</head>
<body style="margin:0;padding:0;background:${E.paper};font-family:${E.body};color:${E.text};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${E.paper};">
  <tr><td align="center" style="padding:40px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;">
      <tr><td align="center" style="background:${themeColor};padding:26px 24px 22px;">
        ${logoUrl ? `<img src="${logoUrl}" width="36" height="36" alt="" style="display:block;margin:0 auto 10px;border:0;">` : ''}<p style="margin:0;${microStyle(deep)}font-size:12px;font-weight:600;text-shadow:0 1px 0 rgba(255,255,255,0.14);">[&nbsp;${escapeHtml(clientName)}&nbsp;]</p>
      </td></tr>
      <tr><td class="el-pad" style="background:${E.card};border:1px solid ${E.hairline};border-top:0;padding:44px 48px 40px;">
        <h1 class="el-title" style="margin:0 0 14px;font-family:${E.display};font-weight:500;font-size:44px;line-height:1.12;letter-spacing:0.005em;word-spacing:0.05em;color:${E.ink};text-align:center;">${escapeHtml(postTitle)}</h1>
        <p style="margin:0 0 32px;text-align:center;color:${themeColor};font-size:12px;">&mdash;&nbsp;&#10022;&nbsp;&mdash;</p>
        <div class="el-content" style="font-size:17px;line-height:1.7;color:${E.text};">${postHtml}</div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:36px auto 0;">
          <tr><td style="background:${E.ink};">
            <a href="${postUrl}" style="display:inline-block;padding:14px 26px;${microStyle(E.card)}font-weight:600;text-decoration:none;">${w.read}</a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td align="center" style="padding:26px 16px 0;">
        <p style="margin:0;${microStyle(E.muted)}font-size:10px;line-height:1.8;">
          ${w.why} ${escapeHtml(clientDomain)}
          &nbsp;&middot;&nbsp;
          <a href="${unsubscribeUrl}" style="color:${E.muted};text-decoration:underline;">${w.unsubscribe}</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
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
