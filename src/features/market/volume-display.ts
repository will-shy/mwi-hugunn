import type {
  FeatureModule,
  KernelContext,
  MarketVolumeStats,
  MarketVolumeWindowStats,
} from "../../core/types";

const PANEL_ID = "mwi-lite-volume-detail";
const POS_KEY = "volume_panel_pos_v1";
const COLS_KEY = "volume_panel_cols_v1";

type ColumnId = "avgPrice" | "medianPrice" | "volume" | "buySell" | "minMax";

interface ColumnDef {
  id: ColumnId;
  labelZh: string;
  labelEn: string;
  color: string;
  value: (data: MarketVolumeWindowStats) => string;
}

function formatCompactNumber(num: number, fractionDigits: number): string {
  if (!Number.isFinite(num) || num === 0) return "0";
  const absNum = Math.abs(num);

  const fmtVal = (v: number): string => {
    const factor = Math.pow(10, fractionDigits);
    const rounded = Math.round(v * factor) / factor;
    return rounded.toFixed(fractionDigits).replace(/\.?0+$/, "");
  };

  if (absNum < 1 && absNum > 0) return fmtVal(num);
  if (absNum >= 1e9) return `${fmtVal(num / 1e9)}B`;
  if (absNum >= 1e6) return `${fmtVal(num / 1e6)}M`;
  if (absNum >= 1e3) return `${fmtVal(num / 1e3)}K`;
  return `${Math.floor(num)}`;
}

const showPrice = (n: number): string => formatCompactNumber(n, 3);
const showNum = (n: number): string => formatCompactNumber(n, 2);

const COLUMNS: ColumnDef[] = [
  { id: "avgPrice", labelZh: "均价", labelEn: "Avg", color: "#FFD700", value: (d) => showPrice(d.avgPrice) },
  { id: "medianPrice", labelZh: "中位", labelEn: "Med", color: "#FFA500", value: (d) => showPrice(d.medianPrice) },
  { id: "volume", labelZh: "交易量", labelEn: "Vol", color: "#87CEEB", value: (d) => showNum(d.volume) },
  {
    id: "buySell",
    labelZh: "买/卖",
    labelEn: "B/S",
    color: "#90EE90",
    value: (d) => `${showNum(d.buyVolume)}/${showNum(d.sellVolume)}`,
  },
  {
    id: "minMax",
    labelZh: "min/max",
    labelEn: "min/max",
    color: "#FFFF00",
    value: (d) => `${showPrice(d.minPrice)}/${showPrice(d.maxPrice)}`,
  },
];

const DEFAULT_COLUMNS: ColumnId[] = ["volume", "buySell", "minMax"];

function getInspectedMarketItem(): { container: HTMLElement; itemHrid: string; enhancementLevel: number } | null {
  const currentItem = document.querySelector<HTMLElement>('[class*="MarketplacePanel_currentItem"]');
  if (!currentItem) return null;

  const itemNode = currentItem.querySelector<HTMLElement>('[class*="Item_item"]');
  if (!itemNode) return null;

  const useEl = itemNode.querySelector("use");
  const href = useEl?.getAttribute("href") || (useEl as SVGUseElement | null)?.href?.baseVal || "";
  const hash = href.split("#")[1] || "";
  if (!hash) return null;

  const enhEl = itemNode.querySelector('[class*="Item_enhancementLevel"]');
  const enhancementLevel = enhEl ? Number((enhEl.textContent || "").replace(/\+/g, "").trim()) || 0 : 0;

  return {
    container: currentItem,
    itemHrid: `/items/${hash}`,
    enhancementLevel,
  };
}

export function createVolumeDisplayModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let unregStyle: (() => void) | null = null;
  let lastItemKey = "";
  let lastStats: MarketVolumeStats | null = null;
  let requestSerial = 0;
  let menuOpen = false;
  let outsideListenerAttached = false;

  const getVisibleCols = (): ColumnDef[] => {
    const saved = ctx?.storage.get<ColumnId[]>(COLS_KEY, DEFAULT_COLUMNS);
    const validSet = new Set(
      Array.isArray(saved) && saved.length > 0
        ? saved.filter((id) => COLUMNS.some((c) => c.id === id))
        : DEFAULT_COLUMNS
    );
    const cols = COLUMNS.filter((c) => validSet.has(c.id));
    return cols.length > 0 ? cols : COLUMNS.filter((c) => DEFAULT_COLUMNS.includes(c.id));
  };

  const closeMenu = () => {
    menuOpen = false;
    const menu = document.querySelector<HTMLElement>(`#${PANEL_ID} .mwi-lite-vol-menu`);
    if (menu) menu.style.display = "none";
    if (outsideListenerAttached) {
      document.removeEventListener("pointerdown", onOutsidePointerDown, true);
      outsideListenerAttached = false;
    }
  };

  const onOutsidePointerDown = (e: Event) => {
    const panel = document.getElementById(PANEL_ID);
    const target = e.target as Node | null;
    if (!panel || !target) {
      closeMenu();
      return;
    }
    const menu = panel.querySelector(".mwi-lite-vol-menu");
    const gear = panel.querySelector(".mwi-lite-vol-gear");
    if (menu?.contains(target) || gear?.contains(target)) return;
    closeMenu();
  };

  const ensurePanel = (parent: HTMLElement): HTMLElement => {
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = PANEL_ID;
      panel.setAttribute("data-mwi-lite", "1");

      const content = document.createElement("div");
      content.className = "mwi-lite-vol-content";

      const gear = document.createElement("button");
      gear.type = "button";
      gear.className = "mwi-lite-vol-gear";
      gear.textContent = "⚙";
      gear.title = ctx?.i18n.t("设置显示列", "Configure columns") || "Columns";

      const menu = document.createElement("div");
      menu.className = "mwi-lite-vol-menu";
      menu.setAttribute("data-mwi-lite", "1");
      menu.style.display = "none";

      // Prevent drag / bubble inside column config menu
      const stop = (e: Event) => e.stopPropagation();
      ["pointerdown", "mousedown", "click", "dblclick"].forEach((evt) => menu.addEventListener(evt, stop));

      gear.addEventListener("pointerdown", stop);
      gear.addEventListener("click", (e) => {
        e.stopPropagation();
        if (menuOpen) {
          closeMenu();
        } else {
          renderMenu(menu);
          menu.style.display = "block";
          menuOpen = true;
          if (!outsideListenerAttached) {
            document.addEventListener("pointerdown", onOutsidePointerDown, true);
            outsideListenerAttached = true;
          }
        }
      });

      panel.append(content, gear, menu);

      const savedPos = ctx?.storage.get<{ x: number; y: number } | null>(POS_KEY, null);
      if (savedPos && Number.isFinite(savedPos.x) && Number.isFinite(savedPos.y)) {
        panel.style.transform = `translate(${savedPos.x}px, ${savedPos.y}px)`;
      }

      let dragging = false;
      let startX = 0;
      let startY = 0;
      let baseX = savedPos?.x || 0;
      let baseY = savedPos?.y || 0;

      panel.addEventListener("pointerdown", (e) => {
        const t = e.target as Element | null;
        if (t?.closest("button, label, input, .mwi-lite-vol-menu")) return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        panel!.setPointerCapture?.(e.pointerId);
      });
      panel.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        panel!.style.transform = `translate(${baseX + e.clientX - startX}px, ${baseY + e.clientY - startY}px)`;
      });
      panel.addEventListener("pointerup", (e) => {
        if (!dragging) return;
        dragging = false;
        baseX += e.clientX - startX;
        baseY += e.clientY - startY;
        if (Math.abs(baseX) < 12 && Math.abs(baseY) < 12) {
          baseX = 0;
          baseY = 0;
          panel!.style.transform = "";
          ctx?.storage.del(POS_KEY);
        } else {
          ctx?.storage.set(POS_KEY, { x: Math.round(baseX), y: Math.round(baseY) });
        }
      });
      panel.addEventListener("dblclick", (e) => {
        const t = e.target as Element | null;
        if (t?.closest("button, label, input, .mwi-lite-vol-menu")) return;
        baseX = 0;
        baseY = 0;
        panel!.style.transform = "";
        ctx?.storage.del(POS_KEY);
      });
    }

    if (panel.parentElement !== parent) {
      parent.style.position = "relative";
      parent.style.zIndex = "30";
      parent.appendChild(panel);
    }
    return panel;
  };

  const renderMenu = (menu: Element) => {
    if (!ctx) return;
    const selected = new Set(getVisibleCols().map((c) => c.id));
    menu.replaceChildren();

    for (const col of COLUMNS) {
      const label = document.createElement("label");
      label.className = "mwi-lite-vol-opt";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = col.id;
      checkbox.checked = selected.has(col.id);
      checkbox.addEventListener("change", (e) => {
        e.stopPropagation();
        const checked = Array.from(menu.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')).map(
          (i) => i.value as ColumnId
        );
        if (checked.length === 0) {
          checkbox.checked = true;
          return;
        }
        ctx?.storage.set(COLS_KEY, checked);
        const panel = document.getElementById(PANEL_ID);
        if (panel) renderStats(panel, lastStats);
      });

      const span = document.createElement("span");
      span.textContent = ctx.i18n.t(col.labelZh, col.labelEn);
      label.append(checkbox, span);
      menu.appendChild(label);
    }
  };

  const renderLoading = (panel: HTMLElement) => {
    if (!ctx) return;
    const content = panel.querySelector(".mwi-lite-vol-content");
    if (!content) return;
    content.innerHTML = `<span class="mwi-lite-vol-status">${ctx.i18n.t("正在加载...", "Loading...")}</span>`;
  };

  const renderStats = (panel: HTMLElement, stats: MarketVolumeStats | null) => {
    if (!ctx) return;
    const content = panel.querySelector(".mwi-lite-vol-content");
    if (!content) return;

    if (!stats || (stats.d1.volume === 0 && stats.d3.volume === 0 && stats.d5.volume === 0)) {
      content.innerHTML = `<span class="mwi-lite-vol-status">${ctx.i18n.t("无交易记录", "No trade data")}</span>`;
      return;
    }

    const cols = getVisibleCols();
    const getPad = (idx: number, len: number, isHead: boolean): string => {
      const gap = 6;
      const top = isHead ? 0 : 1;
      const bottom = isHead ? 3 : 1;
      const right = idx === len - 1 ? 0 : gap;
      const left = idx === 0 ? 0 : gap;
      return `${top}px ${right}px ${bottom}px ${left}px`;
    };

    const headCells = cols
      .map(
        (c, i) =>
          `<th style="padding:${getPad(i, cols.length, true)}">${ctx!.i18n.t(c.labelZh, c.labelEn)}</th>`
      )
      .join("");

    const renderRow = (lbl: string, lblColor: string, data: MarketVolumeWindowStats) => {
      const cells = cols
        .map(
          (c, i) =>
            `<td style="padding:${getPad(i, cols.length, false)};color:${c.color};">${c.value(data)}</td>`
        )
        .join("");
      return `<tr><td class="mwi-lite-vol-day" style="color:${lblColor};">${lbl}</td>${cells}</tr>`;
    };

    content.innerHTML = `
      <table class="mwi-lite-vol-tbl">
        <thead>
          <tr>
            <th class="mwi-lite-vol-corner"></th>${headCells}
          </tr>
        </thead>
        <tbody>
          ${renderRow("1d", "#FF6B6B", stats.d1)}
          ${renderRow("3d", "#4ECDC4", stats.d3)}
          ${renderRow("5d", "#95E1D3", stats.d5)}
        </tbody>
      </table>
    `;
  };

  const syncDom = () => {
    if (!ctx) return;
    const target = getInspectedMarketItem();
    if (!target) {
      closeMenu();
      document.getElementById(PANEL_ID)?.remove();
      lastItemKey = "";
      lastStats = null;
      return;
    }

    const itemKey = `${target.itemHrid}:${target.enhancementLevel}`;
    const existing = document.getElementById(PANEL_ID);
    if (itemKey === lastItemKey && existing?.isConnected && existing.parentElement === target.container) {
      return;
    }

    lastItemKey = itemKey;
    lastStats = null;
    closeMenu();
    const panel = ensurePanel(target.container);
    renderLoading(panel);

    const serial = ++requestSerial;
    void ctx.marketStore.getVolumeStats(target.itemHrid, target.enhancementLevel).then((stats) => {
      if (serial !== requestSerial || !panel.isConnected) return;
      lastStats = stats;
      renderStats(panel, stats);
    });
  };

  return {
    id: "market-volume-display",
    nameZh: "市场交易量与均价",
    nameEn: "Market Volume & Avg Price",
    descriptionZh: "经典紧凑交易量面板：1d/3d/5d 交易量、买卖量、min/max 及可配置均价/中位列",
    descriptionEn: "Classic compact market volume widget with 1d/3d/5d volume, B/S, min/max, and column selector",
    category: "market",
    defaultEnabled: true,
    routes: ["market"],

    init(context) {
      ctx = context;
      unregStyle = ctx.addStyle(
        "market-volume-display",
        `
        #${PANEL_ID} {
          position: absolute;
          left: calc(100% + 42px);
          top: auto;
          bottom: 0;
          z-index: 40;
          background: var(--mwi-px-panel-bg, linear-gradient(180deg, #121c3b 0%, #0c1228 100%));
          border: 2px solid var(--mwi-px-border, #9dbbff);
          border-radius: 0;
          padding: 6px 10px;
          color: var(--mwi-px-text, #e2e8f0);
          font-size: 12.5px;
          font-family: var(--mwi-px-mono, monospace);
          line-height: 1.35;
          box-shadow: var(--mwi-px-shadow-card, 0 0 0 2px #070b16);
          cursor: grab;
          user-select: none;
          white-space: nowrap;
        }
        #${PANEL_ID} .mwi-lite-vol-gear {
          position: absolute;
          top: 4px;
          left: 6px;
          background: none;
          border: none;
          color: var(--mwi-px-sub, #9dbbff);
          cursor: pointer;
          font-size: 13px;
          padding: 1px 2px;
          line-height: 1;
        }
        #${PANEL_ID} .mwi-lite-vol-gear:hover {
          color: #ffffff;
        }
        #${PANEL_ID} .mwi-lite-vol-status {
          display: block;
          color: var(--mwi-px-sub, #9dbbff);
          font-size: 11px;
          padding: 18px 8px 4px 18px;
        }
        #${PANEL_ID} .mwi-lite-vol-tbl {
          border-collapse: collapse;
          font-size: 12.5px;
        }
        #${PANEL_ID} .mwi-lite-vol-tbl th {
          color: var(--mwi-px-sub, #9dbbff);
          font-size: 11px;
          font-weight: 700;
          text-align: center;
          border-bottom: 1px solid #293e7a;
        }
        #${PANEL_ID} .mwi-lite-vol-corner {
          width: 24px;
          min-width: 24px;
          padding: 0 0 3px !important;
        }
        #${PANEL_ID} .mwi-lite-vol-tbl td {
          text-align: center;
          font-variant-numeric: tabular-nums;
        }
        #${PANEL_ID} .mwi-lite-vol-day {
          padding: 1px 8px 1px 0 !important;
          text-align: left !important;
          font-weight: 800;
          color: var(--mwi-px-gold, #fde047);
        }
        #${PANEL_ID} .mwi-lite-vol-menu {
          position: absolute;
          top: 26px;
          left: 2px;
          z-index: 10001;
          min-width: 122px;
          padding: 6px 8px;
          background: var(--mwi-px-panel-bg, #0e1634);
          border: 2px solid var(--mwi-px-border-bright, #d5e5ff);
          border-radius: 0;
          box-shadow: var(--mwi-px-shadow-card, 0 0 0 2px #070b16);
          color: #f1f5f9;
          font-size: 11.5px;
          line-height: 1.35;
          text-align: left;
          cursor: default;
        }
        #${PANEL_ID} .mwi-lite-vol-opt {
          display: flex;
          align-items: center;
          gap: 6px;
          min-height: 22px;
          white-space: nowrap;
          cursor: pointer;
        }
        #${PANEL_ID} .mwi-lite-vol-opt input {
          margin: 0;
          accent-color: #4ade80;
        }
        `
      );

      return () => {
        closeMenu();
        unregStyle?.();
        unregStyle = null;
        document.getElementById(PANEL_ID)?.remove();
      };
    },

    onDom() {
      syncDom();
    },
  };
}
