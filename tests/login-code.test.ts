import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { expect, mock, test } from 'bun:test';
import * as schema from '../src/db/schema';

// consumeLoginCode against a real SQLite login_tokens table (D1 is SQLite).
const sqlite = new Database(':memory:');
sqlite.run(`CREATE TABLE login_tokens (
  id text PRIMARY KEY NOT NULL, email text NOT NULL, purpose text DEFAULT 'login' NOT NULL,
  publication_id text, role text, expires_at integer NOT NULL, used_at integer,
  code_hash text, attempts integer DEFAULT 0 NOT NULL, created_at integer NOT NULL)`);
const db = drizzle(sqlite, { schema });

mock.module('cloudflare:workers', () => ({ env: {} }));
mock.module('../src/db', () => ({ ...schema, getDbInstance: () => db }));
const { CODE_MAX_ATTEMPTS, consumeLoginCode, isReviewLogin, issueSignIn, randomCode } = await import('../src/lib/auth');

const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

test('random codes are six digits', () => {
  for (let i = 0; i < 200; i++) expect(randomCode()).toMatch(/^\d{6}$/);
});

test('a code signs in once', async () => {
  const { code } = await issueSignIn('Writer@Example.com');
  expect(await consumeLoginCode('writer@example.com', code)).not.toBeNull();
  expect(await consumeLoginCode('writer@example.com', code)).toBeNull();
});

test('wrong codes burn the token after the attempt limit', async () => {
  const { code } = await issueSignIn('guess@example.com');
  for (let i = 0; i < CODE_MAX_ATTEMPTS; i++) expect(await consumeLoginCode('guess@example.com', wrong(code))).toBeNull();
  expect(await consumeLoginCode('guess@example.com', code)).toBeNull();
});

test('codes are bound to their email and must be well-formed', async () => {
  const { code } = await issueSignIn('a@example.com');
  expect(await consumeLoginCode('b@example.com', code)).toBeNull();
  expect(await consumeLoginCode('a@example.com', 'abc123')).toBeNull();
  expect(await consumeLoginCode('a@example.com', code)).not.toBeNull();
});

test('review login needs both secrets and an exact match', () => {
  const env = { REVIEW_EMAIL: 'Review@EdgeLetter.blog', REVIEW_CODE: '4242424242' };
  expect(isReviewLogin(env, 'review@edgeletter.blog', '4242424242')).toBe(true);
  expect(isReviewLogin(env, 'review@edgeletter.blog', '4242424243')).toBe(false);
  expect(isReviewLogin(env, 'other@edgeletter.blog', '4242424242')).toBe(false);
  expect(isReviewLogin({ REVIEW_EMAIL: 'review@edgeletter.blog' }, 'review@edgeletter.blog', '')).toBe(false);
});
