import { auth } from "../../../lib/guard.js";

const json = (d, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export async function onRequestGet({ request, env, params }) {
  const me = await auth(request, env);
  if (!me) return json({ error: "auth" }, 401);

  const row = await env.DB1
    .prepare("SELECT status, result, err FROM jobs WHERE id = ? AND uid = ?")
    .bind(params.id, me.id)
    .first();
  if (!row) return json({ error: "not found" }, 404);

  return json({ status: row.status, result: row.status === "done" ? row.result : null, err: row.err });
}
