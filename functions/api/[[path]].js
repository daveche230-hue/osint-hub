import { auth, isOwner } from "../../lib/guard.js";
import { analyze, analyzeFile, HELP } from "../../lib/check.js";

const DAILY = 5;
const TTL = 600; /* ссылка на доску живёт 10 минут */
const ITEMS = {
  sledy: { type: "viz", title: "Следы: полная версия", desc: "Доска расследований: карточки, связи, 2D и 3D граф без ограничений.", price: 250, kv: "viz:sledy" },
  pack_20: { type: "pack", title: "20 запросов", desc: "Пакет из 20 запросов к инструментам.", requests: 20, price: 30 },
  pack_60: { type: "pack", title: "60 запросов", desc: "Пакет из 60 запросов к инструментам.", requests: 60, price: 80 },
  pack_200: { type: "pack", title: "200 запросов", desc: "Пакет из 200 запросов к инструментам.", requests: 200, price: 220 },
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

const page = (text, status) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#0a0c11;color:#8593a3;font:15px/1.5 system-ui;padding:60px 24px;text-align:center"><b style="color:#eef2f6;display:block;font-size:17px;margin-bottom:8px">Не открылось</b>${text}`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );

/* главная страница хаба не должна выдаваться за визуализатор */
const isHub = (s) => /<title>\s*OSINT Hub\s*<\/title>/i.test(String(s).slice(0, 4000));

/* ОТЛАДКА: скрипт-перехватчик ошибок. Вставляется сразу после <body>, до основного скрипта доски.
   Показывает красную плашку с текстом ошибки; если init не завершился за 5 с, убирает заставку.
   Когда причина найдена, поставь DEBUG_GUARD = false. */
const DEBUG_GUARD = true;
const GUARD = `<script>(function(){function show(t){var d=document.createElement('pre');d.style.cssText='position:fixed;z-index:2147483647;left:8px;right:8px;top:8px;margin:0;padding:8px;background:#300;color:#fbb;font:12px monospace;white-space:pre-wrap';d.textContent=t;(document.body||document.documentElement).appendChild(d)}
window.addEventListener('error',function(e){show((e.message||'error')+' @'+(e.lineno||'')+':'+(e.colno||''))});
window.addEventListener('unhandledrejection',function(e){show('promise: '+((e.reason&&e.reason.message)||e.reason))});
setTimeout(function(){var p=document.getElementById('splash');if(p){show('init не завершился за 5 с');p.remove()}},5000)})()<\/script>`;

async function tgApi(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.description || "telegram error");
  return j;
}

const today = () => new Date().toISOString().slice(0, 10);

async function getUser(env, id) {
  let u = await env.DB1.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  if (!u) {
    await env.DB1.prepare("INSERT OR IGNORE INTO users (id, credits) VALUES (?, 0)").bind(id).run();
    u = { id, credits: 0, day: "", owned: "{}", unlimited: 0 };
  }
  u.owned = JSON.parse(u.owned || "{}");
  return u;
}

const owns = (env, u, item) => isOwner(env, u.id) || !!u.owned[item];

function publicItems() {
  const o = {};
  for (const [k, v] of Object.entries(ITEMS)) o[k] = { type: v.type, title: v.title, price: v.price, requests: v.requests || 0 };
  return o;
}

function view(env, u) {
  const t = today();
  const claimable = u.day !== t;
  const next = Math.max(0, Math.floor((Date.parse(t + "T00:00:00Z") + 86400000 - Date.now()) / 1000));
  const owned = Object.keys(ITEMS).filter((k) => ITEMS[k].type === "viz" && owns(env, u, k));
  return { id: u.id, requests: u.credits, unlimited: !!u.unlimited, admin: isOwner(env, u.id), canClaim: claimable, nextClaimSec: claimable ? 0 : next, owned, daily: DAILY, items: publicItems() };
}

/* ---- выдача доски по короткой ссылке ---- */
async function vizOpen(url, env) {
  const t = url.searchParams.get("t");
  if (!t || !/^[a-f0-9]{32}$/.test(t)) return page("Нет токена. Открой доску заново из приложения.", 400);
  const raw = await env.DB.get("vt:" + t);
  if (!raw) return page("Ссылка недействительна или устарела. Открой доску заново из приложения.", 404);
  const { id, uid, board } = JSON.parse(raw);

  let html = null;
  let where = "";
  if (id === "lite") {
    where = "демо: положи файл в public/viz/sledy-lite.html";
    try {
      const a = await env.ASSETS.fetch(new Request(new URL("/viz/sledy-lite.html", url), { redirect: "follow" }));
      if (a.ok) {
        const txt = await a.text();
        if (!isHub(txt) && txt.length > 500) html = txt;
      }
    } catch (e) {}
  } else if (ITEMS[id] && ITEMS[id].kv) {
    where = "полная версия: загрузи файл в KV по ключу " + ITEMS[id].kv;
    const txt = await env.DB.get(ITEMS[id].kv);
    if (txt && !isHub(txt)) html = txt;
  }
  if (!html) return page("Файл визуализатора не найден (" + where + ").", 404);

  /* отладочный перехватчик ошибок: сразу после <body>, до скриптов доски */
  if (DEBUG_GUARD) {
    const m = /<body[^>]*>/i.exec(html);
    if (m) {
      const at = m.index + m[0].length;
      html = html.slice(0, at) + GUARD + html.slice(at);
    } else {
      html = GUARD + html;
    }
  }

  /* водяной знак с ID покупателя и импорт доски */
  let extra = `<div style="position:fixed;right:8px;bottom:6px;font:10px monospace;opacity:.3;pointer-events:none;z-index:2147483647">ID ${Number(uid)}</div>`;
  if (board) {
    extra += `<script>setTimeout(()=>window.__importBoard&&window.__importBoard(${JSON.stringify(board).replace(/</g, "\\u003c")}),600)<\/script>`;
  }
  const i = html.lastIndexOf("</body>");
  html = i < 0 ? html + extra : html.slice(0, i) + extra + html.slice(i);

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" } });
}

async function vizToken(env, me, body) {
  const id = String(body.id || "lite");
  if (id !== "lite") {
    const it = ITEMS[id];
    if (!it || it.type !== "viz") return json({ error: "unknown" }, 400);
    const u = await getUser(env, me.id);
    if (!owns(env, u, id)) return json({ error: "locked" }, 403);
  }

  const t = crypto.randomUUID().replace(/-/g, "");
  await env.DB.put(`vt:${t}`, JSON.stringify({ id, uid: me.id, board: body.board || null }), { expirationTtl: TTL });
  await env.DB.put(`vtu:${me.id}:${t}`, "1", { expirationTtl: TTL });
  return json({ token: t });
}

async function vizRevoke(env, uid) {
  const keys = [];
  const a = await env.DB.list({ prefix: `vtu:${uid}:` });
  for (const k of a.keys || []) {
    const t = k.name.slice(`vtu:${uid}:`.length);
    keys.push(k.name, "vt:" + t);
  }
  const b = await env.DB.list({ prefix: `vtm:${uid}:` });
  for (const k of b.keys || []) keys.push(k.name);
  for (const k of keys) await env.DB.delete(k);
  return keys.length;
}

/* ---- автоматизация чатов (Telegram Business) и команда /check ---- */
const CMD = /^\/(check|chek|c|чек)(?:@\w+)?(?:\s+([\s\S]+))?$/i;

async function bizConn(env, id) {
  const raw = await env.DB.get("bc:" + id);
  if (raw) return JSON.parse(raw);
  try {
    const r = (await tgApi(env, "getBusinessConnection", { business_connection_id: id })).result;
    const c = { uid: r.user.id, chat: r.user_chat_id, enabled: r.is_enabled !== false, can_reply: r.rights ? r.rights.can_reply !== false : r.can_reply !== false };
    await env.DB.put("bc:" + id, JSON.stringify(c), { expirationTtl: 7776000 });
    return c;
  } catch (e) { return null; }
}

const H_ = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function handleCheck(env, m, bcid) {
  const cm = (m.text || m.caption || "").trim().match(CMD);
  if (!cm || !m.from) return;
  let owner = m.from.id;
  if (bcid) {
    const conn = await bizConn(env, bcid);
    /* в личном чате команды принимаются только от владельца аккаунта, не от собеседника */
    if (!conn || !conn.enabled || conn.can_reply === false || String(conn.uid) !== String(m.from.id)) return;
    owner = conn.uid;
  }
  const biz = bcid ? { business_connection_id: bcid } : {};
  const send = (text, extra) => tgApi(env, "sendMessage", { chat_id: m.chat.id, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...biz, ...(extra || {}) });
  /* служебные ответы владельцу уходят ему лично, чтобы не засорять чат с собеседником */
  const privately = async (text) => { try { await tgApi(env, "sendMessage", { chat_id: owner, text, parse_mode: "HTML" }); } catch (e) { if (!bcid) try { await send(text); } catch (e2) {} } };

  const u = await getUser(env, owner);
  const free = u.unlimited || isOwner(env, owner);
  if (!free && u.credits < 1) return privately("Запросы закончились. Открой приложение: там можно забрать бесплатные на сегодня или купить пакет.");

  const rp = m.reply_to_message;
  const arg = (cm[2] || "").trim();
  let text = arg;
  const src = rp || null;
  if (!text && src) {
    text = (src.text || src.caption || "");
    for (const e of [...(src.entities || []), ...(src.caption_entities || [])]) if (e.type === "text_link" && e.url) text += "\n" + e.url;
  }
  const doc = !arg && ((src && src.document) || m.document);
  const photo = !arg && !doc && ((src && src.photo) || m.photo);

  try { await tgApi(env, "sendChatAction", { chat_id: m.chat.id, action: "typing", ...biz }); } catch (e) {}

  let out = null;
  try {
    if (doc) {
      if (doc.file_size && doc.file_size > 20 * 1024 * 1024) return privately("Файл больше 20 МБ, Telegram не отдаёт такие боту.");
      const f = (await tgApi(env, "getFile", { file_id: doc.file_id })).result;
      const r = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${f.file_path}`);
      if (!r.ok) return privately("Не удалось скачать файл.");
      out = await analyzeFile(await r.arrayBuffer(), doc.file_name || "");
    } else {
      out = await analyze(text);
      if (!out && photo) return privately("Фото в Telegram сжато, метаданные в нём стёрты. Отправь снимок «как файл», и я прочитаю EXIF.");
    }
  } catch (e) { return privately("Ошибка проверки: " + String((e && e.message) || e).slice(0, 200)); }

  if (!out) return privately(text ? "Не нашёл, что тут проверять." : HELP);

  const to = rp ? rp.message_id : m.message_id;
  try {
    await send(out, { reply_parameters: { message_id: to } });
  } catch (e) {
    try {
      await send(out);
    } catch (e2) {
      if (bcid) {
        try {
          await tgApi(env, "sendMessage", {
            chat_id: m.chat.id,
            text: out,
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
          });
        } catch (e3) {
          return privately("Не удалось отправить в чат, результат здесь:\n\n" + out);
        }
      } else {
        const why = String((e2 && e2.message) || e2);
        return privately("Не получилось отправить в чат (" + H_(why.slice(0, 120)) + "). Результат здесь:\n\n" + out);
      }
    }
  }

  if (!free) await env.DB1.prepare("UPDATE users SET credits = credits - 1 WHERE id = ? AND credits >= 1").bind(owner).run();
}

/* ---- inline-режим: @бот запрос в любом чате ---- */
const strip = (t) => String(t).replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const sha256hex = async (t) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((x) => x.toString(16).padStart(2, "0")).join("");

async function handleInline(env, q) {
  const answer = (results) => tgApi(env, "answerInlineQuery", { inline_query_id: q.id, results, cache_time: 0, is_personal: true });
  const art = (id, title, desc, text) => ({ type: "article", id, title, description: desc, input_message_content: { message_text: text, parse_mode: "HTML", link_preview_options: { is_disabled: true } } });
  const text = (q.query || "").trim();
  if (!text) return answer([art("hint", "Что проверить?", "Ссылка, IP, домен, email, ник, номер, крипто-адрес, координаты, хеш", H_(HELP))]);

  const u = await getUser(env, q.from.id);
  const free = u.unlimited || isOwner(env, q.from.id);
  if (!free && u.credits < 1) return answer([art("nocred", "Запросы закончились", "Открой приложение: там бесплатные на сегодня и пакеты", "Запросы закончились. Открой приложение бота: там можно забрать бесплатные на сегодня или купить пакет.")]);

  const key = "ic:" + (await sha256hex(text)).slice(0, 32);
  let out = await env.DB.get(key);
  if (!out) {
    out = await Promise.race([analyze(text), new Promise((r) => setTimeout(() => r("__timeout"), 9000))]);
    if (out === "__timeout") return answer([art("slow", "Сервисы отвечают слишком долго", "Попробуй ещё раз через несколько секунд", "Не удалось получить результат вовремя. Попробуй ещё раз.")]);
    if (out) await env.DB.put(key, out, { expirationTtl: 600 });
  }
  if (!out) return answer([art("none", "Не нашёл, что тут проверять", "Нужна ссылка, IP, домен, email, ник, номер, адрес кошелька, координаты или хеш", "Не нашёл, что тут проверять.")]);
  const lines = out.split("\n").filter((x) => x.trim());
  const title = strip(lines[0] || "Результат").slice(0, 100);
  const desc = lines.slice(1, 3).map(strip).join(" · ").slice(0, 200);
  return answer([art("r" + (await sha256hex(text)).slice(0, 20), title, desc || "Нажми, чтобы отправить результат в чат", out)]);
}

/* списание запроса, когда человек действительно отправил результат в чат */
async function handleChosen(env, c) {
  if (!c.result_id || c.result_id[0] !== "r") return;
  const uid = c.from.id;
  const u = await getUser(env, uid);
  if (u.unlimited || isOwner(env, uid)) return;
  await env.DB1.prepare("UPDATE users SET credits = credits - 1 WHERE id = ? AND credits >= 1").bind(uid).run();
}

async function webhook(request, env, waitUntil) {
  if (!env.WEBHOOK_SECRET || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET)
    return json({ error: "forbidden" }, 403);

  let up;
  try { up = await request.json(); } catch (e) { return json({ error: "bad json" }, 400); }

  if (up.inline_query) { waitUntil(handleInline(env, up.inline_query)); return json({ ok: true }); }
  if (up.chosen_inline_result) { waitUntil(handleChosen(env, up.chosen_inline_result)); return json({ ok: true }); }

  if (up.pre_checkout_query) {
    const q = up.pre_checkout_query;
    const [item, uid] = String(q.invoice_payload || "").split("|");
    const it = ITEMS[item];
    let ok = !!it && q.currency === "XTR" && q.total_amount === it.price && String(q.from.id) === uid;
    if (ok && it.type === "viz") {
      const u = await getUser(env, q.from.id);
      if (owns(env, u, item)) ok = false;
    }
    await tgApi(env, "answerPreCheckoutQuery", ok
      ? { pre_checkout_query_id: q.id, ok: true }
      : { pre_checkout_query_id: q.id, ok: false, error_message: "Покупка недоступна. Обнови приложение и попробуй снова." });
    return json({ ok: true });
  }

  if (up.business_connection) {
    const bc = up.business_connection;
    const c = { uid: bc.user.id, chat: bc.user_chat_id, enabled: bc.is_enabled !== false, can_reply: bc.rights ? bc.rights.can_reply !== false : bc.can_reply !== false };
    await env.DB.put("bc:" + bc.id, JSON.stringify(c), { expirationTtl: 7776000 });
    await getUser(env, bc.user.id);
    try {
      await tgApi(env, "sendMessage", { chat_id: bc.user_chat_id, text: c.enabled ? (c.can_reply ? "Бот подключён к твоему аккаунту. В любом личном чате ответь командой /check на сообщение со ссылкой, IP, доменом, email, ником, номером, крипто-адресом, координатами, хешем или файлом, и результат придёт в чат." : "Бот подключён, но у него нет права отвечать. Включи «Управление сообщениями» в настройках автоматизации чатов.") : "Бот отключён от аккаунта." });
    } catch (e) {}
    return json({ ok: true });
  }
  if (up.business_message) { waitUntil(handleCheck(env, up.business_message, up.business_message.business_connection_id)); return json({ ok: true }); }

  const m = up.message;
  if (!m) return json({ ok: true });

  if (m.successful_payment) {
    const sp = m.successful_payment;
    const uid = m.from.id;
    const seen = "ch:" + sp.telegram_payment_charge_id;
    if (await env.DB.get(seen)) return json({ ok: true });

    const [item, pid] = String(sp.invoice_payload || "").split("|");
    const it = ITEMS[item];
    if (it && sp.currency === "XTR" && sp.total_amount === it.price && String(uid) === pid) {
      const u = await getUser(env, uid);
      if (it.type === "viz") {
        u.owned[item] = Date.now();
        await env.DB1.prepare("UPDATE users SET owned = ? WHERE id = ?").bind(JSON.stringify(u.owned), uid).run();
      } else {
        await env.DB1.prepare("UPDATE users SET credits = credits + ? WHERE id = ?").bind(it.requests, uid).run();
      }
      await env.DB.put(seen, JSON.stringify({ uid, item, amount: sp.total_amount, ts: Date.now() }));
      try {
        await tgApi(env, "sendMessage", {
          chat_id: uid,
          text: it.type === "viz" ? `Готово: «${it.title}» открыт навсегда.` : `Готово: добавлено ${it.requests} запросов.`,
        });
      } catch (e) {}
    }
    return json({ ok: true });
  }

  const text = (m.text || "").trim();
  try {
    if (CMD.test(text)) {
      waitUntil(handleCheck(env, m, null));
    } else if (text.startsWith("/paysupport")) {
      await tgApi(env, "sendMessage", { chat_id: m.chat.id, text: `По оплате и возвратам: ${env.SUPPORT || "владельцу бота"}.` });
    } else if (text.startsWith("/start")) {
      await tgApi(env, "sendMessage", env.APP_URL
        ? { chat_id: m.chat.id, text: "OSINT Hub", reply_markup: { inline_keyboard: [[{ text: "Открыть приложение", web_app: { url: env.APP_URL } }]] } }
        : { chat_id: m.chat.id, text: "Открой приложение через меню бота." });
    }
  } catch (e) {}
  return json({ ok: true });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  if (!env.BOT_TOKEN || !env.DB || !env.DB1) return json({ error: "not configured" }, 503);

  if (path === "viz-open" && request.method === "GET") return vizOpen(url, env);

  if (path === "stats" && request.method === "GET") {
    const r = await env.DB1.prepare("SELECT COUNT(*) AS n FROM users").first();
    return json({ users: (r && r.n) || 0 });
  }

  if (request.method !== "POST") return json({ error: "method" }, 405);
  if (path === "webhook") return webhook(request, env, (p) => context.waitUntil(Promise.resolve(p).catch(() => {})));

  const me = await auth(request, env);
  if (!me) return json({ error: "auth" }, 401);

  let body = {};
  try { body = await request.json(); } catch (e) {}
  const u = await getUser(env, me.id);

  if (path === "me") return json(view(env, u));

  if (path === "claim") {
    const r = await env.DB1
      .prepare("UPDATE users SET credits = credits + ?, day = ? WHERE id = ? AND day != ?")
      .bind(DAILY, today(), me.id, today()).run();
    if (!r.meta.changes) return json({ error: "already" }, 409);
    return json(view(env, await getUser(env, me.id)));
  }

  if (path === "spend") {
    if (u.unlimited || isOwner(env, me.id)) return json(view(env, u));
    const r = await env.DB1
      .prepare("UPDATE users SET credits = credits - 1 WHERE id = ? AND credits >= 1")
      .bind(me.id).run();
    if (!r.meta.changes) return json({ error: "no requests" }, 402);
    return json(view(env, await getUser(env, me.id)));
  }

  if (path === "invoice") {
    const it = ITEMS[body.item];
    if (!it) return json({ error: "unknown item" }, 400);
    if (it.type === "viz" && owns(env, u, body.item)) return json({ error: "already owned" }, 409);
    try {
      const r = await tgApi(env, "createInvoiceLink", {
        title: it.title, description: it.desc, payload: body.item + "|" + me.id,
        currency: "XTR", prices: [{ label: it.title, amount: it.price }],
      });
      return json({ link: r.result });
    } catch (e) { return json({ error: "invoice failed" }, 502); }
  }

  if (path === "viz") {
    const it = ITEMS[body.id];
    if (!it || it.type !== "viz") return json({ error: "unknown" }, 400);
    if (!owns(env, u, body.id)) return json({ error: "locked" }, 403);
    const html = await env.DB.get(it.kv);
    if (!html) return json({ error: "not uploaded" }, 404);
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }

  if (path === "viz-token") return vizToken(env, me, body);

  /* ---- админка ---- */
  if (path.startsWith("admin")) {
    if (!isOwner(env, me.id)) return json({ error: "forbidden" }, 403);

    if (path === "admin/find") {
      const un = String(body.username || "").replace(/^@/, "").trim();
      if (!un) return json({ error: "нет юзернейма" }, 400);
      let r;
      try { r = await tgApi(env, "getChat", { chat_id: "@" + un }); }
      catch (e) { return json({ error: e.message || "не найден" }, 404); }
      const id = r.result && r.result.id;
      if (!id) return json({ error: "не найден" }, 404);
      await env.DB1.prepare("INSERT OR IGNORE INTO users (id, credits) VALUES (?, 0)").bind(id).run();
      if (body.unlimited != null)
        await env.DB1.prepare("UPDATE users SET unlimited = ? WHERE id = ?").bind(body.unlimited ? 1 : 0, id).run();
      if (body.add)
        await env.DB1.prepare("UPDATE users SET credits = credits + ? WHERE id = ?").bind(Number(body.add) | 0, id).run();
      return json({ ok: true, id, name: ((r.result.first_name || "") + " " + (r.result.last_name || "")).trim(), username: r.result.username || un });
    }

    if (path === "admin/users") {
      const rows = await env.DB1
        .prepare("SELECT id, credits, unlimited, day, created_at FROM users ORDER BY created_at DESC LIMIT 200")
        .all();
      const stat = await env.DB1
        .prepare("SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM users WHERE unlimited = 1) AS unl, (SELECT COUNT(*) FROM jobs) AS jobs, (SELECT COUNT(*) FROM ledger) AS ops")
        .first();
      const kl = await env.DB.list({ prefix: "viz:" });
      return json({ users: rows.results || [], stat, viz: (kl.keys || []).map((k) => k.name) });
    }

    if (path === "admin/viz-upload") {
      const id = String(body.id || "sledy");
      const it = ITEMS[id];
      if (!it || it.type !== "viz") return json({ error: "unknown" }, 400);
      const html = String(body.html || "");
      if (html.length < 500) return json({ error: "Файл пустой или слишком маленький" }, 400);
      if (isHub(html)) return json({ error: "Это главная страница хаба, а не визуализатор" }, 400);
      if (html.length > 20000000) return json({ error: "Файл больше 20 МБ" }, 413);
      await env.DB.put(it.kv, html);
      return json({ ok: true, size: html.length });
    }

    if (path === "admin/set") {
      const id = Number(body.id);
      if (!id) return json({ error: "bad id" }, 400);
      await env.DB1.prepare("INSERT OR IGNORE INTO users (id, credits) VALUES (?, 0)").bind(id).run();
      if (body.credits != null)
        await env.DB1.prepare("UPDATE users SET credits = ? WHERE id = ?").bind(Math.max(0, Number(body.credits) | 0), id).run();
      if (body.add)
        await env.DB1.prepare("UPDATE users SET credits = credits + ? WHERE id = ?").bind(Number(body.add) | 0, id).run();
      if (body.unlimited != null)
        await env.DB1.prepare("UPDATE users SET unlimited = ? WHERE id = ?").bind(body.unlimited ? 1 : 0, id).run();
      if (body.owned)
        await env.DB1.prepare("UPDATE users SET owned = ? WHERE id = ?").bind(JSON.stringify({ sledy: Date.now() }), id).run();
      const row = await env.DB1.prepare("SELECT id, credits, unlimited FROM users WHERE id = ?").bind(id).first();
      return json({ ok: true, user: row });
    }

    if (path === "admin/self") {
      await env.DB1.prepare("UPDATE users SET unlimited = 1 WHERE id = ?").bind(me.id).run();
      return json(view(env, await getUser(env, me.id)));
    }

    if (path === "admin/revoke") {
      const id = Number(body.id) || me.id;
      const n = await vizRevoke(env, id);
      return json({ ok: true, killed: n });
    }

    return json({ error: "unknown admin route" }, 404);
  }

  return json({ error: "not found" }, 404);
}
