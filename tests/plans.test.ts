import { expect, mock, test } from 'bun:test';

mock.module('cloudflare:workers', () => ({ env: {} }));
const { limitsFor, PLAN_LIMITS, PROBATION_AI_TOKENS_PER_DAY } = await import('../src/lib/plans');

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 10, 16);

test('free probation lowers email and AI budgets', () => {
  const l = limitsFor({ plan: 'free', createdAt: new Date(now - DAY) }, now);
  expect(l.probation).toBe(true);
  expect(l.aiTokensPerDay).toBe(PROBATION_AI_TOKENS_PER_DAY);
});

test('free after probation and pro get full AI budgets', () => {
  expect(limitsFor({ plan: 'free', createdAt: new Date(now - 8 * DAY) }, now).aiTokensPerDay).toBe(PLAN_LIMITS.free.aiTokensPerDay);
  expect(limitsFor({ plan: 'pro', createdAt: new Date(now - DAY) }, now).aiTokensPerDay).toBe(PLAN_LIMITS.pro.aiTokensPerDay);
});
