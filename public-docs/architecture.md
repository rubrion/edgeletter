# Architecture

EdgePress runs entirely inside a single Cloudflare Worker. There is no separate container or server to manage.

```
                    ┌─RESEND─▶ api.resend.com (HTTPS)
[Reader]──HTTPS──┐  │
                 ├─▶[Astro/CF Worker]──┬──▶[D1] (per-tenant SQLite: posts, subscribers, campaigns, settings)
[Admin] ──HTTPS──┘  │                  └──▶[R2] (media uploads, optional shared bucket)
                    └─GMAIL──▶ smtp.gmail.com:465 (TCP+TLS via cloudflare:sockets)
```

- All public pages, the admin UI, `/api/*`, and media uploads run inside one Worker.
- D1 holds `posts`, `subscribers`, `campaigns`, `settings` (schema in `src/db/schema.ts`).
- R2 holds uploaded images and videos, organized as `edgepress/<CLIENT_SLUG>/<yyyy-mm>/<uuid>.<ext>`. One bucket can be shared across tenants — slug-prefixed paths keep them isolated.
- Brand visuals (name, tagline, logo, favicon, theme color, email From-address) live in D1 and are editable from `/admin/settings` without redeploy.
- Provider choice is a config flip (`EMAIL_PROVIDER` var); no code changes.

## Built-in features

- **Markdown editor** with live preview, drag-drop / paste / button image + video upload (R2-backed, 50 MB cap), per-post Publish + Send to active subscribers.
- **Newsletter dispatch** with `List-Unsubscribe` + one-click POST headers (Gmail/Yahoo bulk-sender compliant), plain-text alternative, and per-subscriber unsubscribe links.
- **Subscriber unsubscribe** — `/api/unsubscribe?id=<uuid>` (GET for link clicks, POST for one-click). Sets `subscribers.status = 'unsubscribed'` so future dispatches skip them.
- **Post-delete media cleanup** — when a post is deleted from the admin, any R2 objects it referenced under your own bucket prefix are removed. Externally-pasted URLs are left alone.
- **Dark / light mode** toggle. Detects `prefers-color-scheme` on first visit, persists choice in `localStorage`.
- **i18n** — `en` and `pt-BR` translations for all public-facing UI. Detects browser `Accept-Language` on first visit, persists choice in a `lang` cookie.
- **Live brand admin** at `/admin/settings` — change name, tagline, logo, favicon, accent color, email From-address without a deploy.

## Prerequisites

| Tool | Version | Used for |
| ---- | ------- | -------- |
| [Bun](https://bun.sh) | ≥ 1.3 | Package manager + dev server |
| Cloudflare account | — | Workers + D1 + R2 |
| `wrangler` (vendored) | 4.x | Provisioning + deploy (`bunx wrangler ...`) |
| Resend account | — | Only if `EMAIL_PROVIDER=RESEND` |
| Gmail account + App Password | — | Only if `EMAIL_PROVIDER=GMAIL` |
