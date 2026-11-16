// @ts-check

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Read a single var from wrangler.jsonc by key — avoids full JSONC parsing
// (full parse breaks on https:// URLs being mistaken for comments).
// wrangler vars are CF Worker runtime values — process.env doesn't carry them.
function wranglerVar(key) {
  try {
    const path = fileURLToPath(new URL('./wrangler.jsonc', import.meta.url));
    const raw = readFileSync(path, 'utf-8');
    const m = raw.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"` ));
    return m?.[1] ?? '';
  } catch {
    return '';
  }
}

const clientDomain = process.env.CLIENT_DOMAIN || wranglerVar('CLIENT_DOMAIN') || 'example.com';

// Accept either a bare family name ("Montserrat") or a full CSS stack
// ("'Montserrat', -apple-system, ..."). The Google provider only wants the family name,
// so take the first comma-separated token and strip surrounding quotes/whitespace.
const rawFont = (process.env.CLIENT_FONT || wranglerVar('CLIENT_FONT')).trim();
const clientFont = rawFont
  .split(',')[0]
  .trim()
  .replace(/^["']|["']$/g, '')
  .trim();

// https://astro.build/config
export default defineConfig({
  site: `https://${clientDomain}`,
  output: 'server',
  integrations: [
    mdx(),
    react(),
    sitemap({
      filter: (page) => !page.includes('/embed/'),
    }),
  ],

  // Stationery type system: condensed editorial serif for display, script for
  // eyebrows, and a readable serif for body. CLIENT_FONT overrides body only.
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Instrument Serif',
      cssVariable: '--font-display',
      fallbacks: ['Georgia', 'serif'],
      weights: [400],
      styles: ['normal', 'italic'],
    },
    {
      provider: fontProviders.google(),
      name: 'Pinyon Script',
      cssVariable: '--font-script',
      fallbacks: ['cursive'],
      weights: [400],
      styles: ['normal'],
    },
    {
      provider: fontProviders.google(),
      name: clientFont || 'Newsreader',
      cssVariable: '--font-body',
      fallbacks: ['Georgia', 'serif'],
      weights: [400, 500, 600],
      styles: ['normal', 'italic'],
    },
  ],

  adapter: cloudflare(),
});
