import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The /app layout: the App Bridge navigation (G2-revision v2, IA-v2.md section 1) and the /app
// redirect. authenticate is stubbed BEFORE the route modules import.
vi.mock("~/shopify.server", () => ({ authenticate: { admin: vi.fn() } }));

import AppLayout from "~/routes/app";
import { loader as appIndexLoader } from "~/routes/app._index";
import { openingTag, renderRoute } from "../helpers/render-route";

async function nav(): Promise<string> {
  const html = await renderRoute(AppLayout, null, "http://localhost/app");
  return html.match(/<s-app-nav>[\s\S]*<\/s-app-nav>/)?.[0] ?? "";
}

describe("app nav (app.tsx)", () => {
  it("has exactly three links: the Calculator (rel=home), Expense rules, History - in that order", async () => {
    const html = await nav();
    const links = html.match(/<s-link\b[^>]*>[^<]*<\/s-link>/g) ?? [];
    expect(links).toEqual([
      '<s-link href="/app/calculator" rel="home">Calculator</s-link>',
      '<s-link href="/app/rules">Expense rules</s-link>',
      '<s-link href="/app/history">History</s-link>',
    ]);
  });

  it("only one link carries rel=home (the Calculator), so the sidebar shows exactly two children", async () => {
    const html = await nav();
    expect((html.match(/\srel="home"/g) ?? []).length).toBe(1);
    expect(openingTag(html, "s-link", 'href="/app/calculator"')).toContain('rel="home"');
    expect(openingTag(html, "s-link", 'href="/app/rules"')).not.toContain("rel=");
    expect(openingTag(html, "s-link", 'href="/app/history"')).not.toContain("rel=");
  });

  it("the sidebar item is 'Expense rules'", async () => {
    expect(await nav()).toContain(">Expense rules</s-link>");
  });

  it("Results and the history detail are NOT nav entries (each has one parent and a breadcrumb)", async () => {
    const html = await nav();
    expect(html).not.toContain("/app/results");
    expect(html).not.toMatch(/href="\/app\/history\/[^"]+"/);
  });

  it("does not use the legacy NavMenu / ui-nav-menu", async () => {
    const html = renderToStaticMarkup(createElement("div", null, await nav()));
    expect(html).not.toMatch(/ui-nav-menu|NavMenu/);
  });
});

describe("/app and / land on the calculator", () => {
  it("/app redirects to /app/calculator and forwards the embedded-app query string unchanged", async () => {
    const res = (await appIndexLoader({ request: new Request("http://localhost/app?host=abc&shop=x.myshopify.com&id_token=t") } as never)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/app/calculator?host=abc&shop=x.myshopify.com&id_token=t");
  });

  it("/app with no query redirects to plain /app/calculator", async () => {
    const res = (await appIndexLoader({ request: new Request("http://localhost/app") } as never)) as Response;
    expect(res.headers.get("Location")).toBe("/app/calculator");
  });
});
