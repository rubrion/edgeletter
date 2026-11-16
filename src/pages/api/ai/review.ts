import type { APIRoute } from 'astro';
import { limitsFor } from '../../../lib/plans';
import { env } from 'cloudflare:workers';
import { adjustAiTokens, reserveAiTokens, utcDay } from '../../../lib/ai-budget';
import { allow } from '../../../lib/ratelimit';

const MAX_INPUT_CHARS = 50_000;
const MAX_OUTPUT_TOKENS = 8192;
const CHARS_PER_TOKEN = 3.5;
// Review is a rewrite — output length tracks input length. Add 30% headroom
// for expansion, plus a small fixed buffer for short posts.
const OUTPUT_OVERHEAD_RATIO = 1.3;
const OUTPUT_BUFFER_TOKENS = 256;
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const SYSTEM_PROMPT =
  'You are a professional newsletter editor. Improve the following newsletter post written in Markdown. ' +
  'Keep the same structure, topics, and meaning. Improve clarity, grammar, flow, and reader engagement. ' +
  'Preserve every image markdown ![alt](url), every <video>/<img>/<a> HTML tag, and every link verbatim — ' +
  'do not modify their URLs, attributes, alt text, or surrounding positions. ' +
  'Return ONLY the improved Markdown content — no preamble, no explanation, no code fences.';

type AiTextResponse = {
  response?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// The system prompt is sent with every call, so it counts toward the input.
const estimateInputTokens = (inputChars: number): number =>
  Math.ceil((inputChars + SYSTEM_PROMPT.length) / CHARS_PER_TOKEN);

const projectOutputTokens = (inputTokens: number): number =>
  Math.min(MAX_OUTPUT_TOKENS, Math.ceil(inputTokens * OUTPUT_OVERHEAD_RATIO) + OUTPUT_BUFFER_TOKENS);

export const POST: APIRoute = async ({ request, locals }) => {
  const publicationId = locals.publication.id;
  const limit = limitsFor(locals.publication).aiTokensPerDay;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'expected JSON body' }, 400);
  }

  const contentMd =
    body && typeof body === 'object' && 'contentMd' in body
      ? (body as { contentMd: unknown }).contentMd
      : undefined;

  if (typeof contentMd !== 'string' || !contentMd.trim()) {
    return json({ error: 'contentMd is required' }, 400);
  }
  if (contentMd.length > MAX_INPUT_CHARS) {
    return json(
      { error: `contentMd too large (${contentMd.length} > ${MAX_INPUT_CHARS} chars)` },
      413,
    );
  }

  // Per-user burst limit (shared limiter: 5 per minute).
  if (!(await allow(`ai:${locals.user?.id ?? publicationId}`))) {
    return json({ error: 'too many AI reviews — wait a minute', code: 'rate' }, 429);
  }

  const day = utcDay();
  const inputTokens = estimateInputTokens(contentMd.length);
  const projectedOutputTokens = projectOutputTokens(inputTokens);
  const projectedTotal = inputTokens + projectedOutputTokens;

  // Reserve the worst case up front; settle to actual usage afterwards.
  const reservation = await reserveAiTokens(publicationId, projectedTotal, limit, day);
  if (!reservation.ok) {
    return json(
      reservation.reason === 'platform'
        ? { error: 'AI review is paused for today — try again tomorrow', code: 'platform', used: reservation.used, limit }
        : {
            error: 'daily AI review token budget exhausted — try again tomorrow or shorten the post',
            code: 'budget',
            used: reservation.used,
            limit,
          },
      429,
    );
  }
  const usedToday = reservation.usedBefore;

  let result: AiTextResponse;
  try {
    result = (await env.AI.run(MODEL, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: contentMd },
      ],
      max_tokens: projectedOutputTokens,
    })) as AiTextResponse;
  } catch (err) {
    // Failed call: hand the reservation back.
    await adjustAiTokens(publicationId, -projectedTotal, day);
    return json({ error: err instanceof Error ? err.message : 'Workers AI error' }, 502);
  }

  const improved = result?.response;
  if (typeof improved !== 'string' || !improved.trim()) {
    return json({ error: 'empty response from model' }, 502);
  }

  const usage = result.usage;
  const actualTokens =
    usage?.total_tokens ??
    (usage?.prompt_tokens != null || usage?.completion_tokens != null
      ? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0)
      : projectedTotal);

  await adjustAiTokens(publicationId, actualTokens - projectedTotal, day);

  return json({ contentMd: improved.trim(), used: usedToday + actualTokens, limit });
};
