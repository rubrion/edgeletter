import { expect, test } from 'bun:test';
import { normalizePath, under } from '../src/lib/paths';

test('normalizes variants the router treats as the same route', () => {
  for (const p of ['/api/publish', '/api/publish/', '/api/publish/.', '/api//publish', '/API/Publish', '/api/x/../publish', '/api/%70ublish'])
    expect(normalizePath(p)).toBe('/api/publish');
  expect(normalizePath('/')).toBe('/');
  expect(normalizePath('/%E0%A4%A')).toBe('/%e0%a4%a'); // malformed escape: judged raw
});

test('under() matches whole segments only', () => {
  expect(under('/api/publish', '/api/publish')).toBe(true);
  expect(under('/api/publish/x', '/api/publish')).toBe(true);
  expect(under('/api/publishing', '/api/publish')).toBe(false);
});
