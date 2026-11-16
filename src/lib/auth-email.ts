import { EMAIL, microStyle } from './email-style';
import { platformFrom, sendMail } from './mailer';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const layout = (title: string, intro: string, cta: string, url: string, outro: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${EMAIL.fontsLink}</head>
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
        <p style="margin:0;font-size:13px;font-style:italic;color:${EMAIL.muted};">${outro}</p>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;

export const sendLoginLink = async (to: string, url: string): Promise<void> => {
  await sendMail({
    from: platformFrom('EdgeLetter', 'signin'),
    to,
    subject: 'Your EdgeLetter sign-in link',
    html: layout('Sign in to EdgeLetter', 'Use the button below to sign in. The link works once and expires in 15 minutes.', 'Sign in', url, 'If you didn’t ask for this, you can ignore this email.'),
    text: `Sign in to EdgeLetter (link expires in 15 minutes):\n${url}\n\nIf you didn't ask for this, ignore this email.`,
  });
};

export const sendInvite = async (to: string, url: string, publicationName: string, inviter: string): Promise<void> => {
  const pub = escapeHtml(publicationName);
  await sendMail({
    from: platformFrom('EdgeLetter', 'invites'),
    to,
    subject: `You're invited to edit ${publicationName}`,
    html: layout(`Join ${pub}`, `${escapeHtml(inviter)} invited you to edit <strong>${pub}</strong> on EdgeLetter.`, 'Accept invitation', url, 'The invitation expires in 7 days.'),
    text: `${inviter} invited you to edit ${publicationName} on EdgeLetter.\nAccept: ${url}\n(expires in 7 days)`,
  });
};
