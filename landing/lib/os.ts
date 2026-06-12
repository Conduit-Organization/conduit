"use client";

import { useEffect, useState } from "react";

export type OS = "linux" | "mac" | "win" | "unknown";

/** Best-effort OS detection from the UA string (client-only). */
export function detectOS(): OS {
  if (typeof navigator === "undefined") return "unknown";
  const ua = `${navigator.userAgent || ""} ${
    (navigator as Navigator & { platform?: string }).platform || ""
  }`;
  if (/Win/i.test(ua)) return "win";
  if (/Mac/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua)) return "mac";
  if (/Linux|X11/i.test(ua) && !/Android/i.test(ua)) return "linux";
  return "unknown";
}

/**
 * Returns the detected OS after mount. Starts as "unknown" so SSR and the
 * first client render agree (no hydration mismatch), then resolves.
 */
export function useDetectedOS(): OS {
  const [os, setOS] = useState<OS>("unknown");
  useEffect(() => {
    setOS(detectOS());
  }, []);
  return os;
}
