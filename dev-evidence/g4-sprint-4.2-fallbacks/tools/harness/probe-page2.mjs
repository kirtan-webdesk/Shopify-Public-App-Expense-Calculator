import { launch, fresh, reset } from "./lib.mjs";
const browser = await launch();
await reset();
const { ctx, page } = await fresh(browser, "/app/calculator");
const r = await page.evaluate(async () => {
  const out = {};
  const mk = (how) => {
    const p = document.createElement("s-page");
    if (how === "attr") p.setAttribute("heading", "T-attr");
    if (how === "prop") p.heading = "T-prop";
    const a = document.createElement("s-button"); a.slot = "primary-action"; a.textContent = "Act"; p.appendChild(a);
    const d = document.createElement("div"); d.textContent = "body"; p.appendChild(d);
    document.body.appendChild(p);
    return p;
  };
  for (const how of ["attr", "prop", "none"]) { const p = mk(how); await new Promise((r) => setTimeout(r, 600)); out[how] = { shadow: p.shadowRoot?.textContent.trim().slice(0, 60), heading: p.getAttribute("heading"), prop: p.heading }; p.remove(); }
  // remove the real page then add fresh via clone
  const real = document.querySelector("s-page");
  const clone = real.cloneNode(true); real.replaceWith(clone); await new Promise((r) => setTimeout(r, 600));
  out.clone = { shadow: clone.shadowRoot?.textContent.trim().slice(0, 60) };
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
