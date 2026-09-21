import { useLoaderData, useRouteError, isRouteErrorResponse } from "react-router";
import * as calculator from "~/routes/app.calculator";
import * as rules from "~/routes/app.rules";
import * as results from "~/routes/app.results";
import * as history from "~/routes/app.history";
import * as historyId from "~/routes/app.history.$id";
import * as appIndex from "~/routes/app._index";
import AppLayout from "~/routes/app";

function withLoaderData(C: any) { return function W() { const d = useLoaderData(); return <C loaderData={d} />; }; }
function Boundary() { const e: any = useRouteError(); return <pre id="route-error">{isRouteErrorResponse(e) ? `${e.status} ${e.data}` : String(e?.message ?? e)}</pre>; }
export const routes: any[] = [
  {
    path: "/app",
    Component: AppLayout,
    ErrorBoundary: Boundary,
    children: [
      { index: true, loader: appIndex.loader as any },
      { path: "calculator", Component: calculator.default, loader: calculator.loader as any, action: calculator.action as any, ErrorBoundary: Boundary },
      { path: "rules", Component: rules.default, loader: rules.loader as any, action: rules.action as any, ErrorBoundary: Boundary },
      { path: "results", Component: withLoaderData(results.default), loader: results.loader as any, action: results.action as any, ErrorBoundary: Boundary },
      { path: "history", Component: withLoaderData(history.default), loader: history.loader as any, ErrorBoundary: Boundary },
      { path: "history/:id", Component: withLoaderData(historyId.default), loader: historyId.loader as any, ErrorBoundary: historyId.ErrorBoundary as any },
    ],
  },
];
