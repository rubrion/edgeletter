# Local Development

```sh
bunx wrangler d1 migrations apply <tenant>-edgepress --local   # one-time
bun run dev                                                    # http://localhost:4321
```

> `bun run dev` runs `astro dev`, which has a Vite server but **no Cloudflare bindings**. For features that depend on `cloudflare:workers` env (D1, R2, env vars), use `bunx wrangler dev` instead.

## Smoke test

```sh
curl -X POST http://localhost:4321/api/subscribe \
  -H 'Content-Type: application/json' \
  -d '{"email":"me@test.com"}'
# → {"ok":true}

bunx wrangler d1 execute <tenant>-edgepress --local \
  --command "SELECT email, status FROM subscribers"
```

Then open `/admin/login`, paste your `MASTER_ADMIN_KEY`, configure brand visuals at `/admin/settings`, write a markdown post (drag-drop images!), and hit **Publish + Send**.

## `.dev.vars`

Create `.dev.vars` at the repo root (do not commit it):

```sh
MASTER_ADMIN_KEY=local-dev-admin-key
RESEND_API_KEY=re_dev_xxx
GMAIL_USER=your-gmail@gmail.com
GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
```
