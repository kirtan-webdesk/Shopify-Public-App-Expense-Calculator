export function mkD({ revenue, currency = "USD", items }) {
  const total = items.reduce((s, i) => s + i.amt, 0);
  const p = { v: 1, ev: "1.0.0", r: revenue, c: currency, t: total, n: revenue - total, li: items };
  return Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
}
