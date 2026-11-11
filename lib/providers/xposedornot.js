export const id = "xposedornot";
export const label = "XposedOrNot";
export const kinds = ["email"];
export const price = 1;
export const enabled = () => true;

export async function run(q, env) {
  const out = [];
  const r = await fetch(
    "https://api.xposedornot.com/v1/check-email/" + encodeURIComponent(q.value),
    { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) }
  );
  if (!r.ok) return [];
  let j;
  try { j = await r.json(); } catch (e) { return []; }
  for (const b of j.breaches || []) {
    const name = Array.isArray(b) ? b[0] : b;
    if (!name) continue;
    out.push({ kind: "source", value: String(name), db: "XposedOrNot", fields: { база: String(name) } });
  }
  return out;
}
