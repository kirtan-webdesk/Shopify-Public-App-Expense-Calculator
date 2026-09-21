import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";

// Server-renders a route COMPONENT inside a real static router (so useLoaderData /
// useActionData / useNavigation / <Form> all work) with fixture loader data. DB-free:
// the caller stubs authenticate / repositories with vi.mock BEFORE importing the route.

export const asComponent = (c: unknown) => c as ComponentType<Record<string, unknown>>;

export interface RenderOptions {
  /** Passed to the component as `loaderData` (route modules typed against Route.ComponentProps read it). */
  readonly passLoaderData?: boolean;
  /** Fixture action response (what useActionData() returns). */
  readonly actionData?: unknown;
}

export async function renderRoute(
  Component: unknown,
  loaderData: unknown,
  url = "http://localhost/",
  options: RenderOptions = {},
): Promise<string> {
  const path = new URL(url).pathname;
  const Wrapped = () =>
    options.passLoaderData
      ? createElement(asComponent(Component), { loaderData })
      : createElement(asComponent(Component));
  const handler = createStaticHandler([
    { path, loader: () => loaderData ?? null, action: () => options.actionData ?? null, Component: Wrapped },
  ]);
  const context = await handler.query(new Request(url));
  if (context instanceof Response) throw new Error("unexpected redirect");
  if (options.actionData !== undefined) {
    (context as { actionData: unknown }).actionData = { [context.matches[0]!.route.id]: options.actionData };
  }
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToStaticMarkup(createElement(StaticRouterProvider, { router, context, hydrate: false }));
}

/** The opening tag of the first element matching `tag` whose attributes contain `contains`. */
export function openingTag(html: string, tag: string, contains: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>`, "g");
  const found = (html.match(re) ?? []).find((t) => t.includes(contains));
  if (!found) throw new Error(`no <${tag}> containing ${contains}`);
  return found;
}

export function countTags(html: string, tag: string): number {
  return (html.match(new RegExp(`<${tag}\\b`, "g")) ?? []).length;
}
