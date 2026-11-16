# EdgeLetter as a self-serve platform — plan

Status: draft · 2026-11-16

## Goal

Let anyone sign up, get an account, and run their own publication (blog +
newsletter) on EdgeLetter, Substack-style. Free for writers as long as our
running cost per publication stays near zero; paid tiers only where real
cost appears (email volume, custom domains).

## Where we are today

EdgeLetter is **one publication per deploy**. Every assumption below has to
change:

| Area | Today | Why it blocks multi-tenant |
|---|---|---|
| Data | One D1 per tenant; `settings` is a global key/value table | No `publication_id` anywhere |
| Subscribers | `subscribers.email` is globally `UNIQUE` | Same reader can't follow two publications |
| Posts | `posts.slug` globally `UNIQUE` | Two writers can't both have `/hello-world` |
| Auth | Single `MASTER_ADMIN_KEY`, stored raw in the cookie | No users, no roles, no sessions |
| Routing | One custom domain per worker (`CLIENT_DOMAIN` var) | No per-publication host resolution |
| Branding | `CLIENT_FONT` read at build time; colors in global `settings` | Must be per publication at request time |
| Email | `dispatchCampaign` sends every email inside the publish request (`Promise.allSettled`) | Hits Worker subrequest/CPU limits past a few hundred subscribers; no retries |
| Content safety | Post HTML from `marked` and the About body are rendered unsanitized | Fine for one trusted admin; **stored XSS** once strangers write |
| Media | One R2 bucket, flat keys | No per-publication quota or cleanup |
| AI review | Daily token cap per D1 | Workers AI neurons are an **account-wide** budget shared by all writers |

What carries over unchanged: the Astro + Workers + D1 + R2 stack, the
editor, the stationery design system, the embed widget, double opt-in,
Turnstile, RSS, i18n.

## Target architecture

### Tenancy

- **One shared Worker + one shared D1** with `publication_id` on every
  tenant-owned row. Simplest to operate, one migration path, cross-publication
  features (reader accounts, discovery) become plain queries.
- D1 caps a database at 10 GB. Posts are small; that is millions of posts.
  If we ever approach it, shard by publication (D1 allows many databases per
  account) behind a `getDb(publicationId)` helper — design the data layer so
  that seam exists from day one.
- Keep the current **per-deploy white-label** mode working for paying
  white-label customers: same code, a "single publication" config.

### Hosts and routing

| Host | Serves |
|---|---|
| `app.<platform>` | Sign-up, login, writer dashboard (current `/admin` studio) |
| `<handle>.<platform>` | A publication: home, posts, about, subscribe, RSS, embed |
| `www.<platform>` | Marketing + discovery |
| Custom domain (paid) | A publication, via Cloudflare for SaaS custom hostnames |

- Wildcard DNS + Workers route `*.<platform>/*`; middleware resolves
  `Host` → publication (cached in KV / in-memory, invalidated on change).
- **Subdomain per publication is also the main XSS containment**: each
  writer's content runs on its own origin, so it can't read the dashboard's
  or another publication's cookies. Dashboard cookies are host-only on `app.`.
- Cloudflare for SaaS: custom hostnames are free up to a quota, then a
  small monthly fee each — gate custom domains behind the paid tier.

### Accounts and auth

- Tables: `users`, `sessions`, `memberships(user_id, publication_id, role)`
  with roles `owner | editor | contributor`.
- Login: **email magic link + Google/GitHub OAuth**. No passwords to store
  or reset. Passkeys later.
- Sessions: random token, store **hash** in D1, cookie `HttpOnly; Secure;
  SameSite=Lax`, host-only on `app.`. Replace the raw-key cookie in
  `src/lib/auth.ts`.
- Sign-up protection: Turnstile (already integrated), per-IP and
  per-email rate limits, email verification before a publication can send.
- `MASTER_ADMIN_KEY` becomes a platform-staff role, not a login path.

### Data model (delta)

```
users(id, email UNIQUE, name, avatar_url, created_at, verified_at)
sessions(id, user_id, token_hash, expires_at, created_at, user_agent)
publications(id, handle UNIQUE, name, tagline, logo_url, favicon_url,
             custom_domain UNIQUE NULL, plan, status, created_at)
memberships(user_id, publication_id, role, PRIMARY KEY(user_id, publication_id))
publication_settings(publication_id, key, value, PRIMARY KEY(publication_id, key))

posts        + publication_id, author_user_id;  UNIQUE(publication_id, slug)
subscribers  + publication_id;                  UNIQUE(publication_id, email)
campaigns    + publication_id, recipients, sent, failed
email_suppressions(email, reason, created_at)   -- platform-wide bounces/complaints
usage_counters(publication_id, period, emails_sent, ai_tokens, media_bytes)
```

`loadSettings()` becomes `loadSettings(publicationId)`; `BaseHead`'s
per-request `themeCss` already supports per-tenant colors. `CLIENT_FONT`
moves from build time to a per-publication setting picked from a curated
list of preloaded faces.

### Email at scale (the real cost)

- **Publish enqueues, a consumer sends.** Publish writes the campaign row and
  pushes recipient batches to a **Cloudflare Queue**; a consumer Worker sends
  in batches with retries and updates `campaigns`. Removes the in-request
  fan-out limit entirely.
- Shared sending domain (`mail.<platform>`) with per-publication From name
  and `Reply-To` = owner. SPF/DKIM/DMARC on the shared domain.
- **Bounce and complaint webhooks → `email_suppressions`**, checked before
  every send. On a shared domain one abusive writer can ruin deliverability
  for everyone; this is non-negotiable.
- **Caps per plan** (`usage_counters`), enforced at enqueue time.
- Provider: price per email decides the free tier's size. Compare Resend,
  Amazon SES and Cloudflare Email Sending on current pricing before
  committing; keep `dispatch.ts` provider-pluggable as it is today.

### Content safety and abuse

- **Sanitize all rendered HTML** (post body after `marked`, About body,
  embed) with an allowlist sanitizer. Do this first — it's also a latent
  issue today.
- New publications start in a **probation** state: low email cap, no custom
  domain, until the account is a few days old / verified / unflagged.
- "Report this publication" link on every page and email footer; staff
  dashboard to suspend a publication (stops sends, shows a notice).
- AI review: per-user daily cap well under the account-wide Workers AI
  budget, or limit it to paid tiers.

### Media

- R2 keys `pub/<publication_id>/…`, per-plan storage quota in
  `usage_counters`, image size/type limits (exists), delete on publication
  removal.

## Cost model (to validate with current pricing)

Cost drivers, roughly in order: **email sends** ≫ custom hostnames > R2
storage > Workers requests ≈ D1. A publication with no subscribers costs
effectively nothing on Workers paid ($5/month account base covers millions
of requests). So the free tier is defined by email volume:

| Plan | Subscribers | Emails / month | Custom domain | Watermark | AI review |
|---|---|---|---|---|---|
| Free | up to ~1,000 | ~4,000 | no | yes | small daily cap |
| Pro | larger | per-tier | yes | removable | larger cap |

Numbers are placeholders: set them once the provider price per 1,000 emails
is chosen so a maxed-out free publication costs us cents per month.

## Phases

**Phase 0 — Make the codebase tenant-ready (no user-visible change)** — ✅ implemented 2026-11-16
1. HTML sanitization for posts, About, embed.
2. Queue-based dispatch with retries; suppression table + provider webhooks.
3. Add `publications` with one row ("rubrion"); add `publication_id` to
   posts/subscribers/campaigns/settings; backfill; swap global uniques for
   composite ones. Every query goes through a publication-scoped data layer.
4. Host → publication resolution in middleware (one host maps to "rubrion").

**Phase 1 — Accounts and self-serve publications**
1. `users`, `sessions`, `memberships`; magic link + OAuth; replace master-key
   login (keep it as staff role).
2. Sign-up flow on `app.`: create account → pick handle → name/tagline →
   publication live at `<handle>.<platform>`.
3. Dashboard switcher for users with several publications; invite editors.
4. Wildcard subdomain routing; per-publication branding at request time.
5. Probation limits + report link + staff suspend.

**Phase 2 — Reader side**
1. Reader accounts (optional; subscribing stays email-only).
2. Subscriber import/export (CSV), basic stats (opens via provider webhooks,
   subscriber growth).
3. Discovery on `www.`: recent posts, featured publications, tags.
4. Comments (moderated by publication owner) — only if wanted.

**Phase 3 — Monetization**
1. Pro plan billing for writers (higher caps, custom domain, no watermark).
2. Paid subscriptions for readers (Substack's core): Stripe Connect, paywalled
   posts, platform fee.
3. Custom domains via Cloudflare for SaaS.

## Migration of the current deployment

`edgeletter.rubrion.ai` becomes the first publication. Phase 0 runs as D1
migrations with a backfill to `publication_id = 'rubrion'`; the host map
points `edgeletter.rubrion.ai` at it. No URL changes, no subscriber
re-confirmation.

## Open decisions

1. Platform domain name (needed for wildcard DNS and the shared sending
   domain — sending reputation should live on a domain separate from
   `rubrion.ai`).
2. Email provider and therefore the free-tier email cap.
3. Auth: magic link + which OAuth providers.
4. Moderation policy and who staffs reports.
5. Whether reader accounts and paid subscriptions are in scope for v1 or
   strictly later.
