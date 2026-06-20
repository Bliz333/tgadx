var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/ai.ts
var SYSTEM_PROMPT = `\u4F60\u662F\u4E00\u4E2A Telegram \u79C1\u804A\u53CD\u5783\u573E\u95E8\u536B\u3002\u6709\u964C\u751F\u4EBA\u7B2C\u4E00\u6B21\u79C1\u804A"\u673A\u5668\u4EBA\u4E3B\u4EBA"\uFF0C\u4F60\u8981\u5224\u65AD\u8FD9\u6761\u6D88\u606F\u662F\u4E0D\u662F\u5783\u573E/\u5E7F\u544A\uFF08\u6D88\u606F\u5185\u5BB9\u53EF\u80FD\u542B\u6B63\u6587\u3001\u9690\u85CF\u7684\u94FE\u63A5/@\u63D0\u53CA\u3001\u4EE5\u53CA\u662F\u5426\u4E3A\u8F6C\u53D1\u7684\u6807\u6CE8\uFF09\u3002
\u6838\u5FC3\u5224\u65AD\uFF1A\u8FD9\u4E2A\u4EBA\u662F\u60F3\u5411\u4E3B\u4EBA\u3010\u63A8\u9500 / \u63A8\u5E7F / \u5F15\u6D41 / \u62DB\u63FD\u751F\u610F\u3011\uFF0C\u8FD8\u662F\u3010\u771F\u7684\u6709\u5177\u4F53\u7684\u4E8B\u627E\u4E3B\u4EBA\u672C\u4EBA\u3011\uFF1F
\u5224\u4E3A\u5783\u573E(is_spam=true)\uFF1A
- \u63A8\u9500\u6216\u51FA\u552E\u4EFB\u4F55\u4E1C\u897F\uFF1A\u8F6F\u4EF6\u3001\u811A\u672C\u3001\u5916\u6302\u3001\u7FA4\u53D1/\u5F15\u6D41/\u91C7\u96C6/\u517B\u53F7\u5DE5\u5177\u3001\u8D26\u53F7/\u534F\u8BAE\u53F7/\u5361\u3001API\u3001\u670D\u52A1\u3001\u8BFE\u7A0B\u3001\u6D41\u91CF\u3001\u5E7F\u544A\u4F4D\u3001\u8D37\u6B3E\u3001\u535A\u5F69\u83E0\u83DC\u3001\u5237\u5355\u8FD4\u5229\u3001\u4EE3\u7406\u52A0\u76DF\u3001\u62DB\u5546\u3001\u63A5\u5355\u3001\u865A\u62DF\u5E01/USDT \u7B49
- \u5F15\u6D41\u5230\u5176\u4ED6\u673A\u5668\u4EBA/\u7FA4/\u9891\u9053/\u7F51\u7AD9\uFF08t.me \u94FE\u63A5\u3001?start= \u63A8\u5E7F\u7801\u3001\u52A0\u7FA4\u3001\u52A0\u5FAE\u4FE1\u3001\u70B9\u51FB\u9886\u53D6\uFF09
- \u660E\u663E\u7684\u8425\u9500\u8BDD\u672F\u6216\u5356\u70B9\u5439\u5618\uFF08\u5982"\u4E3B\u6253\u7A33\u5B9A""\u4E0D\u5356\u6982\u5FF5\u53EA\u5356\u5DE5\u5177""\u7A33\u5B9A\u4E0D\u6389\u7EBF""\u65E5\u7ED3""\u957F\u671F\u62DB""\u6709\u9700\u8981\u8054\u7CFB\u6211"\uFF09
\u5224\u4E3A\u6B63\u5E38(is_spam=false)\uFF1A
- \u771F\u7684\u6765\u627E\u4E3B\u4EBA\u529E\u5177\u4F53\u7684\u4E8B\u3001\u54A8\u8BE2\u4E3B\u4EBA\u63D0\u4F9B\u7684\u4E1C\u897F\u3001\u670B\u53CB\u4ECB\u7ECD\u3001\u666E\u901A\u95EE\u5019\u3001\u6CA1\u6709\u63A8\u9500\u610F\u56FE\u7684\u81EA\u6211\u4ECB\u7ECD
\u62FF\u4E0D\u51C6\u3001\u6216\u50CF\u8425\u9500/\u63A8\u9500 \u2192 \u5224 is_spam=true\uFF08\u5B81\u53EF\u62E6\u9519\uFF0C\u4E3B\u4EBA\u53EF\u624B\u52A8 /allow \u653E\u884C\uFF09\u3002
\u53EA\u8F93\u51FA\u4E00\u4E2A JSON \u5BF9\u8C61\uFF0C\u4E0D\u8981\u4EFB\u4F55\u591A\u4F59\u6587\u5B57\uFF1A
{"is_spam": true \u6216 false, "confidence": 0\u52301\u7684\u5C0F\u6570, "reason": "\u7B80\u77ED\u4E2D\u6587\u7406\u7531"}`;
async function classify(env, text) {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    return { isSpam: false, confidence: 0, reason: "\u65E0\u6587\u672C\u5185\u5BB9\uFF0C\u9ED8\u8BA4\u653E\u884C" };
  }
  try {
    const res = await fetch(env.AI_BASE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.AI_API_KEY}`
      },
      body: JSON.stringify({
        model: env.AI_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: trimmed.slice(0, 2e3) }
        ],
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
        // 关闭思考：分类任务更快更省（deepseek-v4-flash 支持）
        temperature: 0,
        max_tokens: 512
      })
    });
    if (!res.ok) {
      console.error("AI \u8BF7\u6C42\u5931\u8D25", res.status, await res.text());
      return { isSpam: false, confidence: 0, reason: "AI \u8BF7\u6C42\u5931\u8D25\uFF0C\u9ED8\u8BA4\u653E\u884C" };
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(content);
    return {
      isSpam: Boolean(parsed.is_spam),
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      reason: String(parsed.reason ?? "")
    };
  } catch (e) {
    console.error("AI \u5224\u5B9A\u5F02\u5E38", e);
    return { isSpam: false, confidence: 0, reason: "AI \u5F02\u5E38\uFF0C\u9ED8\u8BA4\u653E\u884C" };
  }
}
__name(classify, "classify");

// src/store.ts
function getUser(env, userId) {
  return env.STATE.get(`user:${userId}`, "json");
}
__name(getUser, "getUser");
async function setUser(env, userId, rec) {
  await env.STATE.put(`user:${userId}`, JSON.stringify(rec));
}
__name(setUser, "setUser");
async function deleteUser(env, userId) {
  await env.STATE.delete(`user:${userId}`);
}
__name(deleteUser, "deleteUser");
async function listUsers(env) {
  const out = [];
  let cursor;
  do {
    const res = await env.STATE.list({ prefix: "user:", cursor });
    for (const k of res.keys) {
      const rec = await env.STATE.get(k.name, "json");
      if (rec)
        out.push({ userId: Number(k.name.slice("user:".length)), rec });
    }
    cursor = res.list_complete ? void 0 : res.cursor;
  } while (cursor);
  return out;
}
__name(listUsers, "listUsers");
async function getUserIdByTopic(env, topicId) {
  const v = await env.STATE.get(`topic:${topicId}`);
  return v ? Number(v) : null;
}
__name(getUserIdByTopic, "getUserIdByTopic");
async function setTopicMap(env, topicId, userId) {
  await env.STATE.put(`topic:${topicId}`, String(userId));
}
__name(setTopicMap, "setTopicMap");
async function deleteTopicMap(env, topicId) {
  await env.STATE.delete(`topic:${topicId}`);
}
__name(deleteTopicMap, "deleteTopicMap");
async function getSpamTopicId(env) {
  const v = await env.STATE.get("meta:spamTopic");
  return v ? Number(v) : null;
}
__name(getSpamTopicId, "getSpamTopicId");
async function setSpamTopicId(env, topicId) {
  await env.STATE.put("meta:spamTopic", String(topicId));
}
__name(setSpamTopicId, "setSpamTopicId");
async function clearSpamTopicId(env) {
  await env.STATE.delete("meta:spamTopic");
}
__name(clearSpamTopicId, "clearSpamTopicId");

// src/telegram.ts
async function call(env, method, params) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params)
  });
  const data = await res.json();
  if (!data || !data.ok) {
    throw new Error(`Telegram ${method} \u5931\u8D25: ${data?.error_code} ${data?.description}`);
  }
  return data.result;
}
__name(call, "call");
function sendMessage(env, chatId, text, extra = {}) {
  return call(env, "sendMessage", { chat_id: chatId, text, ...extra });
}
__name(sendMessage, "sendMessage");
function copyMessage(env, chatId, fromChatId, messageId, extra = {}) {
  return call(env, "copyMessage", {
    chat_id: chatId,
    from_chat_id: fromChatId,
    message_id: messageId,
    ...extra
  });
}
__name(copyMessage, "copyMessage");
async function createForumTopic(env, chatId, name) {
  const result = await call(env, "createForumTopic", { chat_id: chatId, name });
  return result.message_thread_id;
}
__name(createForumTopic, "createForumTopic");
function deleteForumTopic(env, chatId, topicId) {
  return call(env, "deleteForumTopic", { chat_id: chatId, message_thread_id: topicId });
}
__name(deleteForumTopic, "deleteForumTopic");

// src/handlers.ts
function displayName(msg) {
  const u = msg.from;
  if (!u)
    return "Unknown";
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return name || u.username || String(u.id);
}
__name(displayName, "displayName");
function isServiceMessage(msg) {
  return Boolean(
    msg.forum_topic_created || msg.forum_topic_closed || msg.forum_topic_edited || msg.forum_topic_reopened
  );
}
__name(isServiceMessage, "isServiceMessage");
function extractContent(msg) {
  const parts = [];
  if (msg.text)
    parts.push(msg.text);
  if (msg.caption)
    parts.push(msg.caption);
  const baseText = msg.text || msg.caption || "";
  const ents = [...msg.entities || [], ...msg.caption_entities || []];
  const links = [];
  for (const e of ents) {
    if (e.type === "text_link" && e.url)
      links.push(e.url);
    else if (e.type === "url" || e.type === "mention")
      links.push(baseText.slice(e.offset, e.offset + e.length));
  }
  if (links.length)
    parts.push("\u6D88\u606F\u4E2D\u7684\u94FE\u63A5/\u63D0\u53CA: " + links.join(" "));
  if (msg.forward_origin || msg.forward_from || msg.forward_from_chat || msg.forward_sender_name) {
    parts.push("[\u8FD9\u662F\u4E00\u6761\u8F6C\u53D1\u6D88\u606F]");
  }
  return parts.join("\n").trim();
}
__name(extractContent, "extractContent");
var SIX_HOURS = 6 * 3600 * 1e3;
function looksObviouslySpam(text) {
  const t = text || "";
  if (/t\.me\/[a-z0-9_]*bot\b/i.test(t))
    return true;
  if (/[?&]start=/i.test(t))
    return true;
  return false;
}
__name(looksObviouslySpam, "looksObviouslySpam");
async function handleUpdate(update, env) {
  const msg = update.message;
  if (!msg || !msg.from || msg.from.is_bot)
    return;
  if (isServiceMessage(msg))
    return;
  const adminGroupId = Number(env.ADMIN_GROUP_ID);
  const adminUserId = Number(env.ADMIN_USER_ID);
  if (msg.chat.id === adminGroupId) {
    await handleAdminGroup(env, msg);
    return;
  }
  if (msg.chat.type === "private") {
    if (msg.from.id === adminUserId)
      return;
    await handleInbound(env, msg);
  }
}
__name(handleUpdate, "handleUpdate");
async function handleAdminGroup(env, msg) {
  if (Number(msg.from?.id) !== Number(env.ADMIN_USER_ID))
    return;
  const topicId = msg.message_thread_id;
  const text = msg.text?.trim() ?? "";
  const reply = topicId ? { message_thread_id: topicId } : {};
  if (text.startsWith("/allow")) {
    const id = Number(text.split(/\s+/)[1]);
    if (!id)
      return void await sendMessage(env, env.ADMIN_GROUP_ID, "\u7528\u6CD5\uFF1A/allow <\u7528\u6237ID>", reply);
    await allowUser(env, id);
    return;
  }
  if (text.startsWith("/reset")) {
    const id = Number(text.split(/\s+/)[1]);
    if (!id)
      return void await sendMessage(env, env.ADMIN_GROUP_ID, "\u7528\u6CD5\uFF1A/reset <\u7528\u6237ID>", reply);
    const r = await getUser(env, id);
    if (r)
      await deleteTopicMap(env, r.topicId);
    await deleteUser(env, id);
    await sendMessage(env, env.ADMIN_GROUP_ID, `\u267B\uFE0F \u5DF2\u91CD\u7F6E\u7528\u6237 ${id}\uFF0C\u5176\u4E0B\u4E00\u6761\u6D88\u606F\u4F1A\u88AB\u5F53\u4F5C\u65B0\u7528\u6237\u91CD\u65B0 AI \u5224\u5B9A\u3002`, reply);
    return;
  }
  if (text.startsWith("/cleannow")) {
    const n = await runCleanup(env);
    await sendMessage(env, env.ADMIN_GROUP_ID, `\u{1F9F9} \u6E05\u7406\u5B8C\u6210\uFF0C\u5220\u9664\u4E86 ${n} \u9879\u8FC7\u671F\u8BB0\u5F55\u3002`, reply);
    return;
  }
  if (text === "/del") {
    if (!topicId)
      return void await sendMessage(env, env.ADMIN_GROUP_ID, "\u8BF7\u5728\u8981\u5220\u9664\u7684\u8BDD\u9898\u91CC\u53D1\u9001 /del\u3002");
    const spamTopicId2 = await getSpamTopicId(env);
    const userId2 = await getUserIdByTopic(env, topicId);
    try {
      await deleteForumTopic(env, env.ADMIN_GROUP_ID, topicId);
    } catch (e) {
      console.error("\u5220\u9664\u8BDD\u9898\u5931\u8D25", e);
    }
    if (userId2) {
      await deleteTopicMap(env, topicId);
      await deleteUser(env, userId2);
    }
    if (spamTopicId2 && topicId === spamTopicId2)
      await clearSpamTopicId(env);
    return;
  }
  if (!topicId)
    return;
  const spamTopicId = await getSpamTopicId(env);
  if (spamTopicId && topicId === spamTopicId)
    return;
  const userId = await getUserIdByTopic(env, topicId);
  if (!userId)
    return;
  if (text === "/ban" || text === "/unban") {
    const rec2 = await getUser(env, userId);
    if (rec2) {
      rec2.status = text === "/ban" ? "blocked" : "trusted";
      await setUser(env, userId, rec2);
      await sendMessage(env, env.ADMIN_GROUP_ID, text === "/ban" ? "\u5DF2\u5C4F\u853D\u8BE5\u7528\u6237\u3002" : "\u5DF2\u89E3\u9664\u5C4F\u853D\u5E76\u4FE1\u4EFB\u3002", reply);
    }
    return;
  }
  const rec = await getUser(env, userId);
  if (rec && rec.status === "pending") {
    rec.status = "trusted";
    await setUser(env, userId, rec);
  }
  try {
    await copyMessage(env, userId, env.ADMIN_GROUP_ID, msg.message_id);
  } catch (e) {
    console.error("\u8F6C\u53D1\u7ED9\u7528\u6237\u5931\u8D25", e);
    await sendMessage(env, env.ADMIN_GROUP_ID, "\u26A0\uFE0F \u8F6C\u53D1\u7ED9\u7528\u6237\u5931\u8D25\uFF08\u5BF9\u65B9\u53EF\u80FD\u5DF2\u505C\u7528 bot\uFF09\u3002", reply);
  }
}
__name(handleAdminGroup, "handleAdminGroup");
async function allowUser(env, userId) {
  const rec = await getUser(env, userId);
  if (rec?.status === "trusted") {
    await sendMessage(env, env.ADMIN_GROUP_ID, `\u7528\u6237 ${userId} \u5DF2\u662F\u653E\u884C\u72B6\u6001\u3002`, { message_thread_id: rec.topicId });
    return;
  }
  let topicId = rec?.topicId;
  if (!topicId) {
    topicId = await createForumTopic(env, env.ADMIN_GROUP_ID, `${rec?.name || "\u653E\u884C\u7528\u6237"} #${userId}`.slice(0, 128));
    await setTopicMap(env, topicId, userId);
  }
  await setUser(env, userId, {
    topicId,
    status: "trusted",
    name: rec?.name || String(userId),
    firstSeen: rec?.firstSeen || Date.now(),
    lastSeen: Date.now()
  });
  await sendMessage(env, env.ADMIN_GROUP_ID, `\u2705 \u5DF2\u653E\u884C\u7528\u6237 ${userId}\uFF0C\u5176\u540E\u7EED\u6D88\u606F\u4F1A\u8FDB\u5165\u672C\u8BDD\u9898\uFF0C\u4F60\u53EF\u5728\u6B64\u76F4\u63A5\u56DE\u590D\u3002`, {
    message_thread_id: topicId
  });
}
__name(allowUser, "allowUser");
async function handleInbound(env, msg) {
  const userId = msg.from.id;
  const rec = await getUser(env, userId);
  const now = Date.now();
  if (rec?.status === "blocked")
    return;
  if (rec?.status === "trusted") {
    if (now - (rec.lastSeen || 0) > SIX_HOURS) {
      rec.lastSeen = now;
      await setUser(env, userId, rec);
    }
    await relayToTopic(env, msg, rec.topicId, userId);
    return;
  }
  const content = extractContent(msg);
  const verdict = looksObviouslySpam(content) ? { isSpam: true, confidence: 1, reason: "\u547D\u4E2D\u660E\u663E\u5E7F\u544A\u7279\u5F81\uFF08bot \u5F15\u6D41/\u63A8\u5E7F\u7801\uFF09" } : await classify(env, content);
  console.log(`\u5165\u7AD9\u5224\u5B9A user=${userId} \u72B6\u6001=${rec ? "pending" : "new"} spam=${verdict.isSpam} \u7406\u7531=${verdict.reason}`);
  if (verdict.isSpam) {
    const willBlock = env.AUTO_BLOCK !== "0";
    await quarantine(env, msg, verdict.reason, willBlock);
    if (willBlock) {
      await setUser(env, userId, {
        topicId: rec?.topicId || 0,
        status: "blocked",
        name: displayName(msg),
        firstSeen: rec?.firstSeen || now,
        lastSeen: now
      });
    }
    return;
  }
  let topicId = rec?.topicId;
  if (!topicId) {
    const name = displayName(msg);
    topicId = await createForumTopic(env, env.ADMIN_GROUP_ID, `${name} #${userId}`.slice(0, 128));
    await setTopicMap(env, topicId, userId);
    const uname = msg.from.username ? `@${msg.from.username}` : "\uFF08\u65E0\u7528\u6237\u540D\uFF09";
    await sendMessage(
      env,
      env.ADMIN_GROUP_ID,
      `\u{1F195} \u65B0\u8054\u7CFB\u4EBA
\u59D3\u540D\uFF1A${name}
\u7528\u6237\u540D\uFF1A${uname}
ID\uFF1A${userId}
AI \u5224\u5B9A\uFF1A\u6B63\u5E38\uFF08${verdict.reason}\uFF09
\uFF08\u4F60\u5728\u672C\u8BDD\u9898\u56DE\u590D\u540E\uFF0C\u5BF9\u65B9\u540E\u7EED\u6D88\u606F\u5C06\u4E0D\u518D\u5224\u5B9A\uFF09`,
      { message_thread_id: topicId }
    );
    await setUser(env, userId, { topicId, status: "pending", name, firstSeen: now, lastSeen: now });
  } else if (now - (rec.lastSeen || 0) > SIX_HOURS) {
    rec.lastSeen = now;
    await setUser(env, userId, rec);
  }
  await relayToTopic(env, msg, topicId, userId);
}
__name(handleInbound, "handleInbound");
async function quarantine(env, msg, reason, blocked) {
  let topicId = await getSpamTopicId(env);
  if (!topicId) {
    topicId = await createForumTopic(env, env.ADMIN_GROUP_ID, "\u{1F6AB} \u5E7F\u544A\u62E6\u622A");
    await setSpamTopicId(env, topicId);
  }
  const name = displayName(msg);
  const uname = msg.from.username ? `@${msg.from.username}` : "\uFF08\u65E0\u7528\u6237\u540D\uFF09";
  const head = blocked ? "\u{1F6AB} \u62E6\u622A\u5E7F\u544A\uFF08\u5DF2\u81EA\u52A8\u62C9\u9ED1\uFF0C\u540E\u7EED\u6D88\u606F\u5C06\u88AB\u5FFD\u7565\uFF09" : "\u{1F6AB} \u62E6\u622A\u5E7F\u544A";
  await sendMessage(
    env,
    env.ADMIN_GROUP_ID,
    `${head}
\u6765\u81EA\uFF1A${name} ${uname}
ID\uFF1A${msg.from.id}
\u7406\u7531\uFF1A${reason}
\u8BEF\u5224\uFF1F\u53D1 /allow ${msg.from.id} \u653E\u884C`,
    { message_thread_id: topicId }
  );
  try {
    await copyMessage(env, env.ADMIN_GROUP_ID, msg.chat.id, msg.message_id, { message_thread_id: topicId });
  } catch (e) {
    console.error("\u8F6C\u53D1\u5230\u5E7F\u544A\u8BDD\u9898\u5931\u8D25", e);
  }
}
__name(quarantine, "quarantine");
async function relayToTopic(env, msg, topicId, userId) {
  try {
    await copyMessage(env, env.ADMIN_GROUP_ID, msg.chat.id, msg.message_id, { message_thread_id: topicId });
  } catch (e) {
    const desc = String(e?.message || "");
    if (desc.includes("thread not found") || desc.includes("TOPIC_DELETED") || desc.includes("topic")) {
      console.log(`\u8BDD\u9898 ${topicId} \u5DF2\u4E0D\u5B58\u5728\uFF0C\u81EA\u6108\uFF1A\u6E05\u9664\u7528\u6237 ${userId} \u8BB0\u5F55\uFF0C\u4E0B\u6761\u6D88\u606F\u5C06\u91CD\u5EFA\u8BDD\u9898`);
      await deleteTopicMap(env, topicId);
      await deleteUser(env, userId);
    } else {
      console.error("\u8F6C\u53D1\u5230\u8BDD\u9898\u5931\u8D25", e);
    }
  }
}
__name(relayToTopic, "relayToTopic");
async function runCleanup(env) {
  const now = Date.now();
  const days = Number(env.CLEANUP_DAYS || "0");
  const pendingCutoff = days > 0 ? now - days * 864e5 : null;
  const blockedCutoff = now - 90 * 864e5;
  const users = await listUsers(env);
  let n = 0;
  for (const { userId, rec } of users) {
    const last = rec.lastSeen || rec.firstSeen;
    if (rec.status === "pending" && pendingCutoff !== null && last < pendingCutoff) {
      try {
        await deleteForumTopic(env, env.ADMIN_GROUP_ID, rec.topicId);
      } catch (e) {
        console.error("\u5220\u9664\u8BDD\u9898\u5931\u8D25", e);
      }
      await deleteTopicMap(env, rec.topicId);
      await deleteUser(env, userId);
      n++;
    } else if (rec.status === "blocked" && last < blockedCutoff) {
      if (rec.topicId) {
        try {
          await deleteForumTopic(env, env.ADMIN_GROUP_ID, rec.topicId);
        } catch {
        }
        await deleteTopicMap(env, rec.topicId);
      }
      await deleteUser(env, userId);
      n++;
    }
  }
  console.log(`\u6E05\u7406\uFF1A\u5220\u9664 ${n} \u9879\u8FC7\u671F\u8BB0\u5F55\uFF08pending \u9608\u503C ${days} \u5929 / blocked 90 \u5929\uFF09`);
  return n;
}
__name(runCleanup, "runCleanup");

// src/index.ts
var src_default = {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("ok", { status: 200 });
    }
    const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }
    let update;
    try {
      update = await request.json();
    } catch {
      return new Response("bad request", { status: 200 });
    }
    try {
      await handleUpdate(update, env);
    } catch (e) {
      console.error("handleUpdate error", e);
    }
    return new Response("ok", { status: 200 });
  },
  // Cron 定时触发：每天自动清理未回复过的过期话题（在 wrangler.toml [triggers] 配置）
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runCleanup(env));
  }
};
export {
  src_default as default
};
//# sourceMappingURL=index.js.map
