# Per-Tenant Deployment

> Run all commands from the repo root. Replace `<tenant>` with the tenant's slug (lowercase, hyphen-separated).

### 1. Install

```sh
bun install
```

### 2. Create the D1 database

```sh
bunx wrangler d1 create <tenant>-edgeletter
```

Copy the returned `database_id` into `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "<tenant>-edgeletter",
    "database_id": "<paste-here>",
    "migrations_dir": "./drizzle"
  }
]
```

> The binding name **must be `DB`** for every tenant — that's the contract the code reads. Only `database_name` and `database_id` change per tenant.

### 3. Create (or pick) an R2 bucket for media

```sh
bunx wrangler r2 bucket create <your-bucket>
```

One bucket can be shared across all tenants — uploads land under `edgeletter/<CLIENT_SLUG>/...` so each tenant has its own folder.

### 4. Set tenant `vars` in `wrangler.jsonc`

```jsonc
"routes": [
  { "pattern": "<tenant>.example.com", "custom_domain": true }
],
"vars": {
  "CLIENT_DOMAIN": "<tenant>.example.com",
  "CLIENT_SLUG": "<tenant>",
  "CLIENT_FONT": "Inter",
  "MEDIA_PUBLIC_BASE": "https://media.example.com",
  "EMAIL_PROVIDER": "RESEND"
},
"r2_buckets": [
  { "binding": "MEDIA", "bucket_name": "<your-bucket>" }
]
```

### 5. Apply database migrations

```sh
bunx wrangler d1 migrations apply <tenant>-edgeletter --local   # local
bunx wrangler d1 migrations apply <tenant>-edgeletter --remote  # production
```

To regenerate the SQL after a schema change: `bun run db:generate`.

### 6. Set secrets

```sh
bunx wrangler secret put MASTER_ADMIN_KEY        # always

# If EMAIL_PROVIDER=RESEND
bunx wrangler secret put RESEND_API_KEY

# If EMAIL_PROVIDER=GMAIL
bunx wrangler secret put GMAIL_USER
bunx wrangler secret put GMAIL_APP_PASSWORD
```

### 7. Regenerate types and deploy

```sh
bun run cf-typegen   # refresh worker-configuration.d.ts
bun run deploy       # astro build + wrangler deploy
```

### 8. Configure brand visuals via admin

Open `https://<tenant>.example.com/admin/login`, paste your `MASTER_ADMIN_KEY`, then navigate to `/admin/settings` and fill in brand name, tagline, logo URL, favicon URL, theme primary color, and email From-address.

Saved values take effect immediately on the next page render.
