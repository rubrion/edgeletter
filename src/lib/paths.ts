/**
 * Canonical form of a request path for auth decisions. Astro matches routes
 * loosely (trailing slash ignored, `.` segments tolerated), so the guard must
 * normalize at least as aggressively as the router or `/api/publish/` and
 * `/api/publish/.` slip past an exact-string check.
 */
export const normalizePath = (pathname: string): string => {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    /* malformed escapes: judge the raw path */
  }
  const out: string[] = [];
  for (const seg of decoded.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg.toLowerCase());
  }
  return '/' + out.join('/');
};

/** True when `path` is `base` or below it (segment-wise, not string prefix). */
export const under = (path: string, base: string): boolean => path === base || path.startsWith(`${base}/`);
