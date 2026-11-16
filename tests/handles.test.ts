import { expect, test } from 'bun:test';
import { checkHandle, suggestHandle } from '../src/lib/handles';

test('accepts valid handles', () => {
  for (const h of ['abc', 'field-notes', 'rubrion', 'a1b2', 'x'.repeat(30)]) expect(checkHandle(h).ok).toBe(true);
  expect(checkHandle('  Field-Notes ')).toEqual({ ok: true, handle: 'field-notes' });
});

test('rejects malformed and reserved handles', () => {
  for (const h of ['ab', '-abc', 'abc-', 'a_b', 'a.b', 'x'.repeat(31), 'a--b', 'www', 'app', 'admin', 'mail', 'customers'])
    expect(checkHandle(h).ok).toBe(false);
});

test('suggests handles from names', () => {
  expect(suggestHandle('Field Notes!')).toBe('field-notes');
  expect(suggestHandle('Crônicas da Borda')).toBe('cronicas-da-borda');
});
