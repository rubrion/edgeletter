# Configuration

## Wrangler `vars`

| Var | Purpose |
|---|---|
| `PLATFORM_DOMAIN` | Platform root (`edgeletter.blog`); publications live on `<handle>.<PLATFORM_DOMAIN>` |
| `MAIL_FROM_DOMAIN` | Verified Resend sending domain (`mail.edgeletter.blog`) |
| `CUSTOM_DOMAIN_TARGET` | CNAME target writers point custom domains at (`customers.edgeletter.blog`) |
| `CF_ZONE_ID` | Zone id of `PLATFORM_DOMAIN`, for the custom hostnames API |
| `MAX_CUSTOM_HOSTNAMES` | Platform-wide ceiling on custom domains (default 90, inside Cloudflare's 100 free). New connections are refused at the cap |
| `MEDIA_PUBLIC_BASE` | Public base URL of the R2 media bucket |
| `TURNSTILE_SITE_KEY` | Turnstile site key (sign-in, subscribe, report) |

## Secrets (`wrangler secret put`)

| Secret | Purpose |
|---|---|
| `RESEND_API_KEY` | Sending |
| `RESEND_WEBHOOK_SECRET` | Svix secret of the Resend webhook → `/api/webhooks/resend` (bounced, complained, opened, clicked) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in; redirect `https://app.edgeletter.blog/auth/google/callback` |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO` (monthly), `STRIPE_PRICE_PRO_YEARLY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PORTAL_CONFIG` | Pro plan; webhook → `/api/webhooks/stripe` (checkout.session.completed, customer.subscription.*) |
| `CF_API_TOKEN` | Token with *SSL and Certificates: Edit* on the platform zone (custom hostnames) |
| `TURNSTILE_SECRET` | Enables Turnstile verification |

Every feature degrades gracefully when its secret is missing: no Google button, upgrades disabled, custom domains unavailable.

## Bindings

| Binding | Type | Notes |
|---|---|---|
| `DB` | D1 | All publications |
| `MEDIA` | R2 | `edgeletter/pub/<publication_id>/…`; pre-platform media keeps its old prefix |
| `EMAIL_QUEUE` | Queue | `edgeletter-email` (+ DLQ `edgeletter-email-dlq`) |
| `AUTH_LIMITER` | Rate limit | 5 per key per minute (sign-in, invites, reports) |
| `AI` | Workers AI | Editor proofread |

## Per-publication settings

These are stored in the `settings` table, scoped by `publication_id`, and edited at `/admin/settings` and `/admin/widget`: name, tagline, logo, favicon, colors, About text and widget defaults. Name and discovery listing are mirrored on `publications`.

## Custom domain costs

Cloudflare allocates a large custom-hostname quota but bills hostnames beyond its free allowance. Three guards keep the count equal to what paying writers use:

1. `MAX_CUSTOM_HOSTNAMES`: hard platform ceiling.
2. A downgrade from Pro (Stripe webhook or staff) releases the publication's hostname immediately.
3. A daily cron (`17 4 * * *`) releases setups still pending after 7 days and any hostname held by a non-Pro publication.

The staff console shows hostnames in use against the cap.

## Pricing

Launch pricing is R$29/month or R$290/year in BRL, with US$7/US$70 as Stripe currency options for buyers outside Brazil. Existing subscriptions keep their price when prices change later.

| | Free | Pro |
|---|---|---|
| Subscribers | 500 | 2,500 |
| Emails / month | 2,000 (500 in the first week) | 10,000 |

Limits are sized so that a writer at the cap costs at most about the plan price in email: Resend charges roughly $0.35–0.90 per 1,000 emails.
