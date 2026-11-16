import type { APIRoute } from 'astro';
import { endSession } from '../../lib/auth';

export const POST: APIRoute = async ({ cookies, url, redirect }) => {
  await endSession(cookies, url.protocol === 'https:');
  return redirect('/signin', 303);
};
