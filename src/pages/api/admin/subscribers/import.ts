import type { APIRoute } from 'astro';
import { and, eq, inArray } from 'drizzle-orm';
import { emailSuppressions, getDbInstance, subscribers } from '../../../../db';
import { EMAIL_RE } from '../../../../lib/auth';
import { extractContacts, parseCsv } from '../../../../lib/csv';
import { limitsFor, subscriberCount } from '../../../../lib/plans';

const MAX_FILE = 2 * 1024 * 1024;
const back = (q: string) => `/admin/subscribers?${q}`;

/**
 * Bulk import. Imported people are added as active without a confirmation
 * email, so the writer must attest they consented. Suppressed addresses and
 * existing subscribers are skipped; the plan's list size caps the import.
 */
export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return redirect(back('error=' + encodeURIComponent('Choose a CSV file.')), 303);
  if (form?.get('consent') !== '1')
    return redirect(back('error=' + encodeURIComponent('Confirm that everyone on the list agreed to receive your emails.')), 303);
  if (file.size > MAX_FILE) return redirect(back('error=' + encodeURIComponent('File too large (max 2 MB).')), 303);

  const seen = new Set<string>();
  const contacts = extractContacts(parseCsv(await file.text())).filter((c) => {
    if (!EMAIL_RE.test(c.email) || seen.has(c.email)) return false;
    seen.add(c.email);
    return true;
  });
  if (contacts.length === 0) return redirect(back('error=' + encodeURIComponent('No email addresses found in that file.')), 303);

  const db = getDbInstance();
  const publicationId = locals.publication.id;
  const room = limitsFor(locals.publication).subscribers - (await subscriberCount(publicationId));

  // Filter out existing subscribers and suppressed addresses, 50 at a time (D1 parameter cap).
  const fresh: typeof contacts = [];
  for (let i = 0; i < contacts.length; i += 50) {
    const part = contacts.slice(i, i + 50);
    const emails = part.map((c) => c.email);
    const existing = await db
      .select({ email: subscribers.email })
      .from(subscribers)
      .where(and(eq(subscribers.publicationId, publicationId), inArray(subscribers.email, emails)));
    const suppressed = await db
      .select({ email: emailSuppressions.email })
      .from(emailSuppressions)
      .where(inArray(emailSuppressions.email, emails));
    const skip = new Set([...existing, ...suppressed].map((r) => r.email));
    fresh.push(...part.filter((c) => !skip.has(c.email)));
  }

  const accepted = fresh.slice(0, Math.max(0, room));
  const now = new Date();
  for (let i = 0; i < accepted.length; i += 12) {
    await db
      .insert(subscribers)
      .values(accepted.slice(i, i + 12).map((c) => ({ publicationId, email: c.email, lang: c.lang, status: 'active' as const, confirmedAt: now })))
      .onConflictDoNothing();
  }
  const skipped = contacts.length - accepted.length;
  const capped = fresh.length > accepted.length;
  return redirect(
    back(`imported=${accepted.length}&skipped=${skipped}${capped ? '&capped=1' : ''}`),
    303,
  );
};
