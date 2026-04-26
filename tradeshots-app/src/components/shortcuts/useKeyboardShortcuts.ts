"use client";

import { useEffect, useRef } from "react";

type ShortcutMap = {
  onTogglePalette?: () => void;
  onFocusSearch?: () => void;
  onOpenHelp?: () => void;
  onEscape?: () => void;
};

export function useKeyboardShortcuts(handlers: ShortcutMap) {
  // Use a ref to avoid re-binding the document listener on every
  // handler change. Keeps the bound listener stable across renders.
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // NEVER intercept paste - reserved for screenshot upload
      if ((e.metaKey || e.ctrlKey) && e.key === "v") return;

      // Cmd/Ctrl+K - toggles palette, works ALWAYS even in inputs
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        handlersRef.current.onTogglePalette?.();
        return;
      }

      // Escape - works ALWAYS
      if (e.key === "Escape") {
        handlersRef.current.onEscape?.();
        return;
      }

      // Single-key shortcuts - only when NOT typing
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable;
      if (isTyping) return;

      if (e.key === "/") {
        e.preventDefault();
        handlersRef.current.onFocusSearch?.();
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        handlersRef.current.onOpenHelp?.();
        return;
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
