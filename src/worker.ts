// Worker entrypoint: Astro serves HTTP; the queue handler drains campaign emails.
import { handle } from '@astrojs/cloudflare/handler';
import { consumeEmailBatch, type EmailJob } from './lib/email-queue';

export default {
  fetch: handle,
  async queue(batch, env) {
    await consumeEmailBatch(batch as MessageBatch<EmailJob>, env);
  },
} satisfies ExportedHandler<Env, EmailJob>;
