# EdgePress

EdgePress is a high-performance, white-label publishing engine. It ships as a single Cloudflare Worker (Astro SSR + D1 + R2) that runs a public blog, an admin editor, a media uploader, and a newsletter dispatcher — all in one deployment with zero sidecars.

Each white-label tenant gets **one Worker deployment + one D1 database**. Brand visuals (name, logo, theme color, email sender) are configured live from an admin panel — no redeploy required.

**Email providers:**
- **Resend** — HTTP API, called directly from the Worker.
- **Gmail SMTP** — TCP to `smtp.gmail.com:465` via `cloudflare:sockets`. No sidecar container.

Live demo: [edgepress.rubrion.ai](https://edgepress.rubrion.ai)  
Repository: [github.com/rubrion/edgepress](https://github.com/rubrion/edgepress)
