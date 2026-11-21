import type { FeatureModule, KernelContext } from "../../core/types";

const SORT_STATE_KEY = "magic_sort_state_v1";
const PANEL_SEL = '[class*="MarketplacePanel_myListings__"]:not([class*="myListingsTable"])';
const TBODY_SEL = '[class*="MarketplacePanel_myListingsTable__"] tbody';
const BTN_CONT_SEL = '[class*="MarketplacePanel_buttonContainer__"]';
const MODAL_SEL = '[class*="MarketplacePanel_modalContent__"]';
const CLAIM_BTN_RE = /收集|收取|领取|Claim|Collect/i;

const SORT_MODES = [
  { key: "time-asc", zh: "时间↑", en: "Time↑" },
  { key: "time-desc", zh: "时间↓", en: "Time↓" },
  { key: "name-asc", zh: "名称↑", en: "Name↑" },
  { key: "name-desc", zh: "名称↓", en: "Name↓" },
  { key: "price-asc", zh: "价格↑", en: "Price↑" },
  { key: "price-desc", zh: "价格↓", en: "Price↓" },
] as const;

interface SortPref {
  sortKey: string;
  pinCollectable: boolean;
}

function parsePriceText(text: string): number {
  const cleaned = text.replace(/[^\d.KMB]/gi, "").toUpperCase();
  const num = parseFloat(cleaned.replace(/[KMB]/g, ""));
  if (!Number.isFinite(num)) return 0;
  if (cleaned.includes("B")) return num * 1e9;
  if (cleaned.includes("M")) return num * 1e6;
  if (cleaned.includes("K")) return num * 1e3;
  return num;
}

function getRowItemName(row: Element): string {
  const svg = row.querySelector("svg[aria-label]");
  if (svg) return svg.getAttribute("aria-label") || "";
  const item = row.querySelector('[class*="Item_item__"]');
  return item ? (item.textContent || "").trim() : "";
}

function isRowCollectable(row: HTMLTableRowElement): boolean {
  // Fast path on MWI MyListings column 4 (claims cell) avoids 3x subtree querySelector per row
  const claimsCell = row.cells.length >= 7 ? row.cells[4] : null;
  const claimsContainer =
    claimsCell?.firstElementChild ||
    row.querySelector('[class*="MarketplacePanel_claimsContainer__"]');
  if (!claimsContainer) return false;
  const claims = claimsContainer.firstElementChild;
  if (!claims || claims.childElementCount === 0) return false;
  const last = claimsContainer.lastElementChild;
  const button =
    last?.tagName === "BUTTON" ? last : claimsContainer.querySelector('[class*="Button_button__"]');
  return !!(button?.textContent && CLAIM_BTN_RE.test(button.textContent));
}

function getTableRows(tbody: Element | null): HTMLTableRowElement[] {
  if (!tbody) return [];
  const children = tbody.children;
  const out: HTMLTableRowElement[] = [];
  for (let i = 0; i < children.length; i++) {
    const row = children[i] as HTMLTableRowElement;
    if (row.tagName === "TR" && row.cells.length > 0) {
      out.push(row);
    }
  }
  return out;
}

export function createMagicSortModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let unregStyle: (() => void) | null = null;
  let unregWs: (() => void) | null = null;
  let sortIndex = 0;
  let pinCollectable = true;
  let rowTimestamps = new WeakMap<Element, number>();
  let rowMetaCache = new WeakMap<Element, { name: string; price: number }>();
  let isSorting = false;
  let lastPanelRef: Element | null = null;
  let lastTbodyRef: Element | null = null;
  let lastStateSignature = "";
  let lastPointerDownTs = 0;
  let batchFreezeUntil = 0;
  let claimBurstUntil = 0;
  let debounceTimer: number | null = null;
  const zhCollator = new Intl.Collator("zh-CN");

  const getRowMeta = (row: HTMLTableRowElement) => {
    let cached = rowMetaCache.get(row);
    if (!cached) {
      const priceEl = row.querySelector('[class*="MarketplacePanel_price__"] span');
      cached = {
        name: getRowItemName(row),
        price: parsePriceText(priceEl?.textContent?.trim() || "0"),
      };
      rowMetaCache.set(row, cached);
    }
    return cached;
  };

  const getRowsSignature = (rows: HTMLTableRowElement[]): string => {
    const parts: string[] = [
      String(rows.length),
      SORT_MODES[sortIndex]?.key || "time-asc",
      pinCollectable ? "1" : "0",
    ];
    for (let i = 0; i < rows.length; i++) {
      parts.push(isRowCollectable(rows[i]) ? "C" : "N");
    }
    return parts.join("|");
  };

  const buildDataSignature = (data: Array<{ collectable: boolean }>): string => {
    const parts: string[] = [
      String(data.length),
      SORT_MODES[sortIndex]?.key || "time-asc",
      pinCollectable ? "1" : "0",
    ];
    for (let i = 0; i < data.length; i++) {
      parts.push(data[i].collectable ? "C" : "N");
    }
    return parts.join("|");
  };

  const savePref = () => {
    ctx?.storage.set<SortPref>(SORT_STATE_KEY, {
      sortKey: SORT_MODES[sortIndex]?.key || "time-asc",
      pinCollectable,
    });
  };

  const scheduleSortDebounced = (ms: number) => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      const now = Date.now();
      if (now < batchFreezeUntil) {
        scheduleSortDebounced(Math.max(60, batchFreezeUntil - now + 30));
        return;
      }
      batchFreezeUntil = 0;
      sortRows(false);
    }, ms);
  };

  const assignRowTimestamps = (tbody: Element, reset = false) => {
    if (reset) rowTimestamps = new WeakMap();
    const rows = getTableRows(tbody);
    const now = Date.now();
    rows.forEach((row, idx) => {
      if (reset || !rowTimestamps.has(row)) {
        rowTimestamps.set(row, now - (rows.length - idx) * 1000);
      }
    });
  };

  const sortRows = (force = false) => {
    if (!ctx || isSorting) return;
    const now = Date.now();
    if (!force) {
      if (now < batchFreezeUntil) {
        scheduleSortDebounced(Math.max(150, batchFreezeUntil - now + 40));
        return;
      }
      if (now - lastPointerDownTs < 250) {
        scheduleSortDebounced(260);
        return;
      }
    }
    const tbody = document.querySelector(TBODY_SEL);
    if (!tbody) return;
    const rows = getTableRows(tbody);
    if (!rows.length) return;

    assignRowTimestamps(tbody, false);
    isSorting = true;
    try {
      const mode = SORT_MODES[sortIndex]?.key || "time-asc";
      const direction = mode.endsWith("-desc") ? -1 : 1;
      const field = mode.replace(/-asc$|-desc$/, "");

      const data = rows.map((row, index) => {
        const meta = getRowMeta(row);
        return {
          row,
          name: meta.name,
          price: meta.price,
          timestamp: rowTimestamps.get(row) || now,
          collectable: isRowCollectable(row),
          index,
        };
      });

      data.sort((a, b) => {
        if (pinCollectable) {
          if (a.collectable && !b.collectable) return -1;
          if (!a.collectable && b.collectable) return 1;
        }
        let cmp = 0;
        if (field === "name") cmp = zhCollator.compare(a.name, b.name);
        else if (field === "price") cmp = a.price - b.price;
        else cmp = a.timestamp - b.timestamp;
        return (cmp !== 0 ? cmp : a.index - b.index) * direction;
      });

      let alreadyOrdered = true;
      for (let i = 0; i < data.length; i++) {
        const wantBg = data[i].collectable ? "rgba(76,175,80,0.16)" : "";
        if (data[i].row.style.backgroundColor !== wantBg) {
          data[i].row.style.backgroundColor = wantBg;
        }
        if (data[i].row !== rows[i]) {
          alreadyOrdered = false;
        }
      }

      // Skip DOM reordering when already sorted so MutationObserver never loops
      // and native pointerdown -> mouseup -> click on pinned rows stays unbroken.
      if (!alreadyOrdered) {
        for (let i = data.length - 1; i >= 0; i--) {
          const row = data[i].row;
          const nextSibling = i + 1 < data.length ? data[i + 1].row : null;
          if (row.nextSibling !== nextSibling) {
            tbody.insertBefore(row, nextSibling);
          }
        }
      }
      lastStateSignature = buildDataSignature(data);
    } finally {
      isSorting = false;
    }
  };

  const injectControls = (panel: Element) => {
    if (!ctx) return;
    const container = panel.querySelector(BTN_CONT_SEL);
    if (!container || container.closest(MODAL_SEL)) return;

    if (container.querySelector(".mwi-lite-magic-sort-bar")) {
      return;
    }

    const bar = document.createElement("div");
    bar.className = "mwi-lite-magic-sort-bar";
    bar.setAttribute("data-mwi-lite", "1");

    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "Button_button__1Fe9z Button_small__3fqC7 mwi-lite-ms-btn mwi-lite-ms-refresh";
    refreshBtn.textContent = ctx.i18n.t("刷新", "Refresh");
    refreshBtn.title = ctx.i18n.t("重置时间戳并重新排序", "Reset timestamps and re-sort");
    refreshBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const tbody = document.querySelector(TBODY_SEL);
      if (tbody) assignRowTimestamps(tbody, true);
      sortRows(true);
    });

    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    pinBtn.className = "Button_button__1Fe9z Button_small__3fqC7 mwi-lite-ms-btn";
    const syncPinStyle = () => {
      pinBtn.textContent = ctx!.i18n.t("可收取置顶", "Pin Claim");
      pinBtn.dataset.active = pinCollectable ? "1" : "0";
    };
    syncPinStyle();
    pinBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      pinCollectable = !pinCollectable;
      syncPinStyle();
      savePref();
      sortRows(true);
    });

    const sortBtn = document.createElement("button");
    sortBtn.type = "button";
    sortBtn.className = "Button_button__1Fe9z Button_small__3fqC7 mwi-lite-ms-btn mwi-lite-ms-sort";
    const syncSortLabel = () => {
      const m = SORT_MODES[sortIndex] || SORT_MODES[0];
      sortBtn.textContent = `${ctx!.i18n.t("排序", "Sort")} (${ctx!.i18n.t(m.zh, m.en)})`;
    };
    syncSortLabel();
    sortBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      sortIndex = (sortIndex + 1) % SORT_MODES.length;
      syncSortLabel();
      savePref();
      sortRows(true);
    });

    bar.append(refreshBtn, pinBtn, sortBtn);
    container.insertBefore(bar, container.firstChild);
  };

  const handlePanel = () => {
    const panel = document.querySelector(PANEL_SEL);
    const tbody = document.querySelector(TBODY_SEL);
    if (!panel || !tbody) return;

    injectControls(panel);

    if (lastPanelRef !== panel) {
      lastPanelRef = panel;
      // Clicking "全部收集 / Collect All" pauses sorting until React finishes batch row updates
      panel.addEventListener(
        "click",
        (ev) => {
          const btn = (ev.target as Element | null)?.closest?.("button");
          if (btn && CLAIM_BTN_RE.test(btn.textContent || "")) {
            const isAll = /全部|All/i.test(btn.textContent || "");
            const now = Date.now();
            if (isAll) {
              claimBurstUntil = Math.max(claimBurstUntil, now + 2600);
              batchFreezeUntil = Math.max(batchFreezeUntil, claimBurstUntil);
              scheduleSortDebounced(Math.max(450, batchFreezeUntil - now + 40));
            } else {
              batchFreezeUntil = Math.max(batchFreezeUntil, now + 360);
              scheduleSortDebounced(390);
            }
          }
        },
        true
      );
    }

    // Skip expensive table scans during batch claim updates
    if (Date.now() < batchFreezeUntil) return;

    const rows = getTableRows(tbody);
    const hasNewRow = rows.some((r) => !rowTimestamps.has(r));

    if (lastTbodyRef !== tbody) {
      lastTbodyRef = tbody;
      lastStateSignature = "";
      assignRowTimestamps(tbody, true);
      tbody.addEventListener(
        "pointerdown",
        () => {
          lastPointerDownTs = Date.now();
        },
        true
      );
      sortRows(false);
      return;
    }

    const sig = getRowsSignature(rows);
    if (hasNewRow || sig !== lastStateSignature) {
      sortRows(false);
    }
  };

  return {
    id: "market-magic-sort",
    nameZh: "我的挂单魔法排序",
    nameEn: "My Listings Magic Sort",
    descriptionZh: "按时间/名称/价格排序我的挂单，支持可收取订单强制置顶",
    descriptionEn: "Sort My Listings by time/name/price and pin claimable orders to top",
    category: "market",
    defaultEnabled: true,
    routes: ["market"],

    init(context) {
      ctx = context;
      const saved = ctx.storage.get<SortPref | null>(SORT_STATE_KEY, null);
      if (saved) {
        const idx = SORT_MODES.findIndex((m) => m.key === saved.sortKey);
        if (idx >= 0) sortIndex = idx;
        if (typeof saved.pinCollectable === "boolean") pinCollectable = saved.pinCollectable;
      }

      unregStyle = ctx.addStyle(
        "market-magic-sort",
        `
        ${PANEL_SEL} ${BTN_CONT_SEL} {
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
          flex-wrap: wrap !important;
        }
        ${PANEL_SEL} [class*="MarketplacePanel_listingCount__"] {
          margin-right: auto !important;
        }
        .mwi-lite-magic-sort-bar {
          order: -1;
          display: inline-flex;
          gap: 6px;
          align-items: center;
        }
        .mwi-lite-ms-btn {
          border: 1px solid var(--mwi-px-border, #8eb1ff) !important;
          color: #f8fafc !important;
          font-size: 11.5px !important;
          font-weight: 700 !important;
          font-family: var(--mwi-px-mono, monospace) !important;
          padding: 3px 9px !important;
          border-radius: 0 !important;
          cursor: pointer;
          background: var(--mwi-px-btn-bg, linear-gradient(180deg, #324a8f 0%, #22356b 100%)) !important;
          box-shadow: var(--mwi-px-shadow-btn, 0 0 0 1px #080d1a) !important;
          line-height: 1.25 !important;
        }
        .mwi-lite-ms-btn:active { transform: translateY(1px); }
        .mwi-lite-ms-refresh,
        .mwi-lite-ms-btn[data-active="1"] {
          border-color: var(--mwi-px-green-soft, #86efac) !important;
          background: var(--mwi-px-btn-green, linear-gradient(180deg, #1f6d43 0%, #165132 100%)) !important;
          box-shadow: 0 0 0 1px #06140c, inset 1px 1px 0 #4ade80, inset -1px -1px 0 #0e3821 !important;
        }
        .mwi-lite-ms-sort { min-width: 96px; }
        `
      );

      unregWs = ctx.gameData.on("market_listings_updated", (listings: any[]) => {
        if (ctx?.domScheduler.getActiveRoute() !== "market") return;
        const now = Date.now();
        const hasMoreClaimables =
          Array.isArray(listings) &&
          listings.some((l) => (l?.unclaimedCoinCount || 0) > 0 || (l?.unclaimedItemCount || 0) > 0);
        if (now < claimBurstUntil && !hasMoreClaimables) {
          // All claimables cleared — allow React 380ms to commit before single final sort
          claimBurstUntil = 0;
          batchFreezeUntil = now + 380;
        } else {
          const holdMs = now < claimBurstUntil ? 900 : 380;
          batchFreezeUntil = Math.max(batchFreezeUntil, now + holdMs);
        }
        scheduleSortDebounced(Math.max(380, batchFreezeUntil - now + 40));
      });

      return () => {
        unregWs?.();
        unregWs = null;
        unregStyle?.();
        unregStyle = null;
        if (debounceTimer !== null) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        batchFreezeUntil = 0;
        claimBurstUntil = 0;
        lastPanelRef = null;
        lastTbodyRef = null;
        document.querySelectorAll(".mwi-lite-magic-sort-bar").forEach((el) => el.remove());
        const tbody = document.querySelector(TBODY_SEL);
        if (tbody) getTableRows(tbody).forEach((r) => (r.style.backgroundColor = ""));
      };
    },

    onDom() {
      handlePanel();
    },
  };
}
