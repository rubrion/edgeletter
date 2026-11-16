import { EMAIL, deepen, microStyle } from './email-style';
import { sendBatchGmail } from './smtp';
import type { Settings } from './settings';

type SendConfirmArgs = {
  env: unknown;
  settings: Settings;
  to: string;
  confirmUrl: string;
  lang?: 'en' | 'pt';
};

const WORDS = {
  en: {
    title: 'Confirm your subscription',
    body: (n: string) => `Click the button below to confirm you want to receive emails from <strong>${n}</strong>. The link expires in 24 hours.`,
    button: 'Confirm subscription',
    paste: 'Or paste this URL:',
    ignore: 'If you did not request this, ignore this email and you will not be subscribed.',
    subject: (n: string) => `Confirm your subscription to ${n}`,
    open: 'Open this link to confirm (expires in 24 hours):',
  },
  pt: {
    title: 'Confirme sua inscrição',
    body: (n: string) => `Clique no botão abaixo para confirmar que quer receber e-mails da <strong>${n}</strong>. O link expira em 24 horas.`,
    button: 'Confirmar inscrição',
    paste: 'Ou cole este endereço:',
    ignore: 'Se você não pediu isto, ignore este e-mail e você não será inscrito.',
    subject: (n: string) => `Confirme sua inscrição na ${n}`,
    open: 'Abra este link para confirmar (expira em 24 horas):',
  },
};

const buildBody = ({
  clientName,
  confirmUrl,
  themeColor,
  clientDomain = '',
  lang = 'en',
}: {
  clientName: string;
  confirmUrl: string;
  themeColor: string;
  clientDomain?: string;
  lang?: 'en' | 'pt';
}) => {
  const w = WORDS[lang];
  const deep = deepen(themeColor);
  const logoUrl = clientDomain ? `https://${clientDomain}/logo.png` : '';
  const E = EMAIL;
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${E.fontsLink}</head>
<body style="margin:0;padding:0;background:${E.paper};font-family:${E.body};color:${E.text};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${E.paper};">
  <tr><td align="center" style="padding:40px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
      <tr><td align="center" style="background:${themeColor};padding:24px 24px 20px;">
        ${logoUrl ? `<img src="${logoUrl}" width="36" height="36" alt="" style="display:block;margin:0 auto 10px;border:0;">` : ''}<p style="margin:0;${microStyle(deep)}font-size:12px;font-weight:600;text-shadow:0 1px 0 rgba(255,255,255,0.14);">[&nbsp;${escapeHtml(clientName)}&nbsp;]</p>
      </td></tr>
      <tr><td align="center" style="background:${E.card};border:1px solid ${E.hairline};border-top:0;padding:40px 40px 34px;">
        <h1 style="margin:0 0 16px;font-family:${E.display};font-weight:500;font-size:38px;line-height:1.12;letter-spacing:0.005em;word-spacing:0.05em;color:${E.ink};">${w.title}</h1>
        <p style="margin:0 0 28px;font-size:16px;line-height:1.65;color:${E.text};">${w.body(escapeHtml(clientName))}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 26px;">
          <tr><td style="background:${themeColor};">
            <a href="${confirmUrl}" style="display:inline-block;padding:15px 28px;${microStyle(E.card)}font-weight:600;text-decoration:none;">${w.button}</a>
          </td></tr>
        </table>
        <p style="margin:0;font-size:13px;font-style:italic;color:${E.muted};">${w.paste}<br /><span style="word-break:break-all;font-style:normal;color:${themeColor};">${confirmUrl}</span></p>
        <p style="margin:26px 0 0;padding-top:20px;border-top:1px solid ${E.hairline};${microStyle(E.muted)}font-size:10px;line-height:1.8;">${w.ignore}</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
  const text = [
    w.subject(clientName),
    '',
    w.open,
    confirmUrl,
    '',
    w.ignore,
  ].join('\n');
  return { html, text };
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const sendConfirmationEmail = async ({
  env,
  settings,
  to,
  confirmUrl,
  lang = 'en',
}: SendConfirmArgs): Promise<void> => {
  const e = env as {
    EMAIL_PROVIDER?: string;
    CLIENT_DOMAIN?: string;
    EMAIL_FROM_DOMAIN?: string;
    RESEND_API_KEY?: string;
    GMAIL_USER?: string;
    GMAIL_APP_PASSWORD?: string;
  };
  const provider = e.EMAIL_PROVIDER === 'GMAIL' ? 'GMAIL' : 'RESEND';
  const subject = WORDS[lang].subject(settings.clientName);
  const { html, text } = buildBody({
    clientName: settings.clientName,
    confirmUrl,
    themeColor: settings.themePrimaryColor,
    clientDomain: e.CLIENT_DOMAIN ?? '',
    lang,
  });

  if (provider === 'RESEND') {
    if (!e.RESEND_API_KEY) throw new Error('RESEND_API_KEY not set');
    const fromDomain = e.EMAIL_FROM_DOMAIN || e.CLIENT_DOMAIN || '';
    const local = settings.emailFromLocal.trim() || 'noreply';
    const fromAddress = `${local}@${fromDomain}`;
    const from = `${settings.clientName} <${fromAddress}>`;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${e.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html, text }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`resend ${res.status}: ${body}`);
    }
    return;
  }

  if (!e.GMAIL_USER || !e.GMAIL_APP_PASSWORD) {
    throw new Error('GMAIL_USER or GMAIL_APP_PASSWORD not set');
  }
  await sendBatchGmail({
    user: e.GMAIL_USER,
    pass: e.GMAIL_APP_PASSWORD,
    fromAddress: e.GMAIL_USER,
    fromName: settings.clientName,
    recipients: [to],
    subject,
    html,
  });
};
