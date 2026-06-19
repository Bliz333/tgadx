import type { Env } from './types';

export interface SpamVerdict {
  isSpam: boolean;
  confidence: number;
  reason: string;
}

const SYSTEM_PROMPT = `你是一个 Telegram 私聊反垃圾判定器。用户会发来某个陌生人私聊的消息内容（可能包含正文、消息里的链接、@提及、以及是否为转发的标注）。判断它是否属于垃圾消息。
判为垃圾(is_spam=true)的典型特征：
- 引流到其他 Telegram 机器人或群/频道（如 t.me/xxxbot、带 ?start= 推广码的链接、点击某蓝色机器人开始）
- 体育/博彩/彩票/棋牌/娱乐城、刷单返利、代开会员、贷款、色情、加密货币/USDT 套利、点击领取奖励
- 明显的营销推广、群发广告、客服引导话术
正常的问候、咨询、找人办事、自我介绍、日常聊天都不算垃圾。
只输出一个 JSON 对象，不要任何多余文字，格式：
{"is_spam": true 或 false, "confidence": 0到1的小数, "reason": "简短中文理由"}`;

// 调用 OpenAI 兼容接口判定是否广告；任何异常都默认放行，避免误杀正常人
export async function classify(env: Env, text: string): Promise<SpamVerdict> {
  const trimmed = (text || '').trim();
  if (!trimmed) {
    return { isSpam: false, confidence: 0, reason: '无文本内容，默认放行' };
  }

  try {
    const res = await fetch(env.AI_BASE_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.AI_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: trimmed.slice(0, 2000) },
        ],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' }, // 关闭思考：分类任务更快更省（deepseek-v4-flash 支持）
        temperature: 0,
        max_tokens: 512,
      }),
    });

    if (!res.ok) {
      console.error('AI 请求失败', res.status, await res.text());
      return { isSpam: false, confidence: 0, reason: 'AI 请求失败，默认放行' };
    }

    const data: any = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(content);
    return {
      isSpam: Boolean(parsed.is_spam),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      reason: String(parsed.reason ?? ''),
    };
  } catch (e) {
    console.error('AI 判定异常', e);
    return { isSpam: false, confidence: 0, reason: 'AI 异常，默认放行' };
  }
}
