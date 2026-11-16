import { expect, test } from 'bun:test';
import { parseFeed } from '../src/lib/feed-parse';

test('RSS 2.0 with content:encoded, CDATA and entities', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
    <title>My &amp; Blog</title>
    <item><title>First post</title><link>https://ex.com/a</link><guid isPermaLink="false">post-1</guid>
      <pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate><description>short</description>
      <content:encoded><![CDATA[<p>Hello <b>world</b></p>]]></content:encoded></item>
    <item><title>Second</title><link>https://ex.com/b</link><description>&lt;p&gt;Only description&lt;/p&gt;</description></item>
  </channel></rss>`;
  const f = parseFeed(xml);
  expect(f.title).toBe('My & Blog');
  expect(f.items).toHaveLength(2);
  expect(f.items[0]).toMatchObject({ guid: 'post-1', title: 'First post', link: 'https://ex.com/a', html: '<p>Hello <b>world</b></p>' });
  expect(f.items[0]!.date?.toISOString()).toBe('2026-11-02T10:00:00.000Z');
  expect(f.items[1]).toMatchObject({ guid: 'https://ex.com/b', html: '<p>Only description</p>' });
});

test('single-item RSS still yields an array', () => {
  const f = parseFeed('<rss><channel><title>t</title><item><title>Only</title><link>https://x.y/1</link></item></channel></rss>');
  expect(f.items).toHaveLength(1);
});

test('Atom with alternate link and html content', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom blog</title>
    <entry><id>tag:x,2026:1</id><title>Entry</title>
      <link rel="self" href="https://x.y/self"/><link rel="alternate" href="https://x.y/entry"/>
      <published>2026-10-01T08:00:00Z</published><content type="html">&lt;p&gt;Body&lt;/p&gt;</content></entry></feed>`;
  const f = parseFeed(xml);
  expect(f.items[0]).toMatchObject({ guid: 'tag:x,2026:1', link: 'https://x.y/entry', html: '<p>Body</p>' });
});

test('rejects non-feeds', () => {
  expect(() => parseFeed('<html><body>nope</body></html>')).toThrow();
});
