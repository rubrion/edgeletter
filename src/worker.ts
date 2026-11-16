// Worker entrypoint: Astro serves HTTP; the queue handler drains campaign
// emails; crons import writers' feeds (every 30 min) and release custom
// hostnames nobody is paying for (daily).
import { handle } from '@astrojs/cloudflare/handler';
import { consumeEmailBatch, type EmailJob } from './lib/email-queue';
import { sweepCustomHostnames } from './lib/custom-hostnames';
import { checkDueFeeds } from './lib/feeds';

export default {
  fetch: handle,
  async queue(batch, env) {
    await consumeEmailBatch(batch as MessageBatch<EmailJob>, env);
  },
  async scheduled(controller, env, ctx) {
    if (controller.cron === '*/30 * * * *') {
      // Import new items from writers' RSS/Atom feeds.
      ctx.waitUntil(checkDueFeeds(env).then((r) => r.checked && console.log(`feeds: checked ${r.checked}, imported ${r.imported}`)));
      return;
    }
    // Daily: release unfinished or no-longer-Pro custom hostnames (billing guard).
    ctx.waitUntil(sweepCustomHostnames().then((n) => n && console.log(`released ${n} custom hostname(s)`)));
  },
} satisfies ExportedHandler<Env, EmailJob>;
