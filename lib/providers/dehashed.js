export const id = "dehashed";
export const label = "DeHashed";
export const kinds = ["email", "phone", "fio", "nick", "ip", "domain"];
export const price = 2;
export const enabled = (env) => !!(env.DEHASHED_USER && env.DEHASHED_KEY);

export async function run(q, env) {
  const field = { fio: "name", nick: "username" }[q.kind] || q.kind;
  const auth = btoa(`${env.DEHASHED_USER}:${env.DEHASHED_KEY}`);
  const r = await fetch(
    `https://api.dehashed.com/search?query=${encodeURIComponent(`${field}:"${q.value}"`)}&size=100`,
    {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    }
  );
  if (!r.ok) return [];

  const j = await r.json();
  return (j.entries || []).map((e) => ({
    kind: "source",
    value: e.database_name,
    db: e.database_name,
    fields: e,
  }));
}
