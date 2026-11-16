import type { APIRoute } from 'astro';
import { asc, eq } from 'drizzle-orm';
import { getDbInstance, subscribers } from '../../../../db';

// Neutralize spreadsheet formulas (=, +, -, @, tab, CR) before quoting.
const cell = (raw: string) => {
  const v = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n']/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

/** CSV of this publication's list: email, status, language, joined, confirmed. */
export const GET: APIRoute = async ({ locals }) => {
  const rows = await getDbInstance()
    .select()
    .from(subscribers)
    .where(eq(subscribers.publicationId, locals.publication.id))
    .orderBy(asc(subscribers.createdAt));
  const lines = ['email,status,lang,created_at,confirmed_at'].concat(
    rows.map((r) =>
      [r.email, r.status, r.lang, r.createdAt.toISOString(), r.confirmedAt?.toISOString() ?? ''].map(cell).join(','),
    ),
  );
  return new Response(lines.join('\n') + '\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${locals.publication.handle}-subscribers.csv"`,
      'Cache-Control': 'no-store',
    },
  });
};
