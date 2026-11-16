/**
 * Card data derived from a post's (sanitized) HTML: the first https image as
 * the cover, and a plain-text excerpt. Pure, so it is unit-tested directly.
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

const decode = (s: string): string =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z#0-9]+);/gi, (m, k) => ENTITIES[k.toLowerCase()] ?? m);

/** First image with an absolute https URL (relative ones can't be resolved later). */
export const firstImage = (html: string): string | null => {
  for (const m of html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"|!\[[^\]]*\]\((https:\/\/[^)\s]+)\)/gi)) {
    const src = decode((m[1] ?? m[2])!);
    if (/^https:\/\//i.test(src)) return src;
  }
  return null;
};

export const excerptFrom = (html: string, max = 220): string => {
  const text = decode(
    html
      .replace(/<(script|style|figure|figcaption|pre)\b[\s\S]*?<\/\1>/gi, ' ')
      // Stray markdown (e.g. feeds that ship it): images out, links to their text.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/(^|\s)[*_]{1,2}([^*_]+)[*_]{1,2}(?=\s|$|[.,;:!?])/g, '$1$2')
      // Block boundaries become word breaks; inline tags vanish without one.
      .replace(/<\/?(p|div|h[1-6]|li|ul|ol|br|blockquote|tr|td|th|table|section|article|header|footer|hr)\b[^>]*>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)).replace(/[\s,;:.–—-]+$/, '')}…`;
};

export const postMeta = (html: string, preferredCover?: string | null) => ({
  coverUrl: preferredCover && /^https:\/\//i.test(preferredCover) ? preferredCover : firstImage(html),
  excerpt: excerptFrom(html) || null,
});
