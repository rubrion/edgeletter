# Email Providers

EdgePress supports two email providers, selected per-tenant. Switching providers is a config-only change — no code edits, no infra moves.

## Switching providers

| From → To | Steps |
| --------- | ----- |
| Resend → Gmail | 1. `wrangler secret put GMAIL_USER` and `GMAIL_APP_PASSWORD`. 2. Update `EMAIL_PROVIDER=GMAIL` in `wrangler.jsonc`. 3. `bun run deploy`. |
| Gmail → Resend | 1. `wrangler secret put RESEND_API_KEY`. 2. Update `EMAIL_PROVIDER=RESEND`. 3. `bun run deploy`. (Also set the From address in `/admin/settings`.) |

The `from` address differs between providers:
- **Resend** uses `emailFromAddress` from `/admin/settings` if set, otherwise falls back to `noreply@$CLIENT_DOMAIN`. The domain must be verified in Resend.
- **Gmail** uses `$GMAIL_USER` directly (Gmail rejects mismatched senders).

## Email deliverability (avoiding spam)

For Resend, three DNS records on `$CLIENT_DOMAIN` are required for emails to land in inboxes:

| Record | What it does |
| ------ | ------------ |
| **DKIM** (CNAMEs Resend provides) | Cryptographic proof the email wasn't tampered with |
| **SPF** (TXT) | Authorises Resend's servers to send on your behalf |
| **DMARC** (TXT on `_dmarc.$CLIENT_DOMAIN`) | Policy: e.g. `v=DMARC1; p=none; rua=mailto:postmaster@$CLIENT_DOMAIN` |

Add them in your Resend dashboard → Domains → Add domain.

EdgePress already sends the headers Gmail's bulk-sender policy requires (`List-Unsubscribe`, `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, plain-text alternative).

## Operational notes

- **Free-tier Worker CPU is 10 ms per invocation.** Each Gmail send opens a TCP+TLS handshake to `smtp.gmail.com:465`. Realistic ceiling on the free tier is a few hundred recipients per publish. The paid Workers tier ($5/mo) lifts the cap to 30 s CPU.
- **Gmail send quota** — Gmail SMTP caps at ~500 messages/day per account. Tenants with growing lists must move to Resend.
- The Gmail SMTP path uses `cloudflare:sockets`, which **only runs on the Cloudflare runtime** (production or `wrangler dev`). It cannot run in plain Node/Bun.
