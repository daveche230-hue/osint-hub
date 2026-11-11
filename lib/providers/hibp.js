export const id = "hibp";
export const label = "Have I Been Pwned";
export const kinds = ["email"];
export const price = 1;
export const enabled = (env) => !!env.HIBP_KEY;

export async function run(q, env) {
  const r = await fetch(
    `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(q.value)}?truncateResponse=false`,
    {
      headers: { "hibp-api-key": env.HIBP_KEY, "user-agent": "OSINT-Hub" },
      signal: AbortSignal.timeout(15000),
    }
  );
  if (r.status === 404) return [];
  if (!r.ok) return [];

  const arr = await r.json();
  return arr.map((b) => ({
    kind: "source",
    value: b.Name,
    db: b.Name,
    date: b.BreachDate,
    fields: { title: b.Title, domain: b.Domain, pwn: b.PwnCount, data: (b.DataClasses || []).join(", ") },
  }));
}
