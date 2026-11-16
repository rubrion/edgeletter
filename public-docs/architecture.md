# Architecture

One Worker serves every host. `src/middleware.ts` classifies the request by `Host` (see `src/lib/tenant.ts`):

| Host | Serves | Auth |
|---|---|---|
| `edgeletter.blog`, `www.` | Landing, `/explore`, `/directory` (`src/pages/x-platform`) | none |
| `app.edgeletter.blog` | Sign-in, dashboard, `/admin/*`, `/api/*`, team, keys, plan, domain, staff (`src/pages/x-app`) | session cookie (host-only) |
| `<handle>.edgeletter.blog` or a custom domain | The publication: home, posts, RSS, sitemap, embed, subscribe, report | public; `/api/publish` with a publish API key |
| alias (e.g. `edgeletter.rubrion.ai`) | 301 to the publication; unsubscribe/confirm links answered in place | — |
| anything else | 404 | — |

Auth checks run on a normalized path (`src/lib/paths.ts`), so `/api/publish/` and `/api/publish/.` get the same check as `/api/publish`.

## Tenancy

Every tenant-owned row carries `publication_id`: posts, subscribers, campaigns, settings, AI usage, media, keys. On publication hosts the publication comes from the host; on the app host it comes from the session's active publication. Membership is re-checked on every request and lands in `Astro.locals.publication` and `locals.role`. Host lookups are cached per isolate (60 s, bounded); database errors fail closed with a 503.

## Accounts

`users`, `sessions` (SHA-256 of the token), `login_tokens` (magic links and invitations, single use), `oauth_accounts` (Google, PKCE), `memberships` (`owner` | `editor`), `api_keys` (hashed, scoped `publish` | `subscribe`). Staff access comes from `users.is_staff`.

## Sending

Publishing reserves the month's email allowance (`usage_counters`), records a `queued` campaign and pushes batches of 50 recipients onto `EMAIL_QUEUE`. The consumer (`src/worker.ts` → `src/lib/email-queue.ts`) does four things:

1. Claims recipients in `campaign_deliveries` and re-checks status and suppressions.
2. Sends via Resend's batch API from `Name <posts@mail.edgeletter.blog>`, with Reply-To set to the owner.
3. Retries transient failures with backoff.
4. Recomputes the campaign's counters atomically from the ledger.

Redelivery is idempotent, and a partial unique index allows only one live campaign per post. Resend webhooks feed `email_suppressions` (hard bounces, complaints) and open/click times.

## Limits

`src/lib/plans.ts`: subscribers, emails per month (500 during a free publication's first week), media bytes and AI tokens per day, enforced at subscribe, import, publish, upload and AI review.
