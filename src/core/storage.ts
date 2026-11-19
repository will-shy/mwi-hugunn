import type { StorageAPI } from "./types";

declare const GM_getValue: ((key: string, def?: unknown) => unknown) | undefined;
declare const GM_setValue: ((key: string, val: unknown) => void) | undefined;
declare const GM_deleteValue: ((key: string) => void) | undefined;

const LS_PREFIX = "mwiLite_";

/**
 * Lightweight GM storage wrapper strictly intended for small settings/configs (<30 KB total).
 * Large game dictionaries or market histories must live in memory or IndexedDB, never here.
 */
export const storage: StorageAPI = {
  get<T>(key: string, fallback: T): T {
    try {
      if (typeof GM_getValue === "function") {
        const raw = GM_getValue(key, undefined);
        if (raw !== undefined && raw !== null) {
          if (typeof raw === "string" && (typeof fallback !== "string" || raw.startsWith("{") || raw.startsWith("["))) {
            try {
              return JSON.parse(raw) as T;
            } catch {
              return raw as unknown as T;
            }
          }
          return raw as T;
        }
      }
    } catch {
      // Fallback to localStorage below
    }

    try {
      const ls = localStorage.getItem(LS_PREFIX + key);
      if (ls !== null) {
        return JSON.parse(ls) as T;
      }
    } catch {
      // Ignore parse/storage errors
    }
    return fallback;
  },

  set<T>(key: string, value: T): void {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    if (serialized && serialized.length > 65536) {
      console.warn(`[MWI Lite] Refusing to persist oversized GM value (${key}: ${serialized.length} chars)`);
      return;
    }

    try {
      if (typeof GM_setValue === "function") {
        GM_setValue(key, serialized);
        return;
      }
    } catch {
      // Fallback to localStorage
    }

    try {
      localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
    } catch {
      // Ignore quota errors
    }
  },

  del(key: string): void {
    try {
      if (typeof GM_deleteValue === "function") {
        GM_deleteValue(key);
      }
    } catch {
      // Ignore
    }
    try {
      localStorage.removeItem(LS_PREFIX + key);
    } catch {
      // Ignore
    }
  },
};

export function addStyle(id: string, css: string): () => void {
  const attr = "data-mwi-lite-style";
  let styleEl = document.querySelector<HTMLStyleElement>(`style[${attr}="${id}"]`);
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.setAttribute(attr, id);
    styleEl.setAttribute("data-mwi-lite", "1");
    (document.head || document.documentElement).appendChild(styleEl);
  }
  styleEl.textContent = css;

  return () => {
    styleEl?.remove();
  };
}
