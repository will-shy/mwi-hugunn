import { domScheduler } from "./dom-scheduler";
import { gameData } from "./game-data";
import { i18n } from "./i18n";
import { marketStore } from "./market-store";
import { addStyle, storage } from "./storage";
import type { FeatureModule, KernelContext } from "./types";
import { getPageWindow, wsBus } from "./ws-bus";

const TOGGLES_STORAGE_KEY = "feature_toggles_v1";

interface ActiveEntry {
  module: FeatureModule;
  enabled: boolean;
  dispose?: () => void;
  unregDom?: () => void;
}

class FeatureRegistry {
  private entries = new Map<string, ActiveEntry>();
  private savedToggles: Record<string, boolean> = {};
  private initialized = false;

  constructor() {
    this.savedToggles = storage.get<Record<string, boolean>>(TOGGLES_STORAGE_KEY, {});
  }

  register(mod: FeatureModule): void {
    const saved = this.savedToggles[mod.id];
    const enabled = typeof saved === "boolean" ? saved : mod.defaultEnabled;
    this.entries.set(mod.id, { module: mod, enabled });
    if (this.initialized && enabled) {
      this.startModule(this.entries.get(mod.id)!);
    }
  }

  registerAll(mods: FeatureModule[]): void {
    for (const m of mods) {
      this.register(m);
    }
  }

  initAll(): void {
    if (this.initialized) return;
    this.initialized = true;
    for (const entry of this.entries.values()) {
      if (entry.enabled) {
        this.startModule(entry);
      }
    }
  }

  isEnabled(id: string): boolean {
    return this.entries.get(id)?.enabled ?? false;
  }

  setEnabled(id: string, enabled: boolean): void {
    const entry = this.entries.get(id);
    if (!entry || entry.enabled === enabled) return;

    entry.enabled = enabled;
    this.savedToggles[id] = enabled;
    storage.set(TOGGLES_STORAGE_KEY, this.savedToggles);

    if (enabled) {
      this.startModule(entry);
      domScheduler.scheduleRun(true);
    } else {
      this.stopModule(entry);
    }
  }

  list(): Array<{ module: FeatureModule; enabled: boolean }> {
    return Array.from(this.entries.values()).map((e) => ({
      module: e.module,
      enabled: e.enabled,
    }));
  }

  private createContext(): KernelContext {
    return {
      pageWindow: getPageWindow(),
      wsBus,
      gameData,
      marketStore,
      domScheduler,
      storage,
      i18n,
      addStyle,
      isFeatureEnabled: (id: string) => this.isEnabled(id),
    };
  }

  private startModule(entry: ActiveEntry): void {
    const ctx = this.createContext();
    try {
      const cleanup = entry.module.init(ctx);
      if (typeof cleanup === "function") {
        entry.dispose = cleanup;
      }
    } catch (err) {
      console.error(`[MWI Lite] Failed to init ${entry.module.id}:`, err);
    }

    if (typeof entry.module.onDom === "function") {
      const mod = entry.module;
      entry.unregDom = domScheduler.registerDomHandler(mod.id, mod.routes, (doc, route) => {
        mod.onDom?.(doc, route);
      });
    }
  }

  private stopModule(entry: ActiveEntry): void {
    try {
      entry.unregDom?.();
    } catch {
      // Ignore
    }
    entry.unregDom = undefined;

    try {
      entry.dispose?.();
    } catch (err) {
      console.error(`[MWI Lite] Failed to dispose ${entry.module.id}:`, err);
    }
    entry.dispose = undefined;
  }
}

export const registry = new FeatureRegistry();
