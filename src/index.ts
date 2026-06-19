import type { Env, TgUpdate } from './types';
import { handleUpdate, runCleanup } from './handlers';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Telegram webhook 只会用 POST
    if (request.method !== 'POST') {
      return new Response('ok', { status: 200 });
    }

    // 校验 webhook secret（设 webhook 时通过 secret_token 传入）
    if (env.WEBHOOK_SECRET) {
      const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (secret !== env.WEBHOOK_SECRET) {
        return new Response('unauthorized', { status: 401 });
      }
    }

    let update: TgUpdate;
    try {
      update = (await request.json()) as TgUpdate;
    } catch {
      return new Response('bad request', { status: 200 });
    }

    try {
      await handleUpdate(update, env);
    } catch (e) {
      // 出错也回 200，避免 Telegram 反复重投造成风暴；错误进日志
      console.error('handleUpdate error', e);
    }

    return new Response('ok', { status: 200 });
  },

  // Cron 定时触发：每天自动清理未回复过的过期话题（在 wrangler.toml [triggers] 配置）
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCleanup(env));
  },
};
