# Configuration Reference

EdgePress splits configuration into three layers, each with a different lifecycle.

## Admin-managed (D1 `settings` table) — change anytime, no redeploy

| Setting | Purpose | Wrangler seed key |
| ------- | ------- | ----------------- |
| `clientName` | Brand name shown across UI, OG metadata, RSS, emails | `CLIENT_NAME` |
| `clientTagline` | Homepage subhead | `CLIENT_TAGLINE` |
| `clientLogoUrl` | Header logo (replaces brand text when set) | `CLIENT_LOGO_URL` |
| `clientFaviconUrl` | Custom favicon | `CLIENT_FAVICON_URL` |
| `themePrimaryColor` | Accent color, injected as `--theme-primary` | `THEME_PRIMARY_COLOR` |
| `emailFromAddress` | Resend `From` address. Domain must be verified in Resend. Ignored when `EMAIL_PROVIDER=GMAIL`. | `EMAIL_FROM_ADDRESS` |

Resolution at request time: **DB row → `wrangler.jsonc` seed → hard-coded default**. Saving an empty value in admin removes the override and falls back to the seed.

## Wrangler `vars` — change requires redeploy

| Var | Required when | Purpose |
| --- | ------------- | ------- |
| `CLIENT_DOMAIN` | always | Canonical URLs, sitemap, default Resend `from` (`noreply@$CLIENT_DOMAIN`), Astro `site` URL |
| `CLIENT_SLUG` | always | Folder name under `edgepress/` in the media bucket. Keeps tenant uploads isolated |
| `CLIENT_FONT` | optional | Google Font family name (e.g. `Inter`, `Playfair Display`). Read at **build time** |
| `MEDIA_PUBLIC_BASE` | always | Public base URL of the R2 bucket. Used to build asset URLs after upload |
| `EMAIL_PROVIDER` | always | `RESEND` or `GMAIL` |

> `CLIENT_FONT` is read at **build time** by `astro.config.mjs`, so changing it requires a redeploy.

## Wrangler bindings

| Binding | Type | Notes |
| ------- | ---- | ----- |
| `DB` | D1 | Per-tenant database. Binding name must always be `"DB"` |
| `MEDIA` | R2 | Bucket for image / video uploads. Isolation is via `CLIENT_SLUG` prefix |
| `ASSETS` | Static assets | Astro's `dist/` output |

## Secrets — `wrangler secret put`

| Secret | Required when | Purpose |
| ------ | ------------- | ------- |
| `MASTER_ADMIN_KEY` | always | Login key for `/admin/login`. Stored in an HttpOnly cookie after login |
| `RESEND_API_KEY` | `EMAIL_PROVIDER=RESEND` | Resend API key (`re_...`) |
| `GMAIL_USER` | `EMAIL_PROVIDER=GMAIL` | Gmail address. Used as both SMTP login and the `From:` address |
| `GMAIL_APP_PASSWORD` | `EMAIL_PROVIDER=GMAIL` | [Gmail App Password](https://support.google.com/accounts/answer/185833) |

## Local development (`.dev.vars`)

`.dev.vars` is the Wrangler equivalent of `.env` — only loaded when `wrangler dev` runs. **Do not commit it.**

```sh
MASTER_ADMIN_KEY=local-dev-admin-key
RESEND_API_KEY=re_dev_xxx
GMAIL_USER=your-gmail@gmail.com
GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
```
