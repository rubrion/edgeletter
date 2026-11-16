# Deployment

## One-time platform setup

1. **DNS on the `edgeletter.blog` zone**:
   - The Worker attaches `edgeletter.blog` and `app.edgeletter.blog` as custom domains.
   - Add a proxied wildcard record `* AAAA 100::` so `<handle>.edgeletter.blog` reaches the `*/*` route.
2. **Custom domains (Cloudflare for SaaS)**:
   - Enable Custom Hostnames on the zone.
   - Create `customers.edgeletter.blog` (proxied `AAAA 100::`) and set it as the fallback origin.
   - Put the zone id in `CF_ZONE_ID`.
3. **Resend**:
   - Verify `mail.edgeletter.blog` (DKIM, SPF, DMARC).
   - Add a webhook to `https://app.edgeletter.blog/api/webhooks/resend` for `email.bounced`, `email.complained`, `email.opened` and `email.clicked`.
4. **Stripe**:
   - Create the Pro product and price.
   - Add a webhook to `/api/webhooks/stripe` for `checkout.session.completed` and `customer.subscription.created/updated/deleted`.
   - Enable the customer portal.
5. **Google**: create an OAuth client with redirect `https://app.edgeletter.blog/auth/google/callback`.
6. **Turnstile**: allow the `edgeletter.blog` hostname on the widget.
7. **Queues**: `bunx wrangler queues create edgeletter-email` and `edgeletter-email-dlq`.
8. **Secrets**: set them as listed in [configuration](configuration.md).
9. **First staff account**:
   - Sign in once at `app.edgeletter.blog`.
   - Then run `UPDATE users SET is_staff = 1 WHERE email = '<you>'` with `wrangler d1 execute --remote`.

## Releasing

```sh
bunx wrangler d1 export rubrion-edgeletter --remote --output backup.sql   # always back up first
bunx wrangler d1 migrations apply rubrion-edgeletter --remote
bun run deploy
```

Migrations are written so the previous release keeps working against the new schema until the deploy finishes.
