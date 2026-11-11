const COL = { phone: 150, email: 45, fio: 275, nick: 200, source: 0, address: 320, inn: 15 };

export function buildBoard(subject, records) {
  const cards = [
    { id: "root", type: subject.kind, title: subject.value, col: "hsl(210 92% 55%)", x: 0, y: 0 },
  ];
  const links = [];
  const byValue = new Map();

  for (const r of records) {
    const k = `${r.kind}|${String(r.value).toLowerCase()}`;
    let id = byValue.get(k);
    if (!id) {
      id = "n" + cards.length;
      byValue.set(k, id);
      cards.push({
        id,
        type: r.kind,
        title: String(r.value),
        text: r.fields
          ? Object.entries(r.fields)
              .filter(([, v]) => v)
              .map(([a, b]) => `${a}: ${b}`)
              .join("\n")
          : "",
        col: `hsl(${COL[r.kind] ?? 220} 70% 55%)`,
        x: Math.cos(cards.length) * 240,
        y: Math.sin(cards.length) * 240,
      });
    }
    links.push({ id: "l" + links.length, a: "root", b: id, label: r.source || "", k: true });
  }

  return { name: `Пробив ${subject.value}`, cards, links, strokes: [], shapes: [], view: "3d" };
}

export function summarize(records) {
  const byKind = {};
  for (const r of records) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  return byKind;
}
