import { useLoaderData, useRouteError } from "react-router";
import * as calculator from "~/routes/app.calculator";
import * as results from "~/routes/app.results";
import * as history from "~/routes/app.history";
import * as appIndex from "~/routes/app._index";
import AppLayout from "~/routes/app";

function withLoaderData(C: any) { return function W() { const d = useLoaderData(); return <C loaderData={d} />; }; }
function Boundary() { const e: any = useRouteError(); return <pre id="route-error">{String((e as any)?.message ?? (e as any)?.statusText ?? e)}</pre>; }
export const routes: any[] = [
  {
    path: "/app",
    Component: AppLayout,
    ErrorBoundary: Boundary,
    children: [
      { index: true, loader: appIndex.loader as any },
      { path: "calculator", Component: calculator.default, loader: calculator.loader as any, action: calculator.action as any, ErrorBoundary: Boundary },
      { path: "results", Component: withLoaderData(results.default), loader: results.loader as any, action: results.action as any, ErrorBoundary: Boundary },
      { path: "history", Component: withLoaderData(history.default), loader: history.loader as any, ErrorBoundary: Boundary },
    ],
  },
];
