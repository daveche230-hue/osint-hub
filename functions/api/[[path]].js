// Cloudflare Pages Function: всё /api/* кроме /api/lookup и /api/job/*.
import { auth, isOwner } from "../../lib/guard.js";

const DAILY = 5;
const ITEMS = {
  sledy: { type: "viz", title: "Следы: полная версия", desc: "Доска расследований: карточки, связи, 2D и 3D граф без ограничений.", price: 250, kv: "viz:sledy" },
  pack_20: { type: "pack", title: "20 запросов", desc: "Пакет из 20 запросов к инструментам.", requests: 20, price: 30 },
  pack_60: { type: "pack", title: "60 запросов", desc: "Пакет из 60 запросов к инструментам.", requests: 60, price: 80 },
  pack_200: { type: "pack", title: "200 запросов", desc: "Пакет из 200 запросов к инструментам.", requests: 200, price: 220 },
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

async function tgApi(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
    u = { id, credits: 0, day: "", owned: "{}" };
  }
  u.owned = JSON.parse(u.owned || "{}");
  return u;
}

const owns = (env, u, item) => isOwner(env, u.id) || !!u.owned[item];

function publicItems() {
  const o = {};
  for (const [k, v] of Object.entries(ITEMS))
    o[k] = { type: v.type, title: v.title, price: v.price, requests: v.requests || 0 };
  return o;
}

function view(env, u) {
  const t = today();
  const claimable = u.day !== t;
  const next = Math.max(0, Math.floor((Date.parse(t + "T00:00:00Z") + 86400000 - Date.now()) / 1000));
  const owned = Object.keys(ITEMS).filter((k) => ITEMS[k].type === "viz" && owns(env, u, k));
  return { requests: u.credits, canClaim: claimable, nextClaimSec: claimable ? 0 : next, owned, daily: DAILY, items: publicItems() };
}

async function webhook(request, env) {
  if (!env.WEBHOOK_SECRET || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET)
    return json({ error: "forbidden" }, 403);

  let up;
  try { up = await request.json(); } catch (e) { return json({ error: "bad json" }, 400); }

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
      : { pre_checkout_query_id: q.id, ok: false, error_message: "Покупка недоступна. Закрой окно, обнови приложение и попробуй снова." });
    return json({ ok: true });
  }

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
          text: it.type === "viz" ? `Готово: «${it.title}» открыт навсегда. Заходи в приложение.` : `Готово: добавлено ${it.requests} запросов.`,
        });
      } catch (e) {}
    }
    return json({ ok: true });
  }

  const text = (m.text || "").trim();
  try {
    if (text.startsWith("/paysupport")) {
      await tgApi(env, "sendMessage", { chat_id: m.chat.id, text: `По вопросам оплаты и возвратов пиши: ${env.SUPPORT || "владельцу бота"}.` });
    } else if (text.startsWith("/start")) {
      await tgApi(env, "sendMessage", env.APP_URL
        ? { chat_id: m.chat.id, text: "OSINT Hub", reply_markup: { inline_keyboard: [[{ text: "Открыть приложение", web_app: { url: env.APP_URL } }]] } }
        : { chat_id: m.chat.id, text: "Открой приложение через меню бота." });
    }
  } catch (e) {}
  return json({ ok: true });
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  if (request.method !== "POST") return json({ error: "method" }, 405);
  if (!env.BOT_TOKEN || !env.DB || !env.DB1) return json({ error: "not configured" }, 503);
  if (path === "webhook") return webhook(request, env);

  const me = await auth(request, env);
  if (!me) return json({ error: "auth" }, 401);

  let body = {};
  try { body = await request.json(); } catch (e) {}
  const u = await getUser(env, me.id);

  if (path === "me") return json(view(env, u));

  if (path === "claim") {
    const r = await env.DB1
      .prepare("UPDATE users SET credits = credits + ?, day = ? WHERE id = ? AND day != ?")
      .bind(DAILY, today(), me.id, today())
      .run();
    if (!r.meta.changes) return json({ error: "already" }, 409);
    return json(view(env, await getUser(env, me.id)));
  }

  if (path === "spend") {
    const r = await env.DB1
      .prepare("UPDATE users SET credits = credits - 1 WHERE id = ? AND credits >= 1")
      .bind(me.id)
      .run();
    if (!r.meta.changes) return json({ error: "no requests" }, 402);
    return json(view(env, await getUser(env, me.id)));
  }

  if (path === "invoice") {
    const it = ITEMS[body.item];
    if (!it) return json({ error: "unknown item" }, 400);
    if (it.type === "viz" && owns(env, u, body.item)) return json({ error: "already owned" }, 409);
    try {
      const r = await tgApi(env, "createInvoiceLink", {
        title: it.title,
        description: it.desc,
        payload: body.item + "|" + me.id,
        currency: "XTR",
        prices: [{ label: it.title, amount: it.price }],
      });
      return json({ link: r.result });
    } catch (e) {
      return json({ error: "invoice failed" }, 502);
    }
  }

  if (path === "viz") {
    const it = ITEMS[body.id];
    if (!it || it.type !== "viz") return json({ error: "unknown" }, 400);
    if (!owns(env, u, body.id)) return json({ error: "locked" }, 403);
    const html = await env.DB.get(it.kv);
    if (!html) return json({ error: "not uploaded" }, 404);
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  return json({ error: "not found" }, 404);
}
