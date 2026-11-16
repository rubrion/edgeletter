/** Publication handles become subdomains: <handle>.<PLATFORM_DOMAIN>. */

const RESERVED = new Set([
  'www', 'app', 'api', 'admin', 'mail', 'email', 'smtp', 'imap', 'pop', 'mx', 'ns', 'ns1', 'ns2', 'dns',
  'blog', 'help', 'support', 'docs', 'status', 'staff', 'billing', 'pay', 'payments', 'stripe', 'auth',
  'login', 'signin', 'signup', 'account', 'accounts', 'dashboard', 'static', 'assets', 'cdn', 'media',
  'files', 'img', 'images', 'explore', 'discover', 'directory', 'about', 'legal', 'terms', 'privacy',
  'security', 'abuse', 'report', 'root', 'edgeletter', 'customers', 'test', 'dev', 'staging', 'preview',
]);

export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

/** Errors are dictionary keys (src/i18n/studio.ts) so pages can translate them. */
export type HandleCheck = { ok: true; handle: string } | { ok: false; error: 'handle.format' | 'handle.hyphens' | 'handle.reserved' };

export const checkHandle = (raw: string): HandleCheck => {
  const handle = raw.trim().toLowerCase();
  if (!HANDLE_RE.test(handle)) {
    return { ok: false, error: 'handle.format' };
  }
  if (handle.includes('--')) return { ok: false, error: 'handle.hyphens' };
  if (RESERVED.has(handle)) return { ok: false, error: 'handle.reserved' };
  return { ok: true, handle };
};

/** A handle suggestion from a publication name ("Field Notes!" → "field-notes"). */
export const suggestHandle = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
