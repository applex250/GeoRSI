"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

const THEME_KEY = "geobyte-theme";
const THEME_EVENT = "geobyte-theme-change";

function themeSnapshot(): "dark" | "light" {
  return window.localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
}

function subscribeTheme(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(THEME_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(THEME_EVENT, onStoreChange);
  };
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, themeSnapshot, () => "dark");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    window.localStorage.setItem(THEME_KEY, nextTheme);
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  const isDark = theme === "dark";

  return (
    <button
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="icon-button"
      onClick={toggleTheme}
      type="button"
    >
      {isDark ? <Sun aria-hidden size={17} strokeWidth={1.6} /> : <Moon aria-hidden size={17} strokeWidth={1.6} />}
    </button>
  );
}
