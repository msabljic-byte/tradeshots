/**
 * Client-side theme helpers: read/write `localStorage`, apply `data-theme` on `<html>`,
 * and keep persistent app-wide light/dark mode.
 */
export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";

export function getStoredTheme(): ThemeMode | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (raw === "light" || raw === "dark") return raw;
  return null;
}

export function applyTheme(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

export function setStoredTheme(theme: ThemeMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export function toggleTheme(current: ThemeMode): ThemeMode {
  return current === "dark" ? "light" : "dark";
}

