import * as React from "react";

const DEFAULT_BREAKPOINT = 1024;

/**
 * True below the given breakpoint (default 1024 px). The initial value is
 * computed synchronously so the first render already matches the viewport —
 * responsive table/card swaps never flash the wrong layout.
 */
export function useIsMobile(breakpoint: number = DEFAULT_BREAKPOINT): boolean {
  const query = `(max-width: ${breakpoint - 1}px)`;
  const [isMobile, setIsMobile] = React.useState<boolean>(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );

  React.useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return isMobile;
}
