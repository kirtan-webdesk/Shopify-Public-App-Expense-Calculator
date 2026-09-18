import { redirect } from "react-router";
import type { Route } from "./+types/app._index";

// /app redirects to /app/calculator — the calculator is the app's home
// screen (matches design/mockup/calculator.html being the first mockup
// screen and the entry point in every mockup's nav).
export async function loader(_args: Route.LoaderArgs) {
  return redirect("/app/calculator");
}
