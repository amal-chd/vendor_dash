import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Ensures every navigation starts at the top of the page.
 * (React Router does not do this by default in SPAs.)
 */
export function ScrollToTop() {
  const { pathname, search, hash } = useLocation();

  useLayoutEffect(() => {
    // Preserve native anchor behavior.
    if (hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname, search, hash]);

  return null;
}

