"use client";

import { useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export type QueryUpdate = Record<string, string | readonly string[] | null | undefined>;

/** Updates a set of query parameters as one browser-history entry. */
export function useUrlQueryState() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const pushQuery = useCallback((updates: QueryUpdate) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      next.delete(key);
      if (typeof value === "string") {
        if (value) next.append(key, value);
      } else if (Array.isArray(value)) {
        for (const item of value) if (item) next.append(key, item);
      }
    }
    const query = next.toString();
    const href = `${pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== href) {
      window.history.pushState(null, "", href);
    }
  }, [pathname, searchParams]);

  return { searchParams, pushQuery };
}
