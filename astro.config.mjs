// @ts-check

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
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

// Platform root; publications live on <handle>.<PLATFORM_DOMAIN> and canonical
// URLs are built from each request's own host.
const platformDomain = process.env.PLATFORM_DOMAIN || wranglerVar('PLATFORM_DOMAIN') || 'edgeletter.blog';

// https://astro.build/config
export default defineConfig({
  site: `https://${platformDomain}`,
  output: 'server',
  integrations: [
    mdx(),
    react(),
  ],

  // Stationery type system: engraved editorial serif for display (its italic
  // doubles as the eyebrow face), and a readable serif for body.
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Cormorant Garamond',
      cssVariable: '--font-display',
      fallbacks: ['Georgia', 'serif'],
      weights: [500, 600],
      styles: ['normal', 'italic'],
    },
    {
      provider: fontProviders.google(),
      name: 'Newsreader',
      cssVariable: '--font-body',
      fallbacks: ['Georgia', 'serif'],
      weights: [400, 500, 600],
      styles: ['normal', 'italic'],
    },
  ],

  adapter: cloudflare(),
});
