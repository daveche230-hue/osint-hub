export function classify(raw) {
  const v = String(raw || "").trim();
  if (!v) throw new Error("Пустой запрос");
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return "email";
  if (/^\+?[\d\s()\-]{9,20}$/.test(v)) return "phone";
  if (/^\d{12}$/.test(v)) return "inn";
  if (/^\d{11}$/.test(v)) return "snils";
  if (/^\d{10}$/.test(v)) return "inn";
  if (/^[1-9A-HJ-NPR-Z0-9]{17}$/i.test(v)) return "vin";
  if (/^\d{16}$/.test(v)) return "card";
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(v)) return "ip";
  if (/^[a-z0-9.\-]+\.[a-z]{2,}$/i.test(v)) return "domain";
  if (/^[А-ЯЁ][а-яё\-]+(\s+[А-ЯЁ][а-яё\-]+){1,2}$/.test(v)) return "fio";
  if (/^@?[a-z0-9_.\-]{2,32}$/i.test(v)) return "nick";
  return "raw";
}

export function normalize(kind, raw) {
  const s = String(raw).trim();

  if (kind === "phone") {
    const d = s.replace(/\D/g, "");
    let e164;
    if (d.length === 11 && (d[0] === "8" || d[0] === "7")) e164 = "+7" + d.slice(1);
    else if (d.length === 10) e164 = "+7" + d;
    else e164 = "+" + d;
    return {
      kind,
      value: e164,
      variants: [...new Set([e164, e164.slice(1), d, "8" + d.slice(-10)])],
    };
  }

  if (kind === "email") {
    const e = s.toLowerCase();
    return { kind, value: e, variants: [e] };
  }

  if (kind === "fio") {
    const p = s.replace(/\s+/g, " ").split(" ");
    return { kind, value: p.join(" "), variants: [p.join(" "), [...p].reverse().join(" ")] };
  }

  if (kind === "domain") {
    const d = s.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    return { kind, value: d, variants: [d] };
  }

  if (kind === "nick") {
    const n = s.replace(/^@/, "");
    return { kind, value: n, variants: [n] };
  }

  return { kind, value: s, variants: [s] };
}
