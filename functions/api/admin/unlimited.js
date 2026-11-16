import { auth, isOwner } from "../../../lib/guard.js";

const json = (d, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

// POST /api/admin/unlimited  { "id": 123456789, "value": true }
// Доступно только владельцу (env.OWNER_ID).
export async function onRequestPost({ request, env }) {
  const me = await auth(request, env);
  if (!me || !isOwner(env, me.id)) return json({ error: "forbidden" }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }

  const target = Number(body.id);
  if (!Number.isFinite(target) || target <= 0) return json({ error: "bad id" }, 400);

  const flag = body.value === false ? 0 : 1;
  const res = await env.DB1
    .prepare("UPDATE users SET unlimited = ? WHERE id = ?")
    .bind(flag, target)
    .run();

  if (!res.meta.changes) return json({ error: "user not found (он должен хотя бы раз открыть бота)" }, 404);
  return json({ ok: true, id: target, unlimited: !!flag });
}
