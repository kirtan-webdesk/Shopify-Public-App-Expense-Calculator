import { PassThrough } from "node:stream";
import type { AppLoadContext, EntryContext } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import { addDocumentResponseHeaders } from "~/shopify.server";

// ADR-0009 D1 (G1.5-revision): app/workers/bootstrap.server.ts and its
// startBackgroundWorkers() call here are REMOVED, not disabled behind a
// flag. This app runs on Vercel now — a function instance is created per
// invocation-burst and frozen/reclaimed after the response, so a
// setInterval loop started here has no guarantee of ever firing again, and
// several concurrent instances would each start their own redundant timers.
// A dormant setInterval in a serverless bundle is a trap: it survives code
// review, silently does nothing in production, and would do something
// unbounded and unbilled-for if the runtime model ever changed back. The
// same compliance work (drain, sweep, prune) is now invoked over HTTP —
// best-effort per-request via app/workers/after-response.server.ts
// (ADR-0009 D2), and guaranteed via the single scheduled
// app/routes/api.cron.tick.tsx endpoint (ADR-0009 D3). See that ADR's
// Consequences section for why reverting this (a future move back to a
// long-running host) stays cheap: drainOnce/drainBacklog/runSweeper/
// runWebhookEventPruning all kept their exact pre-ADR-0009 signatures and
// bodies — only the caller changed.

export const streamTimeout = 5_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: AppLoadContext,
) {
  // CSP (frame-ancestors) required for embedding in Shopify Admin — must be
  // applied to every document response (ADR-0007 §6).
  addDocumentResponseHeaders(request, responseHeaders);

  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get("user-agent");

    const readyOption: "onAllReady" | "onShellReady" =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode
        ? "onAllReady"
        : "onShellReady";

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} />,
      {
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) {
            console.error(error);
          }
        },
      },
    );

    setTimeout(abort, streamTimeout + 1_000);
  });
}
