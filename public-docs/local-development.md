# Local development

```sh
bun install
bunx wrangler d1 migrations apply rubrion-edgeletter --local
bun run dev            # http://localhost:4321
```

`.dev.vars` (never commit it):

```sh
PLATFORM_DOMAIN=localhost
RESEND_API_KEY=re_test
```

With `PLATFORM_DOMAIN=localhost`, browsers resolve `*.localhost` to your machine:

| URL | |
|---|---|
| `http://localhost:4321` | landing / explore |
| `http://app.localhost:4321` | sign-in and dashboard |
| `http://<handle>.localhost:4321` | a publication |

In dev, transactional emails (sign-in links, invites, confirmations) are printed to the terminal instead of sent. Follow the sign-in link from there. Without a queue consumer running locally, campaigns are processed inline.

Tests: `bun test tests`.
