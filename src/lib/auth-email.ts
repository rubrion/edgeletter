import { EMAIL, microStyle } from './email-style';
import { platformFrom, sendMail } from './mailer';
import type { Lang } from '../i18n';
import { studio } from '../i18n/studio';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const layout = (title: string, intro: string, cta: string, url: string, outro: string, lang: Lang, code?: { label: string; value: string }) => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${EMAIL.fontsLink}</head>
<body style="margin:0;padding:0;background:${EMAIL.paper};font-family:${EMAIL.body};color:${EMAIL.text};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${EMAIL.paper};">
  <tr><td align="center" style="padding:40px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
      <tr><td align="center" style="background:#B44A27;padding:22px 24px 18px;">
        <p style="margin:0;${microStyle('#5A1F0C')}font-size:12px;font-weight:600;">[&nbsp;EdgeLetter&nbsp;]</p>
      </td></tr>
      <tr><td align="center" style="background:${EMAIL.card};border:1px solid ${EMAIL.hairline};border-top:0;padding:38px 36px 32px;">
        <h1 style="margin:0 0 14px;font-family:${EMAIL.display};font-weight:500;font-size:34px;line-height:1.12;color:${EMAIL.ink};">${title}</h1>
        <p style="margin:0 0 26px;font-size:16px;line-height:1.65;">${intro}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 24px;">
          <tr><td style="background:${EMAIL.ink};"><a href="${url}" style="display:inline-block;padding:15px 28px;${microStyle(EMAIL.card)}font-weight:600;text-decoration:none;">${cta}</a></td></tr>
        </table>
${code ? `        <p style="margin:0 0 6px;font-size:14px;color:${EMAIL.muted};">${code.label}</p>
        <p style="margin:0 0 24px;font-family:${EMAIL.display};font-size:34px;letter-spacing:0.18em;color:${EMAIL.ink};">${code.value}</p>
` : ''}        <p style="margin:0;font-size:13px;font-style:italic;color:${EMAIL.muted};">${outro}</p>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;

export const sendLoginLink = async (to: string, url: string, code: string, lang: Lang = 'en'): Promise<void> => {
  const t = studio(lang);
  await sendMail({
    from: platformFrom('EdgeLetter', 'signin'),
    to,
    subject: t('mail.signinSubject'),
    html: layout(t('mail.signinTitle'), t('mail.signinIntro'), t('mail.signinCta'), url, t('mail.signinOutro'), lang, {
      label: t('mail.signinCodeLabel'),
      value: code,
    }),
    text: t('mail.signinText', { url, code }),
  });
};

export const sendInvite = async (to: string, url: string, publicationName: string, inviter: string, lang: Lang = 'en'): Promise<void> => {
  const t = studio(lang);
  const pub = escapeHtml(publicationName);
  await sendMail({
    from: platformFrom('EdgeLetter', 'invites'),
    to,
    subject: t('mail.inviteSubject', { pub: publicationName }),
    html: layout(t('mail.inviteTitle', { pub }), t('mail.inviteIntro', { who: escapeHtml(inviter), pub }), t('mail.inviteCta'), url, t('mail.inviteOutro'), lang),
    text: t('mail.inviteText', { who: inviter, pub: publicationName, url }),
  });
};
