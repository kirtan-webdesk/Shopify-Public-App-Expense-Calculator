import { Outlet } from "react-router";
import type { Route } from "./+types/app";
import { authenticate } from "~/shopify.server";

// /app layout — every child route renders through this. authenticate.admin
// validates the session-token JWT (route-auth matrix: embedded admin route).
// Navigation via s-app-nav/s-link (App Bridge primitive, not a custom
// sidebar), ported from every mockup screen's identical nav block.
export async function loader({ request }: Route.LoaderArgs) {
  await authenticate.admin(request);
  return null;
}

export default function AppLayout() {
  return (
    <>
      <s-app-nav>
        <s-link href="/app/calculator">Calculator</s-link>
        <s-link href="/app/history">History</s-link>
      </s-app-nav>
      <Outlet />
    </>
  );
}
