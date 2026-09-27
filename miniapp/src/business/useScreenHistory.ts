import { useEffect, useRef } from "react";

/** Browser and host Back restore the same screen snapshot, without putting business data in the URL. */
export function useScreenHistory<T>(
  snapshot: T,
  restore: (snapshot: T) => void,
  canGoBack: boolean,
  fallback: () => void,
) {
  const latest = useRef({ restore, fallback });
  latest.current = { restore, fallback };
  const applying = useRef(false);
  const previous = useRef("");
  const serialized = JSON.stringify(snapshot);
  const session = useRef(crypto.randomUUID());
  useEffect(() => {
    if (serialized === previous.current) return;
    const initial = !previous.current;
    previous.current = serialized;
    if (applying.current) {
      applying.current = false;
      return;
    }
    const state = {
      oporaScreen: JSON.parse(serialized),
      oporaSession: session.current,
    };
    if (initial) history.replaceState(state, "");
    else history.pushState(state, "");
  }, [serialized]);
  useEffect(() => {
    const pop = (event: PopStateEvent) => {
      if (
        event.state?.oporaSession !== session.current ||
        !event.state?.oporaScreen
      )
        return;
      applying.current = true;
      latest.current.restore(event.state.oporaScreen);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    // Feature detection also covers delayed host SDK initialization.
    let cleanup = () => {};
    const attach = () => {
      cleanup();
      const host = window.WebApp as typeof window.WebApp & {
        BackButton?: {
          show?: () => void;
          hide?: () => void;
          onClick?: (fn: () => void) => void;
          offClick?: (fn: () => void) => void;
        };
      };
      const back = host?.BackButton;
      const click = () => latest.current.fallback();
      if (canGoBack) {
        back?.show?.();
        back?.onClick?.(click);
      } else back?.hide?.();
      cleanup = () => {
        back?.offClick?.(click);
      };
    };
    attach();
    window.addEventListener("opora:max-ready", attach);
    return () => {
      cleanup();
      window.removeEventListener("opora:max-ready", attach);
    };
  }, [canGoBack]);
}
