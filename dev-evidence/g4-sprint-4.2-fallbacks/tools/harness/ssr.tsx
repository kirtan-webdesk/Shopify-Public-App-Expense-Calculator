import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { routes } from "./routes";
export async function render(url: string): Promise<string> {
  const handler = createStaticHandler(routes);
  const context: any = await handler.query(new Request("http://localhost" + url));
  if (context instanceof Response) return "REDIRECT " + context.headers.get("Location");
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToString(<StaticRouterProvider router={router} context={context} hydrate={true} />);
}

// Drives a real route ACTION on the server (the same code path a form POST takes) so direct page loads can be seeded with state.
export async function post(url: string, fields: Record<string, string>): Promise<string> {
  const handler = createStaticHandler(routes);
  const res: any = await handler.query(new Request("http://localhost" + url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() }));
  if (res instanceof Response) return "REDIRECT " + res.headers.get("Location");
  return "CONTEXT " + JSON.stringify(res.actionData ?? null);
}
