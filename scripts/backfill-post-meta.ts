// One-off: compute cover_url + excerpt for posts written before migration
// 0010. Reads `wrangler d1 execute --json` output of
//   SELECT id, content_html FROM posts WHERE cover_url IS NULL AND excerpt IS NULL
// and prints UPDATE statements to apply with `wrangler d1 execute --file`.
//   bun scripts/backfill-post-meta.ts rows.json > backfill.sql
import { postMeta } from '../src/lib/post-meta';

const [file] = process.argv.slice(2);
const parsed = JSON.parse(await Bun.file(file!).text()) as { results: { id: string; content_html: string }[] }[];
const q = (v: string | null) => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);
for (const row of parsed[0]!.results) {
  const { coverUrl, excerpt } = postMeta(row.content_html);
  console.log(`UPDATE posts SET cover_url = ${q(coverUrl)}, excerpt = ${q(excerpt)} WHERE id = ${q(row.id)};`);
}
