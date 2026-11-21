import type { DomScheduler, PanelRoute } from "./types";

interface DomTask {
  id: string;
  routes?: PanelRoute[];
  cb: (doc: Document, route: PanelRoute) => void;
}

function isPureLiteNode(node: Node | null): boolean {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
  const el = node as Element;
  return el.hasAttribute("data-mwi-lite") || el.closest?.("[data-mwi-lite]") !== null;
}

class SingleRafDomScheduler implements DomScheduler {
  private observer: MutationObserver | null = null;
  private tasks = new Map<string, DomTask>();
  private routeListeners = new Set<(route: PanelRoute, prevRoute: PanelRoute) => void>();
  private activeRoute: PanelRoute = "other";
  private rafId: number | null = null;
  private lastRunTs = 0;
  private cooldownTimer: number | null = null;
  private readonly minIntervalMs = 100;

  start(): void {
    if (this.observer) return;

    const attach = () => {
      if (!document.body) {
        setTimeout(attach, 20);
        return;
      }

      this.observer = new MutationObserver((mutations) => {
        let hasExternalMutation = false;
        for (let i = 0; i < mutations.length; i++) {
          const m = mutations[i];
          if (m.target instanceof Element && isPureLiteNode(m.target)) {
            continue;
          }
          if (m.addedNodes.length > 0) {
            let allLite = true;
            for (let j = 0; j < m.addedNodes.length; j++) {
              const added = m.addedNodes[j];
              if (added.nodeType === Node.ELEMENT_NODE && !isPureLiteNode(added)) {
                allLite = false;
                break;
              }
              if (added.nodeType !== Node.ELEMENT_NODE) {
                allLite = false;
                break;
              }
            }
            if (allLite) continue;
          }
          hasExternalMutation = true;
          break;
        }

        if (hasExternalMutation) {
          this.scheduleRun(false);
        }
      });

      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      this.scheduleRun(true);
    };

    attach();
  }

  private isVisible(selector: string): boolean {
    const els = document.querySelectorAll<HTMLElement>(selector);
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (el.style.display !== "none" && !el.hidden && el.offsetParent !== null) return true;
    }
    return false;
  }

  private isRouteActive(route: PanelRoute): boolean {
    switch (route) {
      case "market":
        return this.isVisible('[class*="MarketplacePanel_marketplacePanel"]');
      case "labyrinth":
        return this.isVisible('[class*="LabyrinthPanel_labyrinthPanel"]');
      case "combat":
        return (
          this.isVisible('[class*="BattlePanel_"]') ||
          this.isVisible('[class*="CombatPanel_"]') ||
          this.isVisible('[class*="DungeonPanel_"]')
        );
      case "tasks":
        return this.isVisible('[class*="TasksPanel_"]');
      case "house":
        return this.isVisible('[class*="HousePanel_"]');
      case "guild":
        return this.isVisible('[class*="GuildPanel_guildPanel"]');
      case "production":
        return (
          this.isVisible('[class*="GatheringProductionSkillPanel_"]') ||
          this.isVisible('[class*="SkillActionDetail_"]') ||
          this.isVisible('[class*="EnhancingPanel_"]') ||
          this.isVisible('[class*="AlchemyPanel_"]')
        );
      case "calculator":
        return this.isVisible("#mwi-lite-calculator-panel");
      default:
        return false;
    }
  }

  detectRoute(): PanelRoute {
    // Check active route first to avoid 7 unnecessary DOM layout queries during bursts
    if (this.activeRoute !== "other" && this.isRouteActive(this.activeRoute)) {
      return this.activeRoute;
    }
    const order: PanelRoute[] = ["market", "labyrinth", "combat", "tasks", "house", "guild", "production", "calculator"];
    for (const r of order) {
      if (r !== this.activeRoute && this.isRouteActive(r)) {
        return r;
      }
    }
    return "other";
  }

  getActiveRoute(): PanelRoute {
    return this.activeRoute;
  }

  registerDomHandler(
    id: string,
    routes: PanelRoute[] | undefined,
    cb: (doc: Document, route: PanelRoute) => void
  ): () => void {
    this.tasks.set(id, { id, routes, cb });
    this.scheduleRun(true);
    return () => {
      this.tasks.delete(id);
    };
  }

  onRouteChange(cb: (route: PanelRoute, prevRoute: PanelRoute) => void): () => void {
    this.routeListeners.add(cb);
    return () => this.routeListeners.delete(cb);
  }

  scheduleRun(immediate = false): void {
    if (immediate) {
      this.flush();
      return;
    }

    const now = performance.now();
    const elapsed = now - this.lastRunTs;
    if (elapsed < this.minIntervalMs) {
      if (this.cooldownTimer === null) {
        this.cooldownTimer = window.setTimeout(() => {
          this.cooldownTimer = null;
          this.queueRaf();
        }, Math.max(16, this.minIntervalMs - elapsed));
      }
      return;
    }

    this.queueRaf();
  }

  private queueRaf(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.flush();
    });
  }

  private flush(): void {
    if (!document.body) return;
    this.lastRunTs = performance.now();

    const prevRoute = this.activeRoute;
    const nextRoute = this.detectRoute();
    if (nextRoute !== prevRoute) {
      this.activeRoute = nextRoute;
      for (const fn of this.routeListeners) {
        try {
          fn(nextRoute, prevRoute);
        } catch (err) {
          console.error("[MWI Lite domScheduler] route listener error:", err);
        }
      }
    }

    for (const task of this.tasks.values()) {
      if (task.routes && !task.routes.includes(nextRoute)) {
        continue;
      }
      try {
        task.cb(document, nextRoute);
      } catch (err) {
        console.error(`[MWI Lite domScheduler] task error (${task.id}):`, err);
      }
    }
  }
}

export const domScheduler: DomScheduler = new SingleRafDomScheduler();
