import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { mediaPrefixes } from "../../../lib/tenant";
import { getDbInstance, campaigns, mediaObjects, posts } from "../../../db";

const extractOwnedMediaKeys = (
  md: string,
  base: string,
  prefix: string,
): string[] => {
  if (!base || !prefix) return [];
  const escapedBase = base.replace(/[/.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `${escapedBase}/(${prefix.replace(/[/.*+?^${}()|[\]\\]/g, "\\$&")}/[A-Za-z0-9._/-]+)`,
    "g",
  );
  const keys = new Set<string>();
  for (const m of md.matchAll(re)) keys.add(m[1]);
  return Array.from(keys);
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const publicationId = locals.publication.id;
  const id = params.id;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const db = getDbInstance();
  const [post] = await db
    .select({ id: posts.id, contentMd: posts.contentMd })
    .from(posts)
    .where(and(eq(posts.id, id), eq(posts.publicationId, publicationId)))
    .limit(1);
  if (!post) return Response.json({ error: "not found" }, { status: 404 });

  // Best-effort R2 cleanup — never block post deletion on storage errors.
  const e = env as unknown as {
    MEDIA?: R2Bucket;
    MEDIA_PUBLIC_BASE?: string;
  };
  const base = (e.MEDIA_PUBLIC_BASE ?? "").replace(/\/$/, "");
  const keys = mediaPrefixes(locals.publication).flatMap((prefix) =>
    extractOwnedMediaKeys(post.contentMd, base, prefix),
  );
  if (e.MEDIA && keys.length > 0) {
    await Promise.allSettled(keys.map((k) => e.MEDIA!.delete(k)));
    for (const key of keys) await db.delete(mediaObjects).where(eq(mediaObjects.key, key));
  }

  // Drop campaigns first to satisfy the FK; then the post itself.
  await db.delete(campaigns).where(eq(campaigns.postId, id));
  await db.delete(posts).where(and(eq(posts.id, id), eq(posts.publicationId, publicationId)));
  return Response.json({ ok: true, mediaDeleted: keys.length });
};
