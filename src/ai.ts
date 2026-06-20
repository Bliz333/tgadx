import type { Env } from './types';

export interface SpamVerdict {
  isSpam: boolean;
  confidence: number;
  reason: string;
}

const SYSTEM_PROMPT = `你是一个 Telegram 私聊反垃圾门卫。机器人主人运营一个【影视/资源点播·求片】服务：会有人来求片、催更、反馈资源问题，也会有广告号来推销引流。判断这条消息是不是垃圾/广告（消息内容可能含正文、隐藏的链接/@提及、以及是否为转发的标注）。

判为正常(is_spam=false)——只要没有明显的推销/引流意图，即使很短、很口语、看不太懂，也一律放行：
- 求片/找资源/问片名（如"公费 范进中举""求补全""海贼王搜不到""权欲是咋了"）
- 反馈资源问题（如"库里没有""显示已入库但搜不到""有缺集""第几集没更"）
- 普通咨询、问候、找主人办具体的事、朋友介绍、服务器/使用问题

判为垃圾(is_spam=true)——出现明显推销/引流/营销特征才判：
- 推销或出售东西：软件/脚本/外挂/群发引流采集养号工具、账号/协议号/卡、API、服务、课程、流量、广告位、贷款、博彩菠菜、刷单返利、代理加盟、招商接单、虚拟币/USDT/能量租赁、VPN 等
- 引流到其他机器人/群/频道/网站（t.me 链接、?start=、加群、加微信、点击领取、点击蓝色字体/蓝色机器人）
- 明显营销话术或卖点吹嘘（如"主打稳定""不卖概念只卖工具""稳定不掉线""日结""长期招""24小时自动""免费体验"）

判断依据是"有没有在卖东西/拉人引流"，不是"看不看得懂"。没有推销/引流特征就判正常。
只输出一个 JSON 对象，不要任何多余文字：
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
