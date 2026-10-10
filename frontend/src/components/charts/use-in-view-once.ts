"use client";

import { useEffect, useState, type RefObject } from "react";

/** True after the node first intersects the viewport. Stays true. */
export function useInViewOnce(
  ref: RefObject<Element | null>,
  threshold = 0.2
): boolean {
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (seen) {
      return;
    }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, seen, threshold]);

  return seen;
}
