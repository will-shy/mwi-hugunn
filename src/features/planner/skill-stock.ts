// Credit: Skill page stock badges inspired by Toolasha (Celasha, CC-BY-NC-SA-4.0).
import type { FeatureModule, KernelContext } from "../../core/types";
import {
  buildInventoryCountMap,
  buildLocalizedNameLookup,
  formatActionCount,
  type LocalizedNameLookup,
  resolveActionOutputHrids,
} from "./planner-utils";

const STOCK_BADGE_CLASS = "mwi-lite-skill-stock";

interface SkillActionCache {
  clientRef: any;
  byKey: Map<string, string>;
  lookup: LocalizedNameLookup;
}

function buildSkillActionCache(ctx: KernelContext, clientData: any): SkillActionCache {
  const byKey = new Map<string, string>();
  const actionMap = clientData?.actionDetailMap || {};

  for (const [hrid, act] of Object.entries<any>(actionMap)) {
    if (!act || act.type === "/action_types/combat") continue;
    const key = hrid.split("/").pop() || "";
    if (key && !byKey.has(key)) byKey.set(key, hrid);
  }
  return {
    clientRef: clientData,
    byKey,
    lookup: buildLocalizedNameLookup(ctx),
  };
}

function resolveTileOutputs(tile: Element, clientData: any, cache: SkillActionCache): string[] {
  const itemMap = clientData?.itemDetailMap || {};
  const uses = tile.querySelectorAll("use");
  let spriteType: "items" | "actions" | "" = "";
  let key = "";

  for (const u of uses) {
    if (u.closest("[data-mwi-lite]")) continue;
    const href = u.getAttribute("href") || u.getAttribute("xlink:href") || "";
    const hashIdx = href.indexOf("#");
    if (hashIdx < 0) continue;
    key = href.slice(hashIdx + 1).trim();
    if (href.includes("items_sprite")) spriteType = "items";
    else if (href.includes("actions_sprite")) spriteType = "actions";
    if (key) break;
  }

  if (spriteType === "items" && key) {
    const actionHrid = cache.byKey.get(key);
    if (actionHrid) {
      const outs = resolveActionOutputHrids(actionHrid, clientData);
      if (outs.length > 0) return outs;
    }
    const itemHrid = `/items/${key}`;
    return itemMap[itemHrid] ? [itemHrid] : [];
  }

  if (spriteType === "actions" && key) {
    const actionHrid = cache.byKey.get(key);
    if (actionHrid) return resolveActionOutputHrids(actionHrid, clientData);
  }

  const name = tile.querySelector('[class*="SkillAction_name"]')?.textContent?.trim() || "";
  if (name) {
    const candidates = cache.lookup.actionNameToHrids.get(name.toLowerCase()) || [];
    for (const hrid of candidates) {
      const outs = resolveActionOutputHrids(hrid, clientData);
      if (outs.length > 0) return outs;
    }
  }
  return [];
}

export function createSkillStockModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let cache: SkillActionCache | null = null;
  let refreshTimer: number | null = null;

  const updateBadges = () => {
    if (!ctx) return;
    const tiles = document.querySelectorAll(
      '[class*="GatheringProductionSkillPanel_"] [class*="SkillAction_skillAction"]'
    );
    if (!tiles.length) return;

    const clientData = ctx.gameData.getClientData();
    if (!clientData) return;
    if (!cache || cache.clientRef !== clientData) {
      cache = buildSkillActionCache(ctx, clientData);
    }

    const invCounts = buildInventoryCountMap(ctx);

    for (const tile of tiles) {
      const outputHrids = resolveTileOutputs(tile, clientData, cache);
      const existing = tile.querySelector<HTMLElement>(`.${STOCK_BADGE_CLASS}`);

      if (outputHrids.length === 0) {
        existing?.remove();
        continue;
      }

      let text = "";
      let tooltip = "";
      let isMulti = false;
      let isZero = false;

      if (outputHrids.length === 1) {
        const hrid = outputHrids[0];
        const count = invCounts.get(hrid) || 0;
        const itemName = cache.lookup.getItemName(hrid);
        text = formatActionCount(count);
        tooltip = `${itemName}: ${count.toLocaleString()}`;
        isZero = count === 0;
      } else {
        isMulti = true;
        let total = 0;
        const lines: string[] = [];
        for (const hrid of outputHrids) {
          const count = invCounts.get(hrid) || 0;
          total += count;
          lines.push(`${cache.lookup.getItemName(hrid)}: ${count.toLocaleString()}`);
        }
        text = `Σ${formatActionCount(total)}`;
        tooltip = lines.join("\n");
        isZero = total === 0;
      }

      const sig = `${text}|${isMulti ? 1 : 0}|${isZero ? 1 : 0}|${tooltip}`;
      if (existing && existing.dataset.mwiStockSig === sig) {
        continue;
      }

      const badge = existing || document.createElement("div");
      if (!existing) {
        badge.className = STOCK_BADGE_CLASS;
        badge.setAttribute("data-mwi-lite", "1");
        tile.appendChild(badge);
      }
      badge.dataset.mwiStockSig = sig;
      badge.dataset.multi = isMulti ? "1" : "0";
      badge.dataset.zero = isZero ? "1" : "0";
      badge.textContent = text;
      badge.title = tooltip;
    }
  };

  const scheduleUpdate = () => {
    if (refreshTimer !== null) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      updateBadges();
    }, 80);
  };

  return {
    id: "planner-skill-stock",
    nameZh: "技能页仓库库存显示",
    nameEn: "Skill Page Item Count",
    descriptionZh:
      "在挤奶、采摘、伐木、制作等技能页每个动作卡片右下角直接显示仓库现有产物数量（多掉落区显示总计与明细提示）。",
    descriptionEn:
      "Displays current inventory stock badges directly on skill action tiles (with breakdown tooltip for multi-drop zones).",
    category: "planner",
    defaultEnabled: true,
    routes: ["production"],

    init(context) {
      ctx = context;
      const unregStyle = context.addStyle(
        "planner-skill-stock-css",
        `
        [class*="GatheringProductionSkillPanel_"] [class*="SkillAction_skillAction"]:has(.${STOCK_BADGE_CLASS}) {
          position: relative !important;
        }
        .${STOCK_BADGE_CLASS} {
          position: absolute;
          right: 4px;
          bottom: 4px;
          z-index: 2;
          pointer-events: auto;
          padding: 1px 5px;
          font-size: 11px;
          font-weight: 700;
          line-height: 1.3;
          font-family: var(--mwi-px-mono, monospace);
          background: rgba(12, 18, 40, 0.88);
          border: 1px solid var(--mwi-px-border, #9dbbff);
          color: #a5f3fc;
          box-shadow: 0 0 0 1px #060913;
          white-space: nowrap;
        }
        .${STOCK_BADGE_CLASS}[data-multi="1"] {
          border-color: var(--mwi-px-gold, #fde047);
          color: #fef08a;
        }
        .${STOCK_BADGE_CLASS}[data-zero="1"] {
          border-color: #475569;
          color: #64748b;
          opacity: 0.78;
        }
        `
      );
      const unsubs = [
        context.gameData.on("items_updated", scheduleUpdate),
        context.gameData.on("character_initialized", () => {
          cache = null;
          scheduleUpdate();
        }),
      ];

      return () => {
        if (refreshTimer !== null) {
          window.clearTimeout(refreshTimer);
          refreshTimer = null;
        }
        unsubs.forEach((u) => u());
        unregStyle();
        cache = null;
        document.querySelectorAll(`.${STOCK_BADGE_CLASS}`).forEach((el) => el.remove());
        ctx = null;
      };
    },

    onDom() {
      updateBadges();
    },
  };
}
