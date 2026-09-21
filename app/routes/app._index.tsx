import { redirect } from "react-router";
import type { Route } from "./+types/app._index";

// /app redirects to /app/calculator — the calculator is the app's home
// screen (matches design/mockup/calculator.html being the first mockup
// screen and the entry point in every mockup's nav). The layout route
// (app.tsx) designates /app/calculator as the app home for the Admin sidebar
// (rel="home"), so this redirect only serves a direct hit on /app.
//
// The query string is forwarded unchanged (same reasoning as routes/_index.tsx):
// a first embedded load carries host / id_token / shop, and dropping them here
// would break the token-exchange handshake one hop downstream.
export async function loader({ request }: Route.LoaderArgs) {
  return redirect(`/app/calculator${new URL(request.url).search}`);
}
