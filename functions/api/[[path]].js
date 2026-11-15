import { auth, isOwner } from "../../lib/guard.js";

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
      : { pre_checkout_query_id: q.id, ok: false, error_message: "Покупка недоступна. Обнови приложение и попробуй снова." });
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
          text: it.type === "viz" ? `Готово: «${it.title}» открыт навсегда.` : `Готово: добавлено ${it.requests} запросов.`,
        });
      } catch (e) {}
    }
    return json({ ok: true });
  }

  const text = (m.text || "").trim();
  try {
    if (text.startsWith("/paysupport")) {
      await tgApi(env, "sendMessage", { chat_id: m.chat.id, text: `По оплате и возвратам: ${env.SUPPORT || "владельцу бота"}.` });
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
  if (!env.BOT_TOKEN || !env.DB || !env.DB1) return json({ error: "not configured" }, 503);

  if (path === "viz-open" && request.method === "GET") return vizOpen(url, env);

  if (request.method !== "POST") return json({ error: "method" }, 405);
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
        .prepare("SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM jobs) AS jobs, (SELECT COUNT(*) FROM ledger) AS ops")
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
