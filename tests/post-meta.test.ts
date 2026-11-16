import { expect, test } from 'bun:test';
import { excerptFrom, firstImage, postMeta } from '../src/lib/post-meta';

test('first https image', () => {
  expect(firstImage('<p>x</p><img src="/rel.png"><img alt="a" src="https://cdn.x/a.webp?w=1&amp;h=2">')).toBe('https://cdn.x/a.webp?w=1&h=2');
  expect(firstImage('<p>no image</p>')).toBeNull();
});

test('excerpt strips tags, decodes entities, cuts at a word', () => {
  expect(excerptFrom('<h2>Title</h2><p>Hello &amp; <b>welcome</b>.</p>')).toBe('Title Hello & welcome.');
  const long = excerptFrom(`<p>${'word '.repeat(100)}</p>`, 50);
  expect(long.length).toBeLessThanOrEqual(51);
  expect(long.endsWith('…')).toBe(true);
});

test('preferred cover wins when https', () => {
  expect(postMeta('<img src="https://a/1.png">', 'https://feed/cover.jpg').coverUrl).toBe('https://feed/cover.jpg');
  expect(postMeta('<img src="https://a/1.png">', 'http://insecure/c.jpg').coverUrl).toBe('https://a/1.png');
});

test('markdown leftovers', () => {
  expect(firstImage('![](https://x/cover.webp)\n\n*Intro*')).toBe('https://x/cover.webp');
  expect(excerptFrom('![](https://x/c.webp) *Why we built it:* see [the docs](https://d).')).toBe('Why we built it: see the docs.');
});
