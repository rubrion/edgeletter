import { expect, test } from 'bun:test';
import { inStoreApp } from '../src/lib/native';

const req = (ua?: string) => new Request('https://app.edgeletter.blog/', { headers: ua ? { 'user-agent': ua } : {} });

test('detects the store app user-agent token', () => {
  expect(inStoreApp(req('Mozilla/5.0 (Linux; Android 15; wv) Chrome/140.0 Mobile Safari/537.36 EdgeLetterApp'))).toBe(true);
});

test('plain browsers and look-alikes are not the app', () => {
  expect(inStoreApp(req('Mozilla/5.0 (Linux; Android 15) Chrome/140.0 Mobile Safari/537.36'))).toBe(false);
  expect(inStoreApp(req('Mozilla/5.0 NotEdgeLetterAppX'))).toBe(false);
  expect(inStoreApp(req())).toBe(false);
});
