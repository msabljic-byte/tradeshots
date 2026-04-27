"use client";

import { useCallback, useState } from "react";

const STORAGE_KEY = "shirumi-recent-attribute-keys";
const MAX_RECENT = 3;

export function useRecentAttributes() {
  const [recent, setRecent] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter((v): v is string => typeof v === "string");
        }
      }
    } catch {
      // localStorage unavailable or corrupted - silently start empty.
    }
    return [];
  });

  const recordKey = useCallback((key: string) => {
    setRecent((prev) => {
      // Move to front and cap at MAX_RECENT.
      const filtered = prev.filter((k) => k !== key);
      const next = [key, ...filtered].slice(0, MAX_RECENT);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // localStorage write failed - keep in-memory state.
      }
      return next;
    });
  }, []);

  return { recent, recordKey };
}
