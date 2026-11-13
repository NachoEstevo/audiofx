import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

/** The route lives in the hash ("#/review" → "/review"), so the server keeps serving one page. */
export const hashPath = () => window.location.hash.replace(/^#/, "").replace(/\/+$/, "") || "/";

export const hrefOf = (path: string) => `#${path}`;

/** The current hash route. The screen swap runs inside a View Transition when the browser has them. */
export function useHashPath(): string {
  const [path, setPath] = useState(hashPath);
  useEffect(() => {
    const onChange = () => {
      const apply = () => flushSync(() => setPath(hashPath()));
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (document.startViewTransition && !reduce) {
        const transition = document.startViewTransition(apply);
        // A page that is not painting (a background tab) times the animation out; the route has changed anyway.
        for (const done of [transition.ready, transition.updateCallbackDone, transition.finished]) done.catch(() => {});
      } else apply();
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return path;
}
