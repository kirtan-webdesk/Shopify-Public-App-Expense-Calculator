import { launch, fresh, reset } from "./lib.mjs";
const browser = await launch();
await reset();
const { ctx, page } = await fresh(browser, "/app/calculator");
const r = await page.evaluate(async () => {
  const out = {};
  const mk = (h) => { const p = document.createElement("s-page"); p.setAttribute("heading", h); const a = document.createElement("s-button"); a.slot = "primary-action"; a.textContent = "Act"; p.appendChild(a); return p; };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const real = document.querySelector("s-page");
  const parent = real.parentElement;
  // (a) remove, wait, append
  real.remove(); await wait(500);
  const a = mk("A-after-wait"); parent.appendChild(a); await wait(800);
  out.afterWait = a.shadowRoot?.textContent.trim().slice(0, 60);
  // (b) same-tick swap
  const b = mk("B-same-tick"); a.replaceWith(b); await wait(800);
  out.sameTickSwap = b.shadowRoot?.textContent.trim().slice(0, 60);
  // (c) swap with a delay between remove and add of 0ms macrotask
  b.remove(); await wait(0); const c = mk("C-next-task"); parent.appendChild(c); await wait(800);
  out.nextTask = c.shadowRoot?.textContent.trim().slice(0, 60);
  // (d) hide via re-connect the same node
  c.remove(); await wait(300); parent.appendChild(c); await wait(800);
  out.reconnectSame = c.shadowRoot?.textContent.trim().slice(0, 60);
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
