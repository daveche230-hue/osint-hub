import { auth, rateLimit, isOwner } from "../../lib/guard.js";
import { classify, normalize } from "../../lib/normalize.js";
import { fanout, dedupe, pick } from "../../lib/fanout.js";
import { buildBoard, summarize } from "../../lib/graph.js";

const json = (d, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export async function onRequestPost({ request, env, waitUntil }) {
  const me = await auth(request, env);
  if (!me) return json({ error: "auth" }, 401);

  // безлимит: владелец (OWNER_ID) или флаг users.unlimited = 1
  const row = await env.DB1
    .prepare("SELECT credits, unlimited FROM users WHERE id = ?")
    .bind(me.id)
    .first();
  const unlimited = isOwner(env, me.id) || !!row?.unlimited;

  if (!(await rateLimit(env, me.id, unlimited ? 60 : 10))) return json({ error: "too many" }, 429);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }

  let q;
  try {
    const kind = body.kind || classify(body.value);
    q = normalize(kind, body.value);
  } catch (e) {
    return json({ error: e.message }, 400);
  }

  const chosen = pick(q, env, Number(env.MAX_PROVIDERS || 6));
  if (!chosen.length) return json({ error: "нет доступных источников для этого типа" }, 400);

  const need = Math.max(1, chosen.reduce((s, p) => s + p.price, 0));
  if (!unlimited && (row?.credits || 0) < need) return json({ error: "no requests", need }, 402);

  const id = crypto.randomUUID();
  await env.DB1
    .prepare("INSERT INTO jobs (id, uid, kind, value, status) VALUES (?,?,?,?,?)")
    .bind(id, me.id, q.kind, q.value, "running")
    .run();

  waitUntil(run(id, me.id, q, env, unlimited));
  return json({ job: id, need: unlimited ? 0 : need, unlimited });
}

async function run(jobId, uid, q, env, unlimited = false) {
  const db = env.DB1;
  const cacheKey = "c:" + q.kind + ":" + q.value.toLowerCase();
  try {
    const cached = await env.DB.get(cacheKey);
    let records, cost = 0, errors = [], providers = [], fromCache = false;

    if (cached) {
      ({ records, cost, errors, providers } = JSON.parse(cached));
      fromCache = true;
    } else {
      const res = await fanout(q, env, Number(env.MAX_PROVIDERS || 6));
      records = dedupe(res.records);
      cost = res.cost;
      errors = res.errors;
      providers = res.providers;
      await env.DB.put(
        cacheKey,
        JSON.stringify({ records, cost, errors, providers }),
        { expirationTtl: 604800 }
      );
    }

    const charge = unlimited ? 0 : fromCache ? 1 : Math.max(1, cost);

    if (!unlimited) {
      const spend = await db
        .prepare("UPDATE users SET credits = credits - ? WHERE id = ? AND credits >= ?")
        .bind(charge, uid, charge)
        .run();
      if (!spend.meta.changes) throw new Error("Недостаточно кредитов");

      await db
        .prepare("INSERT INTO ledger (uid, d, why) VALUES (?,?,?)")
        .bind(uid, -charge, "lookup:" + jobId)
        .run();
    }

    const payload = {
      subject: { kind: q.kind, value: q.value },
      providers,
      errors,
      charge,
      stats: summarize(records),
      records: records.slice(0, 500),
      board: buildBoard(q, records),
    };

    await db
      .prepare("UPDATE jobs SET status='done', result=?, cost=? WHERE id=?")
      .bind(JSON.stringify(payload), charge, jobId)
      .run();
  } catch (e) {
    await db
      .prepare("UPDATE jobs SET status='error', err=? WHERE id=?")
      .bind(String(e.message), jobId)
      .run();
  }
}
