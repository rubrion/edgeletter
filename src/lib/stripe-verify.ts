// Kept free of Workers-only imports so it can be unit tested under Bun.

/**
 * Verify a Stripe-Signature header: t=<ts>,v1=<hex hmac of "<ts>.<body>">.
 * Rejects stale timestamps to block replays.
 */
export const verifyStripeSignature = async (
  body: string,
  header: string | null,
  secret: string,
  toleranceS = 300,
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> => {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(t) || Math.abs(now - t) > toleranceS || sigs.length === 0) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  // Constant-time compare against each candidate signature.
  return sigs.some((sig) => {
    if (sig.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  });
};
