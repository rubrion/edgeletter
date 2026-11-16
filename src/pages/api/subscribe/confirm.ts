import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDbInstance, subscribers } from '../../../db';
import { loadSettings } from '../../../lib/settings';

const tokenLooksValid = (t: string | null): t is string =>
  !!t && /^[a-f0-9]{32,128}$/i.test(t);

const htmlPage = (title: string, message: string, accent = '#B44A27'): Response =>
  new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Newsreader:ital,wght@0,400;0,600;1,400&family=Pinyon+Script&display=swap" rel="stylesheet">
<style>
:root{--accent:${accent};--deep:color-mix(in srgb,var(--accent) 45%,#000);}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:2rem 1rem;box-sizing:border-box;background:#E7E4DE;color:#3A3129;font-family:'Newsreader',Georgia,serif;-webkit-font-smoothing:antialiased;}
body::before{content:'';position:fixed;inset:0;pointer-events:none;opacity:.04;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");}
.pocket{position:relative;width:min(440px,100%);padding:4.25rem 1.25rem 1.25rem;background:var(--accent);clip-path:polygon(0 28px,50% 0,100% 28px,100% 100%,0 100%);box-shadow:inset 0 2px 6px rgba(0,0,0,.18);box-sizing:border-box;}
.mark{position:absolute;top:2rem;left:0;right:0;text-align:center;font-family:'Pinyon Script',cursive;font-size:1.9rem;line-height:1;color:var(--deep);text-shadow:0 1px 0 rgba(255,255,255,.14),0 -1px 0 rgba(0,0,0,.2);}
.card{position:relative;background:#F5F3EE;border:1px solid rgba(42,35,29,.12);box-shadow:0 4px 12px rgba(35,25,15,.08);padding:2.25rem 2rem 2rem;text-align:center;}
h1{margin:0 0 .75rem;font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:2.4rem;line-height:1.05;letter-spacing:-.02em;color:#2A231D;}
p{margin:0;font-style:italic;color:#7A6E62;font-size:1rem;line-height:1.6;}
.orn{margin:0 0 1rem;color:var(--accent);font-style:normal;font-size:.8rem;}
</style></head><body><div class="pocket"><span class="mark" aria-hidden="true">With regards</span><div class="card"><h1>${title}</h1><p class="orn">&mdash;&nbsp;&#10022;&nbsp;&mdash;</p><p>${message}</p></div></div></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );

export const GET: APIRoute = async ({ url }) => {
  const { themePrimaryColor: accent } = await loadSettings();
  const token = url.searchParams.get('token');
  if (!tokenLooksValid(token)) {
    return htmlPage('Invalid link', 'This confirmation link is malformed.', accent);
  }

  const db = getDbInstance();
  const [row] = await db
    .select()
    .from(subscribers)
    .where(eq(subscribers.confirmToken, token))
    .limit(1);

  if (!row) {
    return htmlPage('Link not found', 'This confirmation link is invalid or has already been used.', accent);
  }
  if (row.status === 'unsubscribed') {
    return htmlPage('Unsubscribed', 'This email has previously unsubscribed. Subscribe again to receive emails.', accent);
  }
  if (row.confirmTokenExpiresAt && row.confirmTokenExpiresAt.getTime() < Date.now()) {
    return htmlPage('Link expired', 'This confirmation link has expired. Please subscribe again to get a fresh link.', accent);
  }

  await db
    .update(subscribers)
    .set({
      status: 'active',
      confirmedAt: new Date(),
      confirmToken: null,
      confirmTokenExpiresAt: null,
    })
    .where(eq(subscribers.id, row.id));

  return htmlPage('Subscription confirmed', 'You will now receive new posts in your inbox.', accent);
};
