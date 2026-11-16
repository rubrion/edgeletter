import { XMLParser } from 'fast-xml-parser';

/**
 * RSS 2.0 / Atom / RSS 1.0 (RDF) → a flat list of items. Pure (no Workers
 * imports) so it is unit-tested directly. Content is returned as-is; callers
 * must sanitize before storing or rendering.
 */

export type FeedItem = {
  /** Stable identity: guid / Atom id, else the link. */
  guid: string;
  title: string;
  link: string | null;
  date: Date | null;
  html: string;
  /** Cover image from enclosure / media:content / media:thumbnail, if any. */
  image: string | null;
};

export type ParsedFeed = { title: string; items: FeedItem[] };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  cdataPropName: false as unknown as string,
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
  isArray: (name) => ['item', 'entry', 'link', 'enclosure', 'media:content', 'media:thumbnail'].includes(name),
});

/** Text of a node that may be a string, a number, or { '#text': … }. */
const text = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object' && '#text' in (v as Record<string, unknown>)) return text((v as Record<string, unknown>)['#text']);
  return '';
};

const date = (v: unknown): Date | null => {
  const s = text(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Atom links are elements with rel/href; prefer rel="alternate" (or none). */
const atomLink = (links: unknown): string | null => {
  const list = (Array.isArray(links) ? links : [links]).filter(Boolean) as Record<string, string>[];
  const alt = list.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate') ?? list[0];
  return alt?.['@_href'] ?? (typeof alt === 'string' ? alt : null);
};

const rssLink = (links: unknown): string | null => {
  const list = Array.isArray(links) ? links : [links];
  for (const l of list) {
    const t = text(l);
    if (t) return t;
  }
  return null;
};

/** First image URL among enclosures and Media RSS elements. */
const mediaImage = (it: Record<string, unknown>): string | null => {
  const list = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []) as Record<string, string>[];
  for (const e of list(it.enclosure)) if (e['@_url'] && /^image\//.test(e['@_type'] ?? '')) return e['@_url'];
  for (const m of list(it['media:content']))
    if (m['@_url'] && (m['@_medium'] === 'image' || /^image\//.test(m['@_type'] ?? ''))) return m['@_url'];
  for (const t of list(it['media:thumbnail'])) if (t['@_url']) return t['@_url'];
  const group = it['media:group'] as Record<string, unknown> | undefined;
  return group ? mediaImage(group) : null;
};

export const parseFeed = (xml: string): ParsedFeed => {
  const doc = parser.parse(xml) as Record<string, any>;

  // RSS 2.0
  if (doc.rss?.channel) {
    const ch = doc.rss.channel;
    const items = (ch.item ?? []) as Record<string, unknown>[];
    return {
      title: text(ch.title),
      items: items.map((it) => {
        const link = rssLink(it.link);
        return {
          guid: text(it.guid) || link || `${text(it.title)}|${text(it.pubDate)}`,
          title: text(it.title),
          link,
          date: date(it.pubDate) ?? date(it['dc:date']),
          html: text(it['content:encoded']) || text(it.description),
          image: mediaImage(it),
        };
      }),
    };
  }

  // Atom
  if (doc.feed) {
    const entries = (doc.feed.entry ?? []) as Record<string, unknown>[];
    return {
      title: text(doc.feed.title),
      items: entries.map((e) => {
        const link = atomLink(e.link);
        return {
          guid: text(e.id) || link || `${text(e.title)}|${text(e.updated)}`,
          title: text(e.title),
          link,
          date: date(e.published) ?? date(e.updated),
          html: text(e.content) || text(e.summary),
          image: mediaImage(e),
        };
      }),
    };
  }

  // RSS 1.0 (RDF)
  const rdf = doc['rdf:RDF'];
  if (rdf) {
    const items = (rdf.item ?? []) as Record<string, unknown>[];
    return {
      title: text(rdf.channel?.title),
      items: items.map((it) => {
        const link = rssLink(it.link);
        return {
          guid: text(it['@_rdf:about']) || link || text(it.title),
          title: text(it.title),
          link,
          date: date(it['dc:date']),
          html: text(it['content:encoded']) || text(it.description),
          image: mediaImage(it),
        };
      }),
    };
  }

  throw new Error('Not an RSS or Atom feed.');
};
