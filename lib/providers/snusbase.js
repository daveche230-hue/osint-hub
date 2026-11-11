export const id = "snusbase";
export const label = "Snusbase";
export const kinds = ["email", "nick", "fio", "ip", "domain"];
export const price = 2;
export const enabled = (env) => !!env.SNUSBASE_KEY;

export async function run(q, env) {
  const types = { email: ["email"], nick: ["username"], fio: ["name"], ip: ["lastip"], domain: ["_domain"] }[q.kind];
  if (!types) return [];

  const r = await fetch("https://api.snusbase.com/data/search", {
    method: "POST",
    headers: { Auth: env.SNUSBASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ terms: q.variants.slice(0, 3), types, wildcard: false }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) return [];

  const j = await r.json();
  const out = [];
  for (const [db, rows] of Object.entries(j.results || {})) {
    for (const row of rows) {
      out.push({ kind: "source", value: db, db, fields: row });
      if (row.email) out.push({ kind: "email", value: row.email, source: db });
      if (row.name) out.push({ kind: "fio", value: row.name, source: db });
      if (row.username) out.push({ kind: "nick", value: row.username, source: db });
    }
  }
  return out;
}
