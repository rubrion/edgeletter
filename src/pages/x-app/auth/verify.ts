import type { APIRoute } from 'astro';
import { addMember, consumeLoginToken, findOrCreateUser, rememberPublication, startSession } from '../../../lib/auth';

const safeNext = (v: string | null): string => (v && /^\/(?!\/)[^\s]*$/.test(v) ? v : '/');

/** Magic-link landing: single-use token → session (and membership for invites). */
export const GET: APIRoute = async ({ url, cookies, redirect, request }) => {
  const token = url.searchParams.get('token') ?? '';
  const row = token ? await consumeLoginToken(token) : null;
  if (!row) return redirect('/signin?error=' + encodeURIComponent('That link is invalid or has expired. Request a new one.'), 302);

  const user = await findOrCreateUser(row.email);
  const secure = url.protocol === 'https:';
  await startSession(cookies, user.id, { secure, userAgent: request.headers.get('user-agent') });

  if (row.purpose === 'invite' && row.publicationId && row.role) {
    await addMember(user.id, row.publicationId, row.role);
    rememberPublication(cookies, row.publicationId, secure);
    return redirect('/admin', 302);
  }
  return redirect(safeNext(url.searchParams.get('next')), 302);
};
