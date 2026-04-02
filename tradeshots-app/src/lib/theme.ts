/**
 * Client-side theme helpers: read/write `localStorage`, apply `data-theme` on `<html>`,
 * and briefly add `theme-changing` to suppress transition flicker (see `globals.css`).
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
  const root = document.documentElement;

  // Prevent visible flicker by disabling transitions for one frame while
  // the data-theme attribute swaps and styles recalculate.
  root.classList.add("theme-changing");
  document.documentElement.setAttribute("data-theme", theme);
  window.setTimeout(() => {
    root.classList.remove("theme-changing");
  }, 80);
}

export function setStoredTheme(theme: ThemeMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export function toggleTheme(current: ThemeMode): ThemeMode {
  return current === "dark" ? "light" : "dark";
}

