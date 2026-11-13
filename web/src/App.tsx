import { ReviewScreen } from "./screens/review";
import { SoundsScreen } from "./screens/sounds";
import { Shell, type Route } from "./shell";

/** The studio's screens, in navigation order; the first one is the home ("#/"). Adding a screen is one entry. */
const ROUTES: Route[] = [
  { path: "/", label: "Sounds", component: SoundsScreen },
  { path: "/review", label: "Review", component: ReviewScreen },
];

export function App() {
  return <Shell routes={ROUTES} />;
}
