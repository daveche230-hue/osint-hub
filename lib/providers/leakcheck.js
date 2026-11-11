export const id = "leakcheck";
export const label = "LeakCheck";
export const kinds = ["email", "phone", "nick", "fio", "domain"];
export const price = 1;
export const enabled = (env) => !!env.LEAKCHECK_KEY;

export async function run(q, env) {
  const type = q.kind === "fio" ? "name" : q.kind === "nick" ? "username" : q.kind;
  const out = [];
  for (const term of q.variants) {
    const r = await fetch(
      `https://leakcheck.io/api/v2/query/${encodeURIComponent(term)}?type=${type}&page=1`,
      {
        headers: { "X-API-Key": env.LEAKCHECK_KEY, Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      }
    );
    if (r.status === 429) break;
    if (!r.ok) continue;
    const j = await r.json();
    for (const row of j.result || []) {
      const f = row.fields || {};
      out.push({
        kind: "source",
        value: row.source || "unknown",
        db: row.source,
        date: row.date || null,
        fields: { email: f.email, phone: f.phone, name: f.name, pass: f.password, user: f.username },
      });
      if (f.email) out.push({ kind: "email", value: f.email.toLowerCase(), source: row.source });
      if (f.phone) out.push({ kind: "phone", value: f.phone, source: row.source });
      if (f.name) out.push({ kind: "fio", value: f.name, source: row.source });
    }
  }
  return out;
}
