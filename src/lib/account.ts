import { env } from 'cloudflare:workers';
import { and, eq, inArray, ne } from 'drizzle-orm';
import {
  aiUsage,
  campaigns,
  getDbInstance,
  loginTokens,
  memberships,
  posts,
  publications,
  settings,
  subscribers,
  users,
} from '../db';
import { releaseHostname } from './custom-hostnames';
import { platformFrom, sendMail } from './mailer';
import { cancelSubscription, stripeEnabled } from './stripe';
import { invalidatePublicationCache, mediaPrefixes } from './tenant';

/**
 * Account deletion (Google Play requires one, in the app and on the web).
 *
 * Publications the user owns alone go with the account: their Stripe
 * subscription is cancelled, custom hostname released, media removed from R2
 * and every row deleted. Publications with another owner stay; the user's
 * membership in them, sessions, OAuth links and login tokens cascade from the
 * users row.
 */

/** Publications where `userId` is an owner and no other owner exists. */
export const soleOwnedPublications = async (userId: string) => {
  const db = getDbInstance();
  const owned = await db
    .select({ id: publications.id })
    .from(memberships)
    .innerJoin(publications, eq(publications.id, memberships.publicationId))
    .where(and(eq(memberships.userId, userId), eq(memberships.role, 'owner')));
  if (!owned.length) return [];
  const ids = owned.map((p) => p.id);
  const coOwned = await db
    .select({ id: memberships.publicationId })
    .from(memberships)
    .where(and(inArray(memberships.publicationId, ids), eq(memberships.role, 'owner'), ne(memberships.userId, userId)));
  const keep = new Set(coOwned.map((m) => m.id));
  const gone = ids.filter((id) => !keep.has(id));
  if (!gone.length) return [];
  return db.select().from(publications).where(inArray(publications.id, gone));
};

const deleteMedia = async (prefixes: string[]): Promise<void> => {
  const bucket = (env as unknown as { MEDIA?: R2Bucket }).MEDIA;
  if (!bucket) return;
  for (const prefix of prefixes) {
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix: `${prefix}/`, cursor });
      if (page.objects.length) await bucket.delete(page.objects.map((o) => o.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
};

/**
 * Subscriptions Stripe refused to cancel (e.g. the restricted key lacks
 * Subscriptions write) still must stop billing: staff get an email to cancel
 * them by hand, so the deletion itself never fails on Stripe.
 */
const alertStaff = async (orphans: { subscription: string; customer: string | null; handle: string }[]) => {
  const staff = await getDbInstance().select({ email: users.email }).from(users).where(eq(users.isStaff, true));
  const lines = orphans.map((o) => `- ${o.subscription} (customer ${o.customer ?? '?'}, publication ${o.handle})`).join('\n');
  const text = `An account was deleted but these Stripe subscriptions could not be cancelled automatically. Cancel them in the Stripe Dashboard:\n\n${lines}\n\nTo make this automatic, give the Worker's restricted key Subscriptions: Write.`;
  for (const { email } of staff) {
    await sendMail({
      from: platformFrom('EdgeLetter', 'alerts'),
      to: email,
      subject: 'Action needed: cancel Stripe subscription of a deleted account',
      text,
      html: `<pre style="font:14px/1.5 monospace;white-space:pre-wrap">${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)}</pre>`,
    }).catch((err) => console.error('staff alert failed', err));
  }
};

export const deleteAccount = async (userId: string): Promise<void> => {
  const db = getDbInstance();
  const orphans: { subscription: string; customer: string | null; handle: string }[] = [];
  for (const pub of await soleOwnedPublications(userId)) {
    if (pub.stripeSubscriptionId && stripeEnabled()) {
      try {
        await cancelSubscription(pub.stripeSubscriptionId);
      } catch (err) {
        console.error('stripe cancel failed on account deletion', pub.stripeSubscriptionId, err);
        orphans.push({ subscription: pub.stripeSubscriptionId, customer: pub.stripeCustomerId, handle: pub.handle });
      }
    }
    if (pub.cfHostnameId || pub.customDomain || pub.pendingDomain) await releaseHostname(pub.id, pub.cfHostnameId);
    await deleteMedia(mediaPrefixes(pub));
    // Tables without ON DELETE CASCADE go first; the rest cascade from publications.
    await db.batch([
      db.delete(campaigns).where(eq(campaigns.publicationId, pub.id)),
      db.delete(posts).where(eq(posts.publicationId, pub.id)),
      db.delete(subscribers).where(eq(subscribers.publicationId, pub.id)),
      db.delete(settings).where(eq(settings.publicationId, pub.id)),
      db.delete(aiUsage).where(eq(aiUsage.publicationId, pub.id)),
      db.delete(publications).where(eq(publications.id, pub.id)),
    ]);
  }
  invalidatePublicationCache();
  if (orphans.length) await alertStaff(orphans);
  // Sessions, OAuth accounts and memberships cascade; login tokens are keyed by email.
  const [user] = await db.delete(users).where(eq(users.id, userId)).returning({ email: users.email });
  if (user) await db.delete(loginTokens).where(eq(loginTokens.email, user.email));
};
