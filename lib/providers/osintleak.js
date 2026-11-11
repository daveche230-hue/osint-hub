export const id = "osintleak";
export const label = "Osintleak";
export const kinds = ["phone", "email", "fio", "nick", "inn", "passport", "snils", "card", "vin", "domain", "ip"];
export const price = 2;
export const enabled = (env) => !!env.OSINTLEAK_KEY;

export async function run(q, env) {
  const type =
    { fio: "name", nick: "username", passport: "idcard", card: "cc_number" }[q.kind] || q.kind;
  const p = new URLSearchParams({
    api_key: env.OSINTLEAK_KEY,
    query: q.value,
    type,
    stealerlogs: "true",
    dbleaks: "true",
    dbleaks2: "true",
    search_option: "quick",
    page_size: "100",
    meta: "false",
  });
  const r = await fetch(`https://osintleak.com/api/v1/search_api/?${p}`, {
    headers: { "User-Agent": "OSINT-Hub/1.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) return [];
  const j = await r.json();
  if (j.status !== "success") return [];

  const out = [];
  for (const row of j.results || []) {
    const d = row.data || row;
    const src = row.db || row.source || "osintleak";
    out.push({ kind: "source", value: src, db: src, date: row.date || null, fields: d });
    for (const [k, v] of Object.entries(d)) {
      const kk = /mail/.test(k) ? "email" : /phone|tel/.test(k) ? "phone" : /name|fio/.test(k) ? "fio" : null;
      if (kk && typeof v === "string" && v.length > 2) out.push({ kind: kk, value: v, source: src });
    }
  }
  return out;
}
