import type { FeatureModule, KernelContext } from "../../core/types";
import {
  ToolashaNetworthEvaluator,
  type NetWorthBreakdown,
  type NetWorthPricingMode,
} from "./networth-valuation";

const MARKET_TAX = 0.02;
const NW_BADGE_ID = "mwi-lite-networth-badge";
const NW_POPOVER_ID = "mwi-lite-networth-popover";

const DUNGEON_TOKENS = new Set([
  "/items/chimerical_token",
  "/items/sinister_token",
  "/items/enchanted_token",
  "/items/pirate_token",
]);
const TASK_TOKEN = "/items/task_token";

function formatCoins(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return Math.round(n).toLocaleString();
}

export function createTooltipEvModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let unregStyle: (() => void) | null = null;
  let unregPrice: (() => void) | null = null;
  let evCache = new Map<string, number>();
  let evCacheTs = 0;
  let lastHoveredCount = 1;
  let lastHoveredEnh = 0;

  const computeAllContainerEVs = () => {
    if (!ctx) return;
    const clientData = ctx.gameData.getClientData();
    const dropMap = clientData?.openableLootDropMap;
    if (!dropMap || !ctx.marketStore.isPricesLoaded()) return;

    const now = Date.now();
    if (evCache.size > 0 && now - evCacheTs < 120_000) return;

    const nextCache = new Map<string, number>();
    // 3-pass nested convergence (e.g. Purple's Gift -> other chests)
    for (let pass = 0; pass < 3; pass++) {
      for (const [containerHrid, table] of Object.entries<any[]>(dropMap)) {
        if (!Array.isArray(table)) continue;
        let ev = 0;
        for (const drop of table) {
          const rate = drop.dropRate || 0;
          const avgCnt = ((drop.minCount || 0) + (drop.maxCount || 0)) / 2;
          if (rate <= 0 || avgCnt <= 0) continue;

          let unitVal = 0;
          if (drop.itemHrid === "/items/coin") {
            unitVal = 1;
          } else {
            const p = ctx.marketStore.getPrice(drop.itemHrid, 0);
            const raw = p?.bid ?? p?.ask ?? nextCache.get(drop.itemHrid) ?? 0;
            const itemDetail = clientData.itemDetailMap?.[drop.itemHrid];
            const sellable = itemDetail && itemDetail.isTradable !== false;
            unitVal = sellable ? raw * (1 - MARKET_TAX) : raw;
          }
          ev += rate * avgCnt * unitVal;
        }
        nextCache.set(containerHrid, ev);
      }
    }

    evCache = nextCache;
    evCacheTs = now;
  };

  const getTokenBestValue = (tokenHrid: string): { bestName: string; goldPerToken: number } | null => {
    if (!ctx) return null;
    const clientData = ctx.gameData.getClientData();
    if (!clientData) return null;

    const shopMap =
      tokenHrid === TASK_TOKEN ? clientData.taskShopItemDetailMap : clientData.shopItemDetailMap;
    if (!shopMap) return null;

    let best: { bestName: string; goldPerToken: number } | null = null;
    for (const shopItem of Object.values<any>(shopMap)) {
      if (!shopItem?.costs || !Array.isArray(shopItem.costs)) continue;
      const tokenCostObj = shopItem.costs.find((c: any) => c.itemHrid === tokenHrid);
      if (!tokenCostObj || !tokenCostObj.count) continue;

      const outHrid = shopItem.itemHrid;
      let val = 0;
      const p = ctx.marketStore.getPrice(outHrid, 0);
      if (p?.bid || p?.ask) {
        val = (p.bid ?? p.ask ?? 0) * (1 - MARKET_TAX);
      } else {
        val = evCache.get(outHrid) ?? 0;
      }
      if (val <= 0) continue;
      const gpt = val / tokenCostObj.count;
      if (!best || gpt > best.goldPerToken) {
        best = { bestName: ctx.i18n.getItemName(outHrid), goldPerToken: gpt };
      }
    }
    return best;
  };

  const onPointerOver = (ev: Event) => {
    const target = ev.target as Element | null;
    const itemBox = target?.closest?.('[class*="Item_itemContainer"], [class*="Item_item"]');
    if (!itemBox) {
      lastHoveredCount = 1;
      lastHoveredEnh = 0;
      return;
    }
    const countTxt = itemBox.querySelector('[class*="Item_count"]')?.textContent?.trim() || "";
    const numMatch = countTxt.replace(/,/g, "").match(/^([\d.]+)([KMB]?)$/i);
    if (numMatch) {
      const n = parseFloat(numMatch[1]);
      const mult =
        numMatch[2].toUpperCase() === "B"
          ? 1e9
          : numMatch[2].toUpperCase() === "M"
            ? 1e6
            : numMatch[2].toUpperCase() === "K"
              ? 1e3
              : 1;
      lastHoveredCount = Math.max(1, Math.round(n * mult));
    } else {
      lastHoveredCount = 1;
    }

    const enhTxt = itemBox.querySelector('[class*="Item_enhancementLevel"]')?.textContent || "";
    lastHoveredEnh = Number(enhTxt.replace(/\+/g, "").trim()) || 0;
  };

  const decorateTooltip = (tooltip: Element) => {
    if (!ctx) return;
    if (tooltip.querySelector(".mwi-lite-tooltip-box")) return;

    const nameEl =
      tooltip.querySelector('[class*="ItemTooltipText_name"]') ||
      tooltip.querySelector('[class*="Collection_name"]');
    if (!nameEl) return;

    const rawName = (nameEl.textContent || "").trim();
    const enhMatch = rawName.match(/\s+\+(\d+)$/);
    const enh = enhMatch ? Number(enhMatch[1]) : lastHoveredEnh;
    const cleanName = enhMatch ? rawName.slice(0, enhMatch.index).trim() : rawName;

    const itemHrid = ctx.i18n.getItemHridByName(cleanName);
    if (!itemHrid) return;

    computeAllContainerEVs();

    const price = ctx.marketStore.getPrice(itemHrid, enh);
    const ev = enh === 0 ? evCache.get(itemHrid) : undefined;
    const tokenBest =
      DUNGEON_TOKENS.has(itemHrid) || itemHrid === TASK_TOKEN ? getTokenBestValue(itemHrid) : null;

    if (!price && !ev && !tokenBest) return;

    const lines: string[] = [];
    if (price && (price.ask !== null || price.bid !== null)) {
      const askStr = price.ask !== null ? formatCoins(price.ask) : "-";
      const bidStr = price.bid !== null ? formatCoins(price.bid) : "-";
      lines.push(`<div>Ask: <b>${askStr}</b> · Bid: <b>${bidStr}</b></div>`);
      if (lastHoveredCount > 1) {
        const unit = price.bid ?? price.ask ?? 0;
        if (unit > 0) {
          lines.push(
            `<div class="sub">${ctx.i18n.t("堆叠估值", "Stack")} (×${lastHoveredCount.toLocaleString()}): <b>${formatCoins(unit * lastHoveredCount)}</b></div>`
          );
        }
      }
    }
    if (ev && ev > 0) {
      lines.push(
        `<div class="ev">${ctx.i18n.t("期望开箱价值 (税后)", "Expected Value (after tax)")}: <b>${formatCoins(ev)}</b></div>`
      );
    }
    if (tokenBest) {
      lines.push(
        `<div class="token">${ctx.i18n.t("最优兑换", "Best Exchange")}: ${tokenBest.bestName} (<b>${formatCoins(tokenBest.goldPerToken)}</b>/币)</div>`
      );
    }

    const box = document.createElement("div");
    box.className = "mwi-lite-tooltip-box";
    box.setAttribute("data-mwi-lite", "1");
    box.innerHTML = lines.join("");

    const host =
      tooltip.querySelector('[class*="ItemTooltipText_itemTooltipText"]') ||
      tooltip.querySelector('[class*="Collection_tooltipContent"]') ||
      nameEl.parentElement;
    host?.appendChild(box);
  };

  return {
    id: "economy-tooltip-ev",
    nameZh: "悬浮窗估价与开箱 EV",
    nameEn: "Tooltip Market Prices & EV",
    descriptionZh: "鼠标悬停物品时显示 Ask/Bid 价格、堆叠估值、宝箱期望收益及代币兑换性价比",
    descriptionEn: "Show Ask/Bid prices, stack total, openable EV, and token exchange value on tooltips",
    category: "market",
    defaultEnabled: true,

    init(context) {
      ctx = context;
      unregStyle = ctx.addStyle(
        "economy-tooltip-ev",
        `
        .mwi-lite-tooltip-box {
          margin-top: 6px;
          padding: 5px 6px;
          border-top: 2px solid var(--mwi-px-border-inner, #4f6fc4);
          background: rgba(12, 18, 40, 0.72);
          font-size: 11.5px;
          font-family: var(--mwi-px-mono, monospace);
          font-variant-numeric: tabular-nums;
          line-height: 1.45;
          color: var(--mwi-px-text, #e2e8f0);
        }
        .mwi-lite-tooltip-box b { color: var(--mwi-px-gold, #fde047); }
        .mwi-lite-tooltip-box .ev b { color: var(--mwi-px-green, #4ade80); }
        .mwi-lite-tooltip-box .token b { color: var(--mwi-px-accent, #93c5fd); }
        `
      );

      document.addEventListener("pointerover", onPointerOver, { passive: true, capture: true });
      unregPrice = ctx.marketStore.onPriceUpdate(() => {
        evCacheTs = 0;
      });

      return () => {
        document.removeEventListener("pointerover", onPointerOver, true);
        unregPrice?.();
        unregPrice = null;
        unregStyle?.();
        unregStyle = null;
        document.querySelectorAll(".mwi-lite-tooltip-box").forEach((el) => el.remove());
      };
    },

    onDom(doc) {
      const tooltips = doc.querySelectorAll(".MuiTooltip-popper");
      if (!tooltips.length) return;
      tooltips.forEach(decorateTooltip);
    },
  };
}

export function createNetworthModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let unregStyle: (() => void) | null = null;
  let unsubs: Array<() => void> = [];
  let throttleTimer: number | null = null;
  let lastComputeTs = 0;
  let evaluator = new ToolashaNetworthEvaluator();
  let pricingMode: NetWorthPricingMode = "ask";
  let lastBreakdown: NetWorthBreakdown = {
    pricingMode: "ask",
    coins: 0,
    inventory: 0,
    equipped: 0,
    listings: 0,
    currentAssets: 0,
    houses: 0,
    abilities: 0,
    abilityBooks: 0,
    fixedAssets: 0,
    total: 0,
  };
  let popoverOpen = false;
  let outsideListenersActive = false;

  const setPopoverOpen = (next: boolean) => {
    popoverOpen = next;
    if (popoverOpen && !outsideListenersActive) {
      document.addEventListener("pointerdown", onOutsidePointerDown, true);
      document.addEventListener("keydown", onKeyDown);
      outsideListenersActive = true;
    } else if (!popoverOpen && outsideListenersActive) {
      document.removeEventListener("pointerdown", onOutsidePointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      outsideListenersActive = false;
    }
    renderPopover();
  };

  const onOutsidePointerDown = (e: Event) => {
    if (!popoverOpen) return;
    const target = e.target as Node | null;
    if (!target) return;
    const pop = document.getElementById(NW_POPOVER_ID);
    const badge = document.getElementById(NW_BADGE_ID);
    if (pop?.contains(target) || badge?.contains(target)) return;
    setPopoverOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && popoverOpen) {
      setPopoverOpen(false);
    }
  };

  const computeNetWorth = (): NetWorthBreakdown => {
    if (!ctx) return lastBreakdown;
    lastBreakdown = evaluator.compute(ctx.gameData, ctx.marketStore, pricingMode);
    lastComputeTs = Date.now();
    renderBadge();
    return lastBreakdown;
  };

  const scheduleCompute = () => {
    if (throttleTimer !== null) return;
    const elapsed = Date.now() - lastComputeTs;
    // Defer computation so burst WS frames (e.g. Claim All) coalesce without blocking WS handlers
    const delay = elapsed >= 2000 ? 160 : Math.max(160, 2000 - elapsed);
    throttleTimer = window.setTimeout(() => {
      throttleTimer = null;
      computeNetWorth();
    }, delay);
  };

  const renderBadge = () => {
    if (!ctx || !document.body) return;
    let badge = document.getElementById(NW_BADGE_ID);
    const headerLevel = document.querySelector('[class*="Header_totalLevel"]');
    if (!headerLevel?.parentElement) return;

    if (!badge) {
      badge = document.createElement("span");
      badge.id = NW_BADGE_ID;
      badge.setAttribute("data-mwi-lite", "1");
      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        setPopoverOpen(!popoverOpen);
      });
      headerLevel.parentElement.insertBefore(badge, headerLevel.nextSibling);
    }

    badge.textContent = `💰 ${formatCoins(lastBreakdown.total)}`;
    badge.title = ctx.i18n.t("点击查看/收起净资产明细", "Click to toggle Net Worth breakdown");

    if (popoverOpen) renderPopover();
  };

  const renderPopover = () => {
    if (!ctx) return;
    let pop = document.getElementById(NW_POPOVER_ID);
    if (!popoverOpen) {
      pop?.remove();
      return;
    }
    if (!pop) {
      pop = document.createElement("div");
      pop.id = NW_POPOVER_ID;
      pop.setAttribute("data-mwi-lite", "1");
      document.body.appendChild(pop);
    }
    const badge = document.getElementById(NW_BADGE_ID);
    if (badge) {
      const rect = badge.getBoundingClientRect();
      const top = Math.max(8, Math.min(window.innerHeight - 280, Math.round(rect.bottom + 8)));
      const right = Math.max(12, Math.round(window.innerWidth - rect.right));
      pop.style.top = `${top}px`;
      pop.style.right = `${right}px`;
    }
    const b = lastBreakdown;
    const modeLabel =
      b.pricingMode === "ask"
        ? ctx.i18n.t("卖一价 Ask", "Ask")
        : ctx.i18n.t("买一价 Bid", "Bid");
    pop.innerHTML = `
      <div class="mwi-lite-nw-header">
        <span class="mwi-lite-nw-title">${ctx.i18n.t("净资产估算 (Toolasha 对齐)", "Net Worth Breakdown")}</span>
        <div class="mwi-lite-nw-actions">
          <button type="button" class="mwi-lite-nw-mode" title="${ctx.i18n.t("切换 Ask/Bid 计价模式", "Switch Ask/Bid pricing")}">${modeLabel}</button>
          <button type="button" class="mwi-lite-nw-close" aria-label="Close">✕</button>
        </div>
      </div>
      <div class="mwi-lite-nw-section">${ctx.i18n.t("流动资产 (Current Assets)", "Current Assets")}</div>
      <div class="mwi-lite-nw-row"><span>${ctx.i18n.t("现金金币", "Coins")}</span><b>${formatCoins(b.coins)}</b></div>
      <div class="mwi-lite-nw-row"><span>${ctx.i18n.t("仓库库存", "Inventory")}</span><b>${formatCoins(b.inventory)}</b></div>
      <div class="mwi-lite-nw-row"><span>${ctx.i18n.t("身上装备", "Equipped")}</span><b>${formatCoins(b.equipped)}</b></div>
      <div class="mwi-lite-nw-row"><span>${ctx.i18n.t("市场挂单", "Market Orders")}</span><b>${formatCoins(b.listings)}</b></div>
      <div class="mwi-lite-nw-subtotal"><span>${ctx.i18n.t("流动资产小计", "Current Subtotal")}</span><b>${formatCoins(b.currentAssets)}</b></div>
      <div class="mwi-lite-nw-section">${ctx.i18n.t("固定资产 (Fixed Assets)", "Fixed Assets")}</div>
      <div class="mwi-lite-nw-row"><span>${ctx.i18n.t("房屋建造", "Houses")}</span><b>${formatCoins(b.houses)}</b></div>
      <div class="mwi-lite-nw-row"><span>${ctx.i18n.t("已学技能", "Learned Abilities")}</span><b>${formatCoins(b.abilities)}</b></div>
      <div class="mwi-lite-nw-row"><span>${ctx.i18n.t("背包技能书", "Ability Books")}</span><b>${formatCoins(b.abilityBooks)}</b></div>
      <div class="mwi-lite-nw-subtotal"><span>${ctx.i18n.t("固定资产小计", "Fixed Subtotal")}</span><b>${formatCoins(b.fixedAssets)}</b></div>
      <div class="mwi-lite-nw-total"><span>${ctx.i18n.t("净资产总计", "Total Net Worth")}</span><b>${formatCoins(b.total)}</b></div>
    `;

    pop.querySelector(".mwi-lite-nw-close")?.addEventListener("click", (e) => {
      e.stopPropagation();
      setPopoverOpen(false);
    });
    pop.querySelector(".mwi-lite-nw-mode")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!ctx) return;
      pricingMode = pricingMode === "ask" ? "bid" : "ask";
      ctx.storage.set("networth_pricing_mode", pricingMode);
      evaluator.invalidate();
      computeNetWorth();
    });
  };

  return {
    id: "economy-networth",
    nameZh: "实时净资产统计",
    nameEn: "Net Worth Tracker",
    descriptionZh: "对齐 Toolasha 算法汇总流动与固定资产（房屋、技能、强化期望成本、2秒节流更新）",
    descriptionEn: "Toolasha-aligned live Net Worth across current & fixed assets",
    category: "market",
    defaultEnabled: true,

    init(context) {
      ctx = context;
      pricingMode = ctx.storage.get<NetWorthPricingMode>("networth_pricing_mode", "ask");
      evaluator = new ToolashaNetworthEvaluator();
      unregStyle = ctx.addStyle(
        "economy-networth",
        `
        #${NW_BADGE_ID} {
          display: inline-flex;
          align-items: center;
          margin-left: 8px;
          padding: 2px 8px;
          border-radius: 0;
          background: var(--mwi-px-card-bg, linear-gradient(180deg, #17244d 0%, #0e1634 100%));
          border: 2px solid var(--mwi-px-gold, #fde047);
          box-shadow: 0 0 0 1px #070b16, inset 1px 1px 0 #7c580c;
          color: var(--mwi-px-gold, #fde047);
          font-family: var(--mwi-px-mono, monospace);
          font-variant-numeric: tabular-nums;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
          user-select: none;
        }
        #${NW_POPOVER_ID} {
          position: fixed;
          top: 48px;
          right: 20px;
          z-index: 9600;
          min-width: 280px;
          background: var(--mwi-px-panel-bg, linear-gradient(180deg, #121c3b 0%, #0c1228 100%));
          border: 2px solid var(--mwi-px-border-bright, #d5e5ff);
          border-radius: 0;
          padding: 10px 12px;
          color: var(--mwi-px-text, #e2e8f0);
          font-family: var(--mwi-px-mono, monospace);
          font-variant-numeric: tabular-nums;
          font-size: 12px;
          box-shadow: var(--mwi-px-shadow-panel, 0 0 0 2px #060913);
        }
        #${NW_POPOVER_ID} .mwi-lite-nw-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding-bottom: 6px;
          border-bottom: 2px solid var(--mwi-px-border-inner, #4f6fc4);
          margin-bottom: 8px;
        }
        #${NW_POPOVER_ID} .mwi-lite-nw-title {
          font-weight: 800;
          color: var(--mwi-px-gold, #fde047);
          text-shadow: 1px 1px 0 #070b16;
        }
        #${NW_POPOVER_ID} .mwi-lite-nw-actions {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        #${NW_POPOVER_ID} .mwi-lite-nw-mode {
          background: var(--mwi-px-btn-bg, linear-gradient(180deg, #324a8f 0%, #22356b 100%));
          border: 1px solid var(--mwi-px-border, #8eb1ff);
          box-shadow: var(--mwi-px-shadow-btn, 0 0 0 1px #080d1a);
          color: #f8fafc;
          border-radius: 0;
          font-family: inherit;
          font-size: 11px;
          font-weight: 700;
          padding: 2px 7px;
          cursor: pointer;
        }
        #${NW_POPOVER_ID} .mwi-lite-nw-close {
          background: linear-gradient(180deg, #7f1d1d 0%, #581313 100%);
          border: 1px solid #fca5a5;
          color: #ffffff;
          font-size: 11.5px;
          font-weight: 700;
          line-height: 1;
          padding: 2px 6px;
          cursor: pointer;
          border-radius: 0;
        }
        #${NW_POPOVER_ID} .mwi-lite-nw-close:hover {
          color: #ffffff;
          filter: brightness(1.1);
        }
        #${NW_POPOVER_ID} .mwi-lite-nw-section {
          margin-top: 6px;
          margin-bottom: 2px;
          font-size: 11px;
          font-weight: 800;
          color: var(--mwi-px-sub, #9dbbff);
        }
        #${NW_POPOVER_ID} .mwi-lite-nw-row,
        #${NW_POPOVER_ID} .mwi-lite-nw-subtotal,
        #${NW_POPOVER_ID} .mwi-lite-nw-total {
          display: flex;
          justify-content: space-between;
          padding: 2px 0;
        }
        #${NW_POPOVER_ID} .mwi-lite-nw-subtotal {
          margin-top: 2px;
          padding-top: 3px;
          border-top: 1px dashed #2b3f7d;
          color: #cbd5e1;
        }
        #${NW_POPOVER_ID} .mwi-lite-nw-total {
          margin-top: 6px;
          padding-top: 6px;
          border-top: 2px solid var(--mwi-px-border-inner, #4f6fc4);
          color: var(--mwi-px-gold, #fde047);
          font-weight: 800;
          font-size: 13px;
        }
        `
      );

      const onPriceUpdate = () => {
        evaluator.invalidate();
        scheduleCompute();
      };

      unsubs = [
        ctx.gameData.on("character_initialized", scheduleCompute),
        ctx.gameData.on("items_updated", scheduleCompute),
        ctx.gameData.on("market_listings_updated", scheduleCompute),
        ctx.gameData.on("house_rooms_updated", scheduleCompute),
        ctx.gameData.on("abilities_updated", scheduleCompute),
        ctx.marketStore.onPriceUpdate(onPriceUpdate),
      ];

      scheduleCompute();

      return () => {
        unsubs.forEach((u) => u());
        unsubs = [];
        unregStyle?.();
        unregStyle = null;
        if (throttleTimer !== null) {
          clearTimeout(throttleTimer);
          throttleTimer = null;
        }
        setPopoverOpen(false);
        document.getElementById(NW_BADGE_ID)?.remove();
        document.getElementById(NW_POPOVER_ID)?.remove();
      };
    },

    onDom() {
      if (!document.getElementById(NW_BADGE_ID)) {
        renderBadge();
      }
    },
  };
}
