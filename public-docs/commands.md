# Useful Commands

| Command | What it does |
| ------- | ------------ |
| `bun run dev` | Astro dev server (no CF bindings) |
| `bunx wrangler dev` | Wrangler dev server (full CF bindings: D1, R2, env vars) |
| `bun run build` | Server build to `dist/` |
| `bun run deploy` | Build + `wrangler deploy` |
| `bun run cf-typegen` | Regenerate `worker-configuration.d.ts` after editing `wrangler.jsonc` |
| `bun run db:generate` | Generate a new SQL migration in `drizzle/` after editing `src/db/schema.ts` |
| `bunx wrangler d1 migrations apply <db> --local` | Apply pending migrations to local D1 |
| `bunx wrangler d1 migrations apply <db> --remote` | Apply pending migrations to production D1 |
| `bunx wrangler tail` | Stream production logs |
| `bunx wrangler d1 execute <db> --remote --command "..."` | Run SQL against production D1 |
