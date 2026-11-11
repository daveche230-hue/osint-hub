const enc = new TextEncoder();

export async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, typeof data === "string" ? enc.encode(data) : data));
}

export const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

export function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function auth(request, env) {
  const raw = request.headers.get("X-Init-Data") || "";
  if (!raw) return null;
  const p = new URLSearchParams(raw);
  const hash = p.get("hash");
  if (!hash) return null;
  p.delete("hash");
  const dcs = [...p.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => k + "=" + v)
    .join("\n");
  const secret = await hmac(enc.encode("WebAppData"), env.BOT_TOKEN);
  if (!safeEq(hex(await hmac(secret, dcs)), hash)) return null;
  const age = Date.now() / 1000 - Number(p.get("auth_date") || 0);
  if (!(age < 86400)) return null;
  try {
    const u = JSON.parse(p.get("user") || "{}");
    return u.id ? { id: u.id } : null;
  } catch (e) {
    return null;
  }
}

export async function rateLimit(env, uid, perMin = 10) {
  const k = `rl:${uid}:${Math.floor(Date.now() / 60000)}`;
  const n = Number(await env.DB.get(k)) || 0;
  if (n >= perMin) return false;
  await env.DB.put(k, String(n + 1), { expirationTtl: 120 });
  return true;
}

export const isOwner = (env, id) => !!env.OWNER_ID && String(env.OWNER_ID) === String(id);
