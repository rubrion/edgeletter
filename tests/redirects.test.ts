import { expect, test } from 'bun:test';
import { safeNext } from '../src/lib/redirects';

const O = 'https://app.edgeletter.blog';
test('keeps same-origin paths', () => {
  expect(safeNext('/admin?pub=x', O)).toBe('/admin?pub=x');
  expect(safeNext('/', O)).toBe('/');
});
test('rejects off-site and malformed targets', () => {
  for (const v of ['//evil.com', '/\\evil.com', '/\\\\evil.com', 'https://evil.com', 'evil.com', '/%5Cevil.com\n', '/\tx', null, 42])
    expect(safeNext(v, O)).toBe('/');
});
