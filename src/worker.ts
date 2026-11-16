// Worker entrypoint: Astro serves HTTP; the queue handler drains campaign
// emails; the daily cron releases custom hostnames nobody is paying for.
import { handle } from '@astrojs/cloudflare/handler';
import { consumeEmailBatch, type EmailJob } from './lib/email-queue';
import { sweepCustomHostnames } from './lib/custom-hostnames';

export default {
  fetch: handle,
  async queue(batch, env) {
    await consumeEmailBatch(batch as MessageBatch<EmailJob>, env);
  },
  // Daily: release unfinished or no-longer-Pro custom hostnames (billing guard).
  async scheduled(_controller, _env, ctx) {
    ctx.waitUntil(sweepCustomHostnames().then((n) => n && console.log(`released ${n} custom hostname(s)`)));
  },
} satisfies ExportedHandler<Env, EmailJob>;
