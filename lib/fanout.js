import { PROVIDERS } from "./providers/_index.js";

export function pick(q, env, limit) {
  return Object.values(PROVIDERS)
    .filter((p) => p.kinds.includes(q.kind) && p.enabled(env))
    .slice(0, limit);
}

export async function fanout(q, env, limit = 6) {
  const chosen = pick(q, env, limit);
  const cost = chosen.reduce((s, p) => s + p.price, 0);

  const settled = await Promise.allSettled(
    chosen.map((p) =>
      p.run(q, env).then((r) => r.map((x) => ({ ...x, source: x.source || p.label })))
    )
  );

  const errors = [];
  const records = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") records.push(...s.value);
    else errors.push(`${chosen[i].label}: ${s.reason?.message || "fail"}`);
  });

  return { records, errors, cost, providers: chosen.map((p) => p.label) };
}

const key = (r) => `${r.kind}|${String(r.value).toLowerCase().trim()}`;

export function dedupe(records) {
  const seen = new Set();
  return records.filter((r) => {
    if (!r.value) return false;
    const k = key(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
