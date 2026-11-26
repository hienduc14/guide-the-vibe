// Light / dark: an explicit choice is stored and set as data-theme on <html>; without one the OS decides.

const KEY = "gtv.theme";

export function isDark(): boolean {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function toggleTheme(): boolean {
  const next = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
  return next === "dark";
}
