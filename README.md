# EdgeLetter

Newsletters and blogs for everyone, on one Cloudflare Worker. Writers sign up at **[edgeletter.blog](https://edgeletter.blog)**, get `<handle>.edgeletter.blog`, write in a markdown editor, and every post reaches their subscribers' inboxes. Free to start; Pro adds limits, a custom domain and no watermark.

Built with Astro SSR on Workers, D1, R2, Queues and Resend.

## Work with Us

Want it customized or run for your organization?

- **Portal:** [rubrion.ai](https://rubrion.ai)
- **Email:** [hello@rubrion.ai](mailto:hello@rubrion.ai)

## What's inside

| Area | |
|---|---|
| Writers | Magic-link + Google sign-in, multiple publications per account, owner/editor roles, invitations |
| Editor | Markdown with live preview, image/video upload to R2, optional AI proofread (Workers AI) |
| Readers | Double opt-in, one-click unsubscribe, RSS, sitemap, embeddable widget, en/pt-BR |
| Sending | Queue fan-out via Resend's batch API, per-recipient delivery ledger (idempotent retries), bounce/complaint suppression, open/click stats |
| Plans | Free / Pro limits on subscribers, monthly emails, media and AI; Stripe Checkout + customer portal |
| Domains | Pro custom domains through Cloudflare for SaaS |
| Safety | Allowlist HTML sanitizer, per-publication API keys, rate limits, Turnstile, abuse reports, staff console with suspension |

## Docs

- [Architecture](public-docs/architecture.md): hosts, tenancy, data model, email pipeline
- [Configuration](public-docs/configuration.md): vars, secrets, bindings
- [Deployment](public-docs/deployment.md): one-time platform setup and releases
- [Local development](public-docs/local-development.md)
- [Email](public-docs/email-providers.md): sender domain, webhooks, deliverability
- [Commands](public-docs/commands.md)

## License

[GPLv3](LICENSE)
