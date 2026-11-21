import type { FeatureModule, KernelContext } from "../../core/types";
import {
  GUILD_CREDIT_META_MAP,
  GUILD_CREDIT_ORDER,
  buildGuildCreditCatalog,
  buildInventoryCountMap,
  evaluateGuildBuffUpgrade,
  formatCompactCoins,
  parseCompactNumber,
  rankGuildCreditItems,
  type CreditNeedSpec,
  type CreditSortKey,
  type SortDirection,
} from "./guild-credit-math";

const STYLE_ID = "market-guild-credit-rank";
const PREF_KEY = "guild_credit_rank_pref_v1";
const MAIN_PANEL_ID = "mwi-lite-guild-credit-rank";
const EXCHANGE_HINT_ID = "mwi-lite-guild-exchange-hint";
const BUFF_COST_ID = "mwi-lite-guild-buff-cost";

interface GuildRankPref {
  activeTab: string; // "all" | creditItemHrid
  sortBy: CreditSortKey;
  sortDir: SortDirection;
  ownedOnly: boolean;
  collapsed: boolean;
  buffSortMode: "ask" | "bid";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveItemsSpriteUrl(): string {
  const useEl = document.querySelector('use[href*="items_sprite"]');
  const href = useEl?.getAttribute("href") || useEl?.getAttribute("xlink:href") || "";
  if (href.includes("#")) return href.split("#")[0];
  return "/static/media/items_sprite.9c39e2ec.svg";
}

function renderItemIcon(spriteUrl: string, itemHrid: string, size = 15): string {
  const iconName = itemHrid.replace("/items/", "");
  return `<svg class="mwi-lite-gcr-ico" width="${size}" height="${size}" aria-hidden="true"><use href="${escapeHtml(spriteUrl)}#${escapeHtml(iconName)}"></use></svg>`;
}

export function createGuildShopRankModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let unregStyle: (() => void) | null = null;
  let unsubs: Array<() => void> = [];
  let priceEpoch = 0;
  let itemsEpoch = 0;
  let ensurePromisePending = false;
  let searchQuery = "";
  let showAllRows = false;
  let copyNoticeTimer: number | null = null;
  let lastMainSig = "";
  let lastExchangeSig = "";
  let lastBuffSig = "";
  let expandedBuffCredits = new Set<string>();

  let pref: GuildRankPref = {
    activeTab: "all",
    sortBy: "askPerCredit",
    sortDir: "asc",
    ownedOnly: false,
    collapsed: false,
    buffSortMode: "ask",
  };

  const savePref = () => {
    ctx?.storage.set<GuildRankPref>(PREF_KEY, pref);
  };

  const getInventoryCounts = (): Map<string, number> => {
    if (!ctx) return new Map();
    return buildInventoryCountMap(ctx.gameData.getCharacterItems());
  };

  const ensureMarketPrices = (force = false) => {
    if (!ctx || ensurePromisePending) return;
    if (!force && ctx.marketStore.isPricesLoaded()) return;
    ensurePromisePending = true;
    void ctx.marketStore
      .ensurePricesLoaded(force)
      .then((ok) => {
        if (ok) priceEpoch++;
      })
      .finally(() => {
        ensurePromisePending = false;
        ctx?.domScheduler.scheduleRun(false);
      });
  };

  const copyItemName = (itemHrid: string) => {
    if (!ctx) return;
    const name = ctx.i18n.getItemName(itemHrid);
    try {
      void navigator.clipboard?.writeText(name);
    } catch {
      // Ignore clipboard restrictions
    }
    const statusEl = document.querySelector<HTMLElement>(`#${MAIN_PANEL_ID} .mwi-lite-gcr-status`);
    if (statusEl) {
      statusEl.textContent = ctx.i18n.t(`已复制: ${name}`, `Copied: ${name}`);
      if (copyNoticeTimer !== null) clearTimeout(copyNoticeTimer);
      copyNoticeTimer = window.setTimeout(() => {
        copyNoticeTimer = null;
        if (statusEl.isConnected) statusEl.textContent = "";
      }, 1800);
    }
  };

  const renderMainPanel = () => {
    if (!ctx) return;
    const shopTab = document.querySelector<HTMLElement>('[class*="GuildPanel_shopTab__"]');
    if (!shopTab || shopTab.offsetParent === null) {
      document.getElementById(MAIN_PANEL_ID)?.remove();
      lastMainSig = "";
      return;
    }

    ensureMarketPrices(false);

    const clientData = ctx.gameData.getClientData();
    const catalog = buildGuildCreditCatalog(clientData);
    const inv = getInventoryCounts();
    const spriteUrl = resolveItemsSpriteUrl();
    const pricesLoaded = ctx.marketStore.isPricesLoaded();

    const sig = [
      priceEpoch,
      itemsEpoch,
      pricesLoaded ? 1 : 0,
      catalog.size,
      pref.activeTab,
      pref.sortBy,
      pref.sortDir,
      pref.ownedOnly ? 1 : 0,
      pref.collapsed ? 1 : 0,
      showAllRows ? 1 : 0,
      searchQuery,
    ].join("|");

    let panel = document.getElementById(MAIN_PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = MAIN_PANEL_ID;
      panel.setAttribute("data-mwi-lite", "1");

      const firstGrid = shopTab.querySelector('[class*="GuildPanel_tileGrid__"]');
      if (firstGrid?.parentElement) {
        firstGrid.parentElement.insertBefore(panel, firstGrid.nextSibling);
      } else {
        shopTab.appendChild(panel);
      }

      panel.innerHTML = `
        <div class="mwi-lite-gcr-head">
          <div class="mwi-lite-gcr-title-wrap">
            <span class="mwi-lite-gcr-title">${escapeHtml(ctx.i18n.t("信用点兑换性价比排序", "Guild Credit Exchange Ranking"))}</span>
            <span class="mwi-lite-gcr-sub">${escapeHtml(ctx.i18n.t("每点信用成本越低越划算", "Lower gold / credit = better value"))}</span>
            <span class="mwi-lite-gcr-status"></span>
          </div>
          <div class="mwi-lite-gcr-actions">
            <label class="mwi-lite-gcr-chk"><input type="checkbox" data-gcr-act="owned-only" /> <span>${escapeHtml(ctx.i18n.t("仅看库存", "Owned"))}</span></label>
            <input type="text" class="mwi-lite-gcr-search" placeholder="${escapeHtml(ctx.i18n.t("搜索物品...", "Search item..."))}" />
            <button type="button" class="mwi-lite-gcr-btn" data-gcr-act="sort-mode"></button>
            <button type="button" class="mwi-lite-gcr-btn" data-gcr-act="refresh">${escapeHtml(ctx.i18n.t("刷新行情", "Refresh"))}</button>
            <button type="button" class="mwi-lite-gcr-btn" data-gcr-act="collapse"></button>
          </div>
        </div>
        <div class="mwi-lite-gcr-tabs"></div>
        <div class="mwi-lite-gcr-body"></div>
      `;

      // Bind delegated interaction once on panel root
      const searchInput = panel.querySelector<HTMLInputElement>(".mwi-lite-gcr-search");
      searchInput?.addEventListener("input", () => {
        searchQuery = searchInput.value;
        showAllRows = false;
        renderMainPanel();
      });

      const ownedChk = panel.querySelector<HTMLInputElement>('input[data-gcr-act="owned-only"]');
      if (ownedChk) {
        ownedChk.checked = pref.ownedOnly;
        ownedChk.addEventListener("change", () => {
          pref.ownedOnly = ownedChk.checked;
          showAllRows = false;
          savePref();
          renderMainPanel();
        });
      }

      panel.addEventListener("click", (e) => {
        const target = e.target as Element | null;
        if (!target) return;

        const copyBtn = target.closest<HTMLElement>("[data-gcr-copy]");
        if (copyBtn) {
          const hrid = copyBtn.getAttribute("data-gcr-copy");
          if (hrid) copyItemName(hrid);
          return;
        }

        const tabBtn = target.closest<HTMLElement>("[data-gcr-tab]");
        if (tabBtn) {
          pref.activeTab = tabBtn.getAttribute("data-gcr-tab") || "all";
          showAllRows = false;
          savePref();
          renderMainPanel();
          return;
        }

        const sortTh = target.closest<HTMLElement>("[data-gcr-sort]");
        if (sortTh) {
          const key = sortTh.getAttribute("data-gcr-sort") as CreditSortKey;
          if (pref.sortBy === key) {
            pref.sortDir = pref.sortDir === "asc" ? "desc" : "asc";
          } else {
            pref.sortBy = key;
            pref.sortDir = key === "owned" || key === "rate" ? "desc" : "asc";
          }
          savePref();
          renderMainPanel();
          return;
        }

        const actEl = target.closest<HTMLElement>("[data-gcr-act]");
        const act = actEl?.getAttribute("data-gcr-act");
        if (!act) return;
        if (act === "collapse") {
          pref.collapsed = !pref.collapsed;
          savePref();
          renderMainPanel();
        } else if (act === "refresh") {
          ensureMarketPrices(true);
        } else if (act === "sort-mode") {
          pref.sortBy = pref.sortBy === "bidPerCredit" ? "askPerCredit" : "bidPerCredit";
          pref.sortDir = "asc";
          savePref();
          renderMainPanel();
        } else if (act === "show-all") {
          showAllRows = !showAllRows;
          renderMainPanel();
        }
      });
      lastMainSig = "";
    }

    if (sig === lastMainSig) return;
    lastMainSig = sig;

    const collapseBtn = panel.querySelector<HTMLButtonElement>('button[data-gcr-act="collapse"]');
    if (collapseBtn) {
      collapseBtn.textContent = pref.collapsed ? ctx.i18n.t("展开", "Expand") : ctx.i18n.t("收起", "Hide");
    }

    const sortModeBtn = panel.querySelector<HTMLButtonElement>('button[data-gcr-act="sort-mode"]');
    if (sortModeBtn) {
      sortModeBtn.textContent =
        pref.sortBy === "bidPerCredit"
          ? ctx.i18n.t("基准: Bid", "Sort: Bid")
          : ctx.i18n.t("基准: Ask", "Sort: Ask");
    }

    const tabsEl = panel.querySelector<HTMLElement>(".mwi-lite-gcr-tabs");
    const bodyEl = panel.querySelector<HTMLElement>(".mwi-lite-gcr-body");
    if (!tabsEl || !bodyEl) return;

    if (pref.collapsed) {
      tabsEl.style.display = "none";
      bodyEl.style.display = "none";
      return;
    }
    tabsEl.style.display = "";
    bodyEl.style.display = "";

    // Build color tabs
    const allLabel = ctx.i18n.t("全部概览 (Top 3)", "All Top 3");
    let tabsHtml = `<button type="button" class="mwi-lite-gcr-tab ${pref.activeTab === "all" ? "active" : ""}" data-gcr-tab="all">${escapeHtml(allLabel)}</button>`;
    for (const meta of GUILD_CREDIT_ORDER) {
      const ownedAmt = inv.get(meta.hrid) || 0;
      const activeCls = pref.activeTab === meta.hrid ? "active" : "";
      const label = ctx.i18n.isZh() ? meta.shortZh : meta.shortEn;
      tabsHtml += `<button type="button" class="mwi-lite-gcr-tab ${activeCls}" data-gcr-tab="${escapeHtml(meta.hrid)}" style="--gcr-accent:${meta.color}">
        ${renderItemIcon(spriteUrl, meta.hrid, 13)}
        <span>${escapeHtml(label)}</span>
        <span class="mwi-lite-gcr-tab-cnt">${escapeHtml(formatCompactCoins(ownedAmt) === "-" ? "0" : formatCompactCoins(ownedAmt))}</span>
      </button>`;
    }
    tabsEl.innerHTML = tabsHtml;

    if (!clientData) {
      bodyEl.innerHTML = `<div class="mwi-lite-gcr-empty">${escapeHtml(ctx.i18n.t("正在等待游戏基础数据加载...", "Waiting for game item data..."))}</div>`;
      return;
    }

    const primarySort: CreditSortKey = pref.sortBy === "bidPerCredit" ? "bidPerCredit" : "askPerCredit";
    const resolveName = (h: string) => ctx!.i18n.getItemName(h);

    if (pref.activeTab === "all") {
      let cardsHtml = `<div class="mwi-lite-gcr-grid">`;
      for (const meta of GUILD_CREDIT_ORDER) {
        const creditName = ctx.i18n.getItemName(meta.hrid);
        const ownedCredits = inv.get(meta.hrid) || 0;
        const top3 = rankGuildCreditItems(catalog, ctx.marketStore, inv, {
          creditItemHrid: meta.hrid,
          sortBy: primarySort,
          sortDir: "asc",
          tradableOnly: true,
          ownedOnly: pref.ownedOnly,
          searchText: searchQuery,
          resolveName,
          limit: 3,
        });

        let rowsHtml = "";
        if (top3.length === 0) {
          rowsHtml = `<div class="mwi-lite-gcr-card-empty">${escapeHtml(
            pricesLoaded
              ? ctx.i18n.t("无匹配可兑换物品", "No matching items")
              : ctx.i18n.t("行情加载中...", "Loading market prices...")
          )}</div>`;
        } else {
          rowsHtml = top3
            .map((r, idx) => {
              const name = ctx!.i18n.getItemName(r.itemHrid);
              const ownTag =
                r.owned > 0
                  ? `<span class="mwi-lite-gcr-own" title="${escapeHtml(ctx!.i18n.t("背包库存", "Inventory"))}">${escapeHtml(formatCompactCoins(r.owned))}</span>`
                  : "";
              const rateStr = `${r.itemCount}→${r.creditCount}`;
              return `<div class="mwi-lite-gcr-card-row ${r.owned > 0 ? "has-own" : ""}">
                <span class="mwi-lite-gcr-rank">#${idx + 1}</span>
                <span class="mwi-lite-gcr-item" data-gcr-copy="${escapeHtml(r.itemHrid)}" title="${escapeHtml(ctx!.i18n.t("点击复制物品名", "Click to copy item name"))}">
                  ${renderItemIcon(spriteUrl, r.itemHrid, 14)}
                  <span class="mwi-lite-gcr-name">${escapeHtml(name)}</span>
                  ${ownTag}
                </span>
                <span class="mwi-lite-gcr-rate">${escapeHtml(rateStr)}</span>
                <span class="mwi-lite-gcr-cost ${primarySort === "askPerCredit" ? "hi" : ""}">${escapeHtml(formatCompactCoins(r.askPerCredit))}</span>
                <span class="mwi-lite-gcr-cost ${primarySort === "bidPerCredit" ? "hi" : ""}">${escapeHtml(formatCompactCoins(r.bidPerCredit))}</span>
              </div>`;
            })
            .join("");
        }

        cardsHtml += `
          <div class="mwi-lite-gcr-card" style="--gcr-accent:${meta.color}">
            <div class="mwi-lite-gcr-card-hd" data-gcr-tab="${escapeHtml(meta.hrid)}" title="${escapeHtml(ctx.i18n.t("点击查看完整排序", "Click to view full ranking"))}">
              <span class="mwi-lite-gcr-card-title">${renderItemIcon(spriteUrl, meta.hrid, 15)} ${escapeHtml(creditName)}</span>
              <span class="mwi-lite-gcr-card-own">${escapeHtml(ctx.i18n.t("持有", "Own"))} ${escapeHtml(ownedCredits ? formatCompactCoins(ownedCredits) : "0")} ▸</span>
            </div>
            <div class="mwi-lite-gcr-card-cols">
              <span>#</span>
              <span>${escapeHtml(ctx.i18n.t("物品", "Item"))}</span>
              <span>${escapeHtml(ctx.i18n.t("比例", "Rate"))}</span>
              <span>Ask/pt</span>
              <span>Bid/pt</span>
            </div>
            ${rowsHtml}
          </div>
        `;
      }
      cardsHtml += `</div>`;
      bodyEl.innerHTML = cardsHtml;
      return;
    }

    // Single credit full ranked table
    const ranked = rankGuildCreditItems(catalog, ctx.marketStore, inv, {
      creditItemHrid: pref.activeTab,
      sortBy: pref.sortBy,
      sortDir: pref.sortDir,
      tradableOnly: true,
      ownedOnly: pref.ownedOnly,
      searchText: searchQuery,
      resolveName,
    });

    if (ranked.length === 0) {
      bodyEl.innerHTML = `<div class="mwi-lite-gcr-empty">${escapeHtml(
        pricesLoaded
          ? ctx.i18n.t("当前过滤条件下没有可兑换物品", "No matching convertible items")
          : ctx.i18n.t("正在获取市场行情...", "Loading market prices...")
      )}</div>`;
      return;
    }

    const MAX_PREVIEW = 40;
    const displayRows = showAllRows ? ranked : ranked.slice(0, MAX_PREVIEW);
    const arrow = (k: CreditSortKey) => (pref.sortBy === k ? (pref.sortDir === "asc" ? " ▲" : " ▼") : "");
    const thCls = (k: CreditSortKey) => (pref.sortBy === k ? "sortable active" : "sortable");

    let tableHtml = `
      <div class="mwi-lite-gcr-table-wrap">
        <table class="mwi-lite-gcr-table">
          <thead>
            <tr>
              <th>#</th>
              <th>${escapeHtml(ctx.i18n.t("物品 (点击复制)", "Item (click copy)"))}</th>
              <th class="${thCls("owned")}" data-gcr-sort="owned">${escapeHtml(ctx.i18n.t("库存", "Own") + arrow("owned"))}</th>
              <th class="${thCls("rate")}" data-gcr-sort="rate">${escapeHtml(ctx.i18n.t("兑换比", "Rate") + arrow("rate"))}</th>
              <th class="${thCls("askPrice")}" data-gcr-sort="askPrice">${escapeHtml("Ask" + arrow("askPrice"))}</th>
              <th class="${thCls("bidPrice")}" data-gcr-sort="bidPrice">${escapeHtml("Bid" + arrow("bidPrice"))}</th>
              <th class="${thCls("askPerCredit")}" data-gcr-sort="askPerCredit">${escapeHtml(ctx.i18n.t("Ask/点", "Ask/pt") + arrow("askPerCredit"))}</th>
              <th class="${thCls("bidPerCredit")}" data-gcr-sort="bidPerCredit">${escapeHtml(ctx.i18n.t("Bid/点", "Bid/pt") + arrow("bidPerCredit"))}</th>
            </tr>
          </thead>
          <tbody>
    `;

    for (let i = 0; i < displayRows.length; i++) {
      const r = displayRows[i];
      const name = ctx.i18n.getItemName(r.itemHrid);
      const rateText = `${r.itemCount} → ${r.creditCount}`;
      tableHtml += `
        <tr class="${r.owned > 0 ? "has-own" : ""}">
          <td>${i + 1}</td>
          <td class="item-cell" data-gcr-copy="${escapeHtml(r.itemHrid)}">
            ${renderItemIcon(spriteUrl, r.itemHrid, 15)}
            <span>${escapeHtml(name)}</span>
          </td>
          <td class="num ${r.owned > 0 ? "own-hi" : ""}">${r.owned > 0 ? escapeHtml(formatCompactCoins(r.owned)) : "-"}</td>
          <td class="num">${escapeHtml(rateText)}</td>
          <td class="num">${escapeHtml(formatCompactCoins(r.askPrice))}</td>
          <td class="num">${escapeHtml(formatCompactCoins(r.bidPrice))}</td>
          <td class="num ${pref.sortBy === "askPerCredit" ? "cost-hi" : ""}">${escapeHtml(formatCompactCoins(r.askPerCredit))}</td>
          <td class="num ${pref.sortBy === "bidPerCredit" ? "cost-hi" : ""}">${escapeHtml(formatCompactCoins(r.bidPerCredit))}</td>
        </tr>
      `;
    }
    tableHtml += `</tbody></table></div>`;

    if (ranked.length > MAX_PREVIEW) {
      const btnText = showAllRows
        ? ctx.i18n.t(`收起至前 ${MAX_PREVIEW} 项`, `Show top ${MAX_PREVIEW}`)
        : ctx.i18n.t(`展开全部 ${ranked.length} 项`, `Show all ${ranked.length} items`);
      tableHtml += `<div class="mwi-lite-gcr-more"><button type="button" class="mwi-lite-gcr-btn" data-gcr-act="show-all">${escapeHtml(btnText)}</button></div>`;
    }

    bodyEl.innerHTML = tableHtml;
  };

  /** Companion panel inside Guild Credit Exchange Modal */
  const renderExchangeModalHint = () => {
    if (!ctx) return;
    const modal = document.querySelector<HTMLElement>('[class*="GuildPanel_exchangeModalContent__"]');
    if (!modal || modal.offsetParent === null) {
      document.getElementById(EXCHANGE_HINT_ID)?.remove();
      lastExchangeSig = "";
      return;
    }

    // Identify target creditItemHrid from SVG <use href="...#xxx_guild_credit"> inside exchange modal
    let creditHrid = "";
    const uses = modal.querySelectorAll("use");
    for (let i = 0; i < uses.length; i++) {
      const href = uses[i].getAttribute("href") || uses[i].getAttribute("xlink:href") || "";
      const hashPart = href.split("#")[1] || "";
      const candidate = `/items/${hashPart}`;
      if (GUILD_CREDIT_META_MAP.has(candidate)) {
        creditHrid = candidate;
        break;
      }
    }
    if (!creditHrid) return;

    const sig = `${creditHrid}|${priceEpoch}|${itemsEpoch}|${pref.sortBy}`;
    let hintEl = document.getElementById(EXCHANGE_HINT_ID);
    if (hintEl && sig === lastExchangeSig) return;
    lastExchangeSig = sig;

    if (!hintEl) {
      hintEl = document.createElement("div");
      hintEl.id = EXCHANGE_HINT_ID;
      hintEl.setAttribute("data-mwi-lite", "1");
      modal.appendChild(hintEl);
    }

    const catalog = buildGuildCreditCatalog(ctx.gameData.getClientData());
    const inv = getInventoryCounts();
    const spriteUrl = resolveItemsSpriteUrl();
    const sortBy: CreditSortKey = pref.sortBy === "bidPerCredit" ? "bidPerCredit" : "askPerCredit";

    const ownedBest = rankGuildCreditItems(catalog, ctx.marketStore, inv, {
      creditItemHrid: creditHrid,
      sortBy,
      sortDir: "asc",
      tradableOnly: false,
      ownedOnly: true,
      limit: 5,
    });
    const marketBest = rankGuildCreditItems(catalog, ctx.marketStore, inv, {
      creditItemHrid: creditHrid,
      sortBy,
      sortDir: "asc",
      tradableOnly: true,
      limit: 5,
    });

    const renderMiniRows = (list: typeof ownedBest, showOwn: boolean) =>
      list
        .map((r, i) => {
          const name = ctx!.i18n.getItemName(r.itemHrid);
          const ptCost = sortBy === "bidPerCredit" ? r.bidPerCredit : r.askPerCredit;
          return `<div class="mwi-lite-gcr-mini-row">
            <span>#${i + 1}</span>
            <span class="name">${renderItemIcon(spriteUrl, r.itemHrid, 13)} ${escapeHtml(name)}</span>
            <span class="rate">${r.itemCount}→${r.creditCount}</span>
            ${showOwn ? `<span class="own">x${escapeHtml(formatCompactCoins(r.owned))}</span>` : ""}
            <span class="cost">${escapeHtml(formatCompactCoins(ptCost))}/pt</span>
          </div>`;
        })
        .join("");

    hintEl.innerHTML = `
      <div class="mwi-lite-gcr-mini-hd">${escapeHtml(ctx.i18n.t("性价比参考", "Value Reference"))} (${sortBy === "bidPerCredit" ? "Bid" : "Ask"})</div>
      ${
        ownedBest.length > 0
          ? `<div class="mwi-lite-gcr-mini-sec">${escapeHtml(ctx.i18n.t("背包已有最划算", "Best Owned in Inventory"))}</div>${renderMiniRows(ownedBest, true)}`
          : ""
      }
      <div class="mwi-lite-gcr-mini-sec">${escapeHtml(ctx.i18n.t("全市场最低单点成本", "Cheapest on Market"))}</div>
      ${marketBest.length ? renderMiniRows(marketBest, false) : `<div class="mwi-lite-gcr-card-empty">-</div>`}
    `;
  };

  /** Companion cost-breakdown table inside Shrine Buff Upgrade Modal (aligned with user reference) */
  const renderBuffModalBreakdown = () => {
    if (!ctx) return;
    const modal = document.querySelector<HTMLElement>('[class*="GuildPanel_guildModalContent__"]');
    if (!modal || modal.offsetParent === null) {
      document.getElementById(BUFF_COST_ID)?.remove();
      lastBuffSig = "";
      return;
    }

    const reqRoot = modal.querySelector('[class*="GuildPanel_costs__"] [class*="GuildPanel_itemRequirements__"]');
    if (!reqRoot) {
      document.getElementById(BUFF_COST_ID)?.remove();
      lastBuffSig = "";
      return;
    }

    // Parse credit requirements from the modal's itemRequirements triplet nodes (have, need, icon)
    const needs: CreditNeedSpec[] = [];
    const children = Array.from(reqRoot.children);
    for (let i = 0; i < children.length; i++) {
      const useEl = children[i].querySelector("use");
      if (!useEl) continue;
      const href = useEl.getAttribute("href") || useEl.getAttribute("xlink:href") || "";
      const hashId = href.split("#")[1] || "";
      const itemHrid = `/items/${hashId}`;
      if (!GUILD_CREDIT_META_MAP.has(itemHrid)) continue;

      const haveText = i >= 2 ? children[i - 2].textContent || "0" : "0";
      const needText = i >= 1 ? children[i - 1].textContent || "0" : "0";
      needs.push({
        creditItemHrid: itemHrid,
        owned: parseCompactNumber(haveText),
        required: parseCompactNumber(needText),
      });
    }

    if (needs.length === 0) {
      document.getElementById(BUFF_COST_ID)?.remove();
      lastBuffSig = "";
      return;
    }

    const needsKey = needs.map((n) => `${n.creditItemHrid}:${n.owned}:${n.required}`).join(",");
    const expandKey = Array.from(expandedBuffCredits).sort().join(",");
    const sig = `${needsKey}|${priceEpoch}|${itemsEpoch}|${pref.buffSortMode}|${expandKey}`;

    let box = document.getElementById(BUFF_COST_ID);
    if (box && sig === lastBuffSig) return;
    lastBuffSig = sig;

    if (!box) {
      box = document.createElement("div");
      box.id = BUFF_COST_ID;
      box.setAttribute("data-mwi-lite", "1");
      modal.appendChild(box);

      box.addEventListener("click", (e) => {
        const t = e.target as Element | null;
        const sortBtn = t?.closest<HTMLElement>("[data-gbuff-sort]");
        if (sortBtn) {
          const mode = sortBtn.getAttribute("data-gbuff-sort") as "ask" | "bid";
          pref.buffSortMode = mode;
          savePref();
          renderBuffModalBreakdown();
          return;
        }
        const toggleRow = t?.closest<HTMLElement>("[data-gbuff-credit]");
        if (toggleRow) {
          const cid = toggleRow.getAttribute("data-gbuff-credit");
          if (cid) {
            if (expandedBuffCredits.has(cid)) expandedBuffCredits.delete(cid);
            else expandedBuffCredits.add(cid);
            renderBuffModalBreakdown();
          }
        }
      });
    }

    const catalog = buildGuildCreditCatalog(ctx.gameData.getClientData());
    const inv = getInventoryCounts();
    const spriteUrl = resolveItemsSpriteUrl();
    const evalRes = evaluateGuildBuffUpgrade(needs, catalog, ctx.marketStore, inv, pref.buffSortMode, 3);

    let html = `
      <div class="mwi-lite-gcr-buff-hd">${escapeHtml(ctx.i18n.t("升级缺口兑换参考 — 点击列头切换排序", "Credit Deficit Cost — click Ask/Bid to sort"))}</div>
      <table class="mwi-lite-gcr-buff-tbl">
        <thead>
          <tr>
            <th>${escapeHtml(ctx.i18n.t("信用点 / Top 3 方案", "Credit / Top 3"))}</th>
            <th class="num">${escapeHtml(ctx.i18n.t("缺口/需购", "Qty"))}</th>
            <th class="num">Ask/pt</th>
            <th class="num">Bid/pt</th>
            <th class="num sortable ${pref.buffSortMode === "ask" ? "active" : ""}" data-gbuff-sort="ask">${escapeHtml("Ask cost" + (pref.buffSortMode === "ask" ? " ▲" : ""))}</th>
            <th class="num sortable ${pref.buffSortMode === "bid" ? "active" : ""}" data-gbuff-sort="bid">${escapeHtml("Bid cost" + (pref.buffSortMode === "bid" ? " ▲" : ""))}</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const row of evalRes.rows) {
      const creditName = ctx.i18n.getItemName(row.creditItemHrid);
      const best = row.topOptions[0];
      const showSub = row.deficit > 0 || expandedBuffCredits.has(row.creditItemHrid);
      html += `
        <tr class="credit-summary" data-gbuff-credit="${escapeHtml(row.creditItemHrid)}">
          <td>${renderItemIcon(spriteUrl, row.creditItemHrid, 14)} <b>${escapeHtml(creditName)}</b></td>
          <td class="num">${escapeHtml(formatCompactCoins(row.deficit) === "-" ? "0" : formatCompactCoins(row.deficit))} <span class="muted">(own ${escapeHtml(formatCompactCoins(row.owned) === "-" ? "0" : formatCompactCoins(row.owned))})</span></td>
          <td class="num">${escapeHtml(formatCompactCoins(best?.askPerCredit))}</td>
          <td class="num">${escapeHtml(formatCompactCoins(best?.bidPerCredit))}</td>
          <td class="num ${pref.buffSortMode === "ask" ? "cost-hi" : ""}">${escapeHtml(formatCompactCoins(row.bestAskCost))}</td>
          <td class="num ${pref.buffSortMode === "bid" ? "cost-hi" : ""}">${escapeHtml(formatCompactCoins(row.bestBidCost))}</td>
        </tr>
      `;
      if (showSub) {
        row.topOptions.forEach((opt, idx) => {
          const itemName = ctx!.i18n.getItemName(opt.itemHrid);
          html += `
            <tr class="credit-opt ${idx === 0 ? "best" : ""}">
              <td class="sub">↳ #${idx + 1} ${renderItemIcon(spriteUrl, opt.itemHrid, 13)} ${escapeHtml(itemName)}</td>
              <td class="num">${opt.neededItems > 0 ? escapeHtml(opt.neededItems.toLocaleString()) : "-"}</td>
              <td class="num">${escapeHtml(formatCompactCoins(opt.askPrice))}</td>
              <td class="num">${escapeHtml(formatCompactCoins(opt.bidPrice))}</td>
              <td class="num">${escapeHtml(formatCompactCoins(opt.askCost))}</td>
              <td class="num">${escapeHtml(formatCompactCoins(opt.bidCost))}</td>
            </tr>
          `;
        });
      }
    }

    html += `
        </tbody>
        <tfoot>
          <tr>
            <td colspan="4"><b>${escapeHtml(ctx.i18n.t("缺口合计估值", "Total Deficit Est."))}</b></td>
            <td class="num cost-hi"><b>${escapeHtml(formatCompactCoins(evalRes.totalAsk))}</b></td>
            <td class="num ${pref.buffSortMode === "bid" ? "cost-hi" : ""}"><b>${escapeHtml(formatCompactCoins(evalRes.totalBid))}</b></td>
          </tr>
        </tfoot>
      </table>
    `;

    box.innerHTML = html;
  };

  return {
    id: "market-guild-credit-rank",
    nameZh: "公会信用点兑换性价比排序",
    nameEn: "Guild Credit Exchange Ranking",
    descriptionZh: "在公会商店展示 8 种信用点兑换性价比排序（Ask/Bid 单点成本、库存匹配及增益升级缺口估算）",
    descriptionEn: "Rank Guild Credit conversion efficiency (Ask/Bid per credit) inside Guild Shop & upgrade modals",
    category: "market",
    defaultEnabled: true,
    routes: ["guild"],

    init(context) {
      ctx = context;
      const saved = ctx.storage.get<Partial<GuildRankPref> | null>(PREF_KEY, null);
      if (saved) {
        if (typeof saved.activeTab === "string") pref.activeTab = saved.activeTab;
        if (saved.sortBy) pref.sortBy = saved.sortBy;
        if (saved.sortDir === "asc" || saved.sortDir === "desc") pref.sortDir = saved.sortDir;
        if (typeof saved.ownedOnly === "boolean") pref.ownedOnly = saved.ownedOnly;
        if (typeof saved.collapsed === "boolean") pref.collapsed = saved.collapsed;
        if (saved.buffSortMode === "ask" || saved.buffSortMode === "bid") pref.buffSortMode = saved.buffSortMode;
      }

      unregStyle = ctx.addStyle(
        STYLE_ID,
        `
        #${MAIN_PANEL_ID} {
          margin: 10px 0 14px;
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid #303d5c;
          background: rgba(16, 22, 36, 0.92);
          color: #e2e8f0;
          font-size: 12px;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-head {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 8px;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-title-wrap {
          display: inline-flex;
          align-items: baseline;
          flex-wrap: wrap;
          gap: 8px;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-title {
          font-size: 13px;
          font-weight: 700;
          color: #93c5fd;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-sub {
          font-size: 11px;
          color: #94a3b8;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-status {
          font-size: 11px;
          color: #4ade80;
          font-weight: 600;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-actions {
          display: inline-flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-chk {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          color: #cbd5e1;
          cursor: pointer;
          user-select: none;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-search {
          width: 118px;
          padding: 3px 7px;
          border-radius: 4px;
          border: 1px solid #3b4b72;
          background: #0f1624;
          color: #f8fafc;
          font-size: 11px;
          outline: none;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-search:focus {
          border-color: #60a5fa;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-btn {
          padding: 3px 8px;
          border-radius: 4px;
          border: 1px solid #3b4b72;
          background: #1e293b;
          color: #dbeafe;
          font-size: 11px;
          cursor: pointer;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-btn:hover {
          background: #2b3b55;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          margin-bottom: 8px;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-tab {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          border-radius: 5px;
          border: 1px solid #2b3652;
          background: #141c2e;
          color: #cbd5e1;
          font-size: 11px;
          cursor: pointer;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-tab.active {
          border-color: var(--gcr-accent, #60a5fa);
          background: rgba(59, 130, 246, 0.2);
          color: #ffffff;
          font-weight: 600;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-tab-cnt {
          color: #94a3b8;
          font-size: 10px;
        }
        .mwi-lite-gcr-ico {
          vertical-align: middle;
          flex-shrink: 0;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(295px, 1fr));
          gap: 8px;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-card {
          border: 1px solid #27324a;
          border-left: 3px solid var(--gcr-accent, #60a5fa);
          border-radius: 6px;
          padding: 7px 8px;
          background: rgba(11, 16, 28, 0.72);
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-card-hd {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 5px;
          cursor: pointer;
          font-weight: 600;
          color: var(--gcr-accent, #93c5fd);
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-card-hd:hover {
          text-decoration: underline;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-card-title {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-card-own {
          font-size: 11px;
          font-weight: 400;
          color: #94a3b8;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-card-cols,
        #${MAIN_PANEL_ID} .mwi-lite-gcr-card-row {
          display: grid;
          grid-template-columns: 24px 1fr 48px 52px 52px;
          gap: 4px;
          align-items: center;
          font-size: 11px;
          padding: 2px 0;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-card-cols {
          color: #64748b;
          border-bottom: 1px solid #1e293b;
          margin-bottom: 2px;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-card-cols span:nth-child(n+3),
        #${MAIN_PANEL_ID} .mwi-lite-gcr-card-row .mwi-lite-gcr-rate,
        #${MAIN_PANEL_ID} .mwi-lite-gcr-card-row .mwi-lite-gcr-cost {
          text-align: right;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-card-row.has-own {
          background: rgba(34, 197, 94, 0.08);
          border-radius: 3px;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-rank {
          color: #94a3b8;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-item {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          min-width: 0;
          cursor: pointer;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-item:hover .mwi-lite-gcr-name {
          color: #93c5fd;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-own {
          padding: 0 4px;
          border-radius: 3px;
          background: rgba(34, 197, 94, 0.22);
          color: #86efac;
          font-size: 10px;
          flex-shrink: 0;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-rate {
          color: #94a3b8;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-cost.hi {
          color: #4ade80;
          font-weight: 600;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-table-wrap {
          max-height: 360px;
          overflow-y: auto;
          border: 1px solid #24304a;
          border-radius: 6px;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-table,
        #${BUFF_COST_ID} .mwi-lite-gcr-buff-tbl {
          width: 100%;
          border-collapse: collapse;
          font-size: 11.5px;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-table th,
        #${MAIN_PANEL_ID} .mwi-lite-gcr-table td,
        #${BUFF_COST_ID} .mwi-lite-gcr-buff-tbl th,
        #${BUFF_COST_ID} .mwi-lite-gcr-buff-tbl td {
          padding: 4px 7px;
          border-bottom: 1px solid rgba(51, 65, 85, 0.45);
          text-align: left;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-table th {
          position: sticky;
          top: 0;
          background: #131b2e;
          color: #94a3b8;
          font-weight: 600;
          z-index: 1;
        }
        #${MAIN_PANEL_ID} .sortable,
        #${BUFF_COST_ID} .sortable {
          cursor: pointer;
          user-select: none;
        }
        #${MAIN_PANEL_ID} .sortable.active,
        #${BUFF_COST_ID} .sortable.active {
          color: #60a5fa;
          text-decoration: underline;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-table .num,
        #${BUFF_COST_ID} .mwi-lite-gcr-buff-tbl .num {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-table td.item-cell {
          display: flex;
          align-items: center;
          gap: 5px;
          cursor: pointer;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-table td.item-cell:hover {
          color: #93c5fd;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-table tr.has-own {
          background: rgba(34, 197, 94, 0.08);
        }
        #${MAIN_PANEL_ID} .own-hi {
          color: #86efac;
          font-weight: 600;
        }
        #${MAIN_PANEL_ID} .cost-hi,
        #${BUFF_COST_ID} .cost-hi {
          color: #4ade80;
          font-weight: 600;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-more {
          margin-top: 6px;
          text-align: center;
        }
        #${MAIN_PANEL_ID} .mwi-lite-gcr-empty,
        #${MAIN_PANEL_ID} .mwi-lite-gcr-card-empty {
          padding: 10px;
          text-align: center;
          color: #94a3b8;
        }
        #${EXCHANGE_HINT_ID},
        #${BUFF_COST_ID} {
          margin-top: 10px;
          padding: 8px 10px;
          border-radius: 6px;
          border: 1px solid #2e3b59;
          background: rgba(15, 22, 36, 0.9);
          color: #e2e8f0;
          font-size: 11px;
        }
        #${EXCHANGE_HINT_ID} .mwi-lite-gcr-mini-hd,
        #${BUFF_COST_ID} .mwi-lite-gcr-buff-hd {
          font-weight: 600;
          color: #93c5fd;
          margin-bottom: 5px;
        }
        #${EXCHANGE_HINT_ID} .mwi-lite-gcr-mini-sec {
          color: #94a3b8;
          margin: 4px 0 2px;
          font-size: 10.5px;
        }
        #${EXCHANGE_HINT_ID} .mwi-lite-gcr-mini-row {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 2px 0;
        }
        #${EXCHANGE_HINT_ID} .mwi-lite-gcr-mini-row .name {
          flex: 1;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        #${EXCHANGE_HINT_ID} .mwi-lite-gcr-mini-row .own {
          color: #86efac;
        }
        #${EXCHANGE_HINT_ID} .mwi-lite-gcr-mini-row .cost {
          color: #4ade80;
          font-weight: 600;
        }
        #${BUFF_COST_ID} .credit-summary {
          cursor: pointer;
          background: rgba(30, 41, 59, 0.45);
        }
        #${BUFF_COST_ID} .credit-opt.best td.sub {
          color: #86efac;
        }
        #${BUFF_COST_ID} td.sub {
          padding-left: 16px;
        }
        #${BUFF_COST_ID} .muted {
          color: #94a3b8;
          font-size: 10.5px;
        }
        `
      );

      unsubs = [
        ctx.marketStore.onPriceUpdate(() => {
          priceEpoch++;
          if (ctx?.domScheduler.getActiveRoute() === "guild") {
            ctx.domScheduler.scheduleRun(false);
          }
        }),
        ctx.gameData.on("items_updated", () => {
          itemsEpoch++;
          if (ctx?.domScheduler.getActiveRoute() === "guild") {
            ctx.domScheduler.scheduleRun(false);
          }
        }),
        ctx.gameData.on("character_initialized", () => {
          itemsEpoch++;
          if (ctx?.domScheduler.getActiveRoute() === "guild") {
            ctx.domScheduler.scheduleRun(false);
          }
        }),
        ctx.domScheduler.onRouteChange((route) => {
          if (route === "guild") {
            ensureMarketPrices(false);
          }
        }),
      ];

      return () => {
        unsubs.forEach((u) => u());
        unsubs = [];
        unregStyle?.();
        unregStyle = null;
        if (copyNoticeTimer !== null) {
          clearTimeout(copyNoticeTimer);
          copyNoticeTimer = null;
        }
        document.getElementById(MAIN_PANEL_ID)?.remove();
        document.getElementById(EXCHANGE_HINT_ID)?.remove();
        document.getElementById(BUFF_COST_ID)?.remove();
        lastMainSig = "";
        lastExchangeSig = "";
        lastBuffSig = "";
      };
    },

    onDom() {
      renderMainPanel();
      renderExchangeModalHint();
      renderBuffModalBreakdown();
    },
  };
}
