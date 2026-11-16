/**
 * Post-login destination: only a path on this same origin. Resolving against
 * the origin (rather than regex-matching) catches `/\evil.com`, `//evil.com`,
 * encoded variants and control characters, which browsers treat as off-site.
 */
export const safeNext = (value: unknown, origin: string): string => {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(value)) return '/';
  try {
    const url = new URL(value, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : '/';
  } catch {
    return '/';
  }
};
