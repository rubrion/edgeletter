import { expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';

const mod = await import('../src/lib/stripe-verify');

const sign = (body: string, t: number, secret: string) =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

test('accepts a valid signature', async () => {
  const now = 1_800_000_000;
  expect(await mod.verifyStripeSignature('{"a":1}', sign('{"a":1}', now, 'whsec_x'), 'whsec_x', 300, now)).toBe(true);
});

test('rejects tampered body, wrong secret, stale timestamp, missing header', async () => {
  const now = 1_800_000_000;
  const h = sign('{"a":1}', now, 'whsec_x');
  expect(await mod.verifyStripeSignature('{"a":2}', h, 'whsec_x', 300, now)).toBe(false);
  expect(await mod.verifyStripeSignature('{"a":1}', h, 'whsec_y', 300, now)).toBe(false);
  expect(await mod.verifyStripeSignature('{"a":1}', h, 'whsec_x', 300, now + 3600)).toBe(false);
  expect(await mod.verifyStripeSignature('{"a":1}', null, 'whsec_x', 300, now)).toBe(false);
});
