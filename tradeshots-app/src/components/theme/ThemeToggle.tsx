"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import {
  applyTheme,
  getStoredTheme,
  setStoredTheme,
  toggleTheme,
  type ThemeMode,
} from "@/lib/theme";

function getSystemTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>("light");

  useEffect(() => {
    const storedTheme = getStoredTheme();
    const nextTheme = storedTheme ?? getSystemTheme();
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }, []);

  const isDark = theme === "dark";

  const handleToggle = () => {
    const nextTheme = toggleTheme(theme);
    setTheme(nextTheme);
    applyTheme(nextTheme);
    setStoredTheme(nextTheme);
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="fixed right-4 top-4 z-50 inline-flex h-10 w-10 items-center justify-center rounded-full border shadow-sm"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderColor: "var(--border-default)",
        color: "var(--text-primary)",
      }}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
