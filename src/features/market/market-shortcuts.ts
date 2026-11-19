import type { FeatureModule, KernelContext } from "../../core/types";

const SHORTCUTS_STORAGE_KEY = "sunnyMwi_market_shortcuts_v1";
const BAR_ID = "mwi-lite-market-shortcuts-bar";
const JUMP_BAR_ID = "mwi-lite-enh-jump-bar";
const PIN_BTN_ID = "mwi-lite-market-pin-btn";
const SETTINGS_POPOVER_ID = "mwi-lite-market-shortcuts-popover";
const ENH_LEVELS = [0, 5, 7, 8, 10, 12] as const;
const ITEM_HRID_RE = /^\/items\/[a-z0-9_]+$/;

interface ShortcutItem {
  itemHrid: string;
  level: number | null;
}

interface ShortcutsState {
  limit: number;
  pinned: ShortcutItem[];
  recent: ShortcutItem[];
}

function itemKey(item: ShortcutItem): string {
  return `${item.itemHrid}:${item.level === null ? "all" : item.level}`;
}

function sanitizeList(raw: unknown, allowNullLevel: boolean): ShortcutItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ShortcutItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { itemHrid, level } = entry as { itemHrid?: unknown; level?: unknown };
    if (typeof itemHrid !== "string" || !ITEM_HRID_RE.test(itemHrid)) continue;
    if (level === null) {
      if (!allowNullLevel) continue;
    } else if (typeof level !== "number" || !Number.isSafeInteger(level) || level < 0 || level > 20) {
      continue;
    }
    const normalized: ShortcutItem = { itemHrid, level: level === null ? null : level };
    const k = itemKey(normalized);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(normalized);
    }
  }
  return out;
}

function loadState(): ShortcutsState {
  try {
    const raw = window.localStorage.getItem(SHORTCUTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const limit =
        typeof parsed?.limit === "number" && Number.isInteger(parsed.limit) && parsed.limit >= 1 && parsed.limit <= 50
          ? parsed.limit
          : 10;
      return {
        limit,
        pinned: sanitizeList(parsed?.pinned, true),
        recent: sanitizeList(parsed?.recent, false).slice(0, 50),
      };
    }
  } catch {
    // Ignore malformed localStorage state
  }
  return { limit: 10, pinned: [], recent: [] };
}

function saveState(state: ShortcutsState): void {
  try {
    window.localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore quota errors
  }
}

function resolveSpriteBase(): string {
  const useEl = document.querySelector('use[href*="items_sprite"]');
  const href = useEl?.getAttribute("href");
  if (href && href.includes("#")) return href.split("#")[0];
  return "/static/media/items_sprite.9c39e2ec.svg";
}

function isElementVisible(el: Element | null): el is HTMLElement {
  if (!el || !el.isConnected) return false;
  return (el as HTMLElement).offsetParent !== null;
}

function findVisibleMarketPanel(): HTMLElement | null {
  const panels = document.querySelectorAll<HTMLElement>('[class*="MarketplacePanel_marketplacePanel"]');
  for (let i = 0; i < panels.length; i++) {
    if (isElementVisible(panels[i])) return panels[i];
  }
  return null;
}

function findVisibleCurrentItem(panel: HTMLElement): {
  el: HTMLElement;
  itemHrid: string;
  level: number;
} | null {
  const nodes = panel.querySelectorAll<HTMLElement>('[class*="MarketplacePanel_currentItem"]');
  for (let i = 0; i < nodes.length; i++) {
    const cur = nodes[i];
    if (!isElementVisible(cur)) continue;
    const useEl = cur.querySelector("use");
    const href = useEl?.getAttribute("href") || (useEl as SVGUseElement | null)?.href?.baseVal || "";
    const slug = href.split("#")[1] || "";
    if (!slug) continue;
    const itemHrid = `/items/${slug}`;
    const enhEl = cur.querySelector('[class*="Item_enhancementLevel"]');
    const level = enhEl ? Number((enhEl.textContent || "").replace(/\+/g, "").trim()) || 0 : 0;
    return { el: cur, itemHrid, level };
  }
  return null;
}

export function createMarketShortcutsModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let unregStyle: (() => void) | null = null;
  let state: ShortcutsState = loadState();
  let lastRenderSig = "";
  let settingsBtnRef: HTMLButtonElement | null = null;
  let popoverEl: HTMLFormElement | null = null;
  let docListenersAttached = false;

  const canEnhance = (itemHrid: string): boolean => {
    const detail = ctx?.gameData.getClientData()?.itemDetailMap?.[itemHrid];
    return Array.isArray(detail?.enhancementCosts) && detail.enhancementCosts.length > 0;
  };

  const openItemAtLevel = (itemHrid: string, level: number): boolean => {
    const core = ctx?.gameData.getReactGameCore();
    if (typeof core?.handleGoToMarketplace === "function") {
      core.handleGoToMarketplace(itemHrid, level);
      return true;
    }

    const roots = document.querySelectorAll('[class*="GamePage_gamePage"], [class^="GamePage"]');
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      const fKey = Reflect.ownKeys(root).find(
        (k) => typeof k === "string" && (k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"))
      );
      let fiber: any = fKey ? (root as any)[fKey] : null;
      for (let depth = 0; fiber && depth < 64; depth++, fiber = fiber.return) {
        const host = fiber.stateNode;
        if (host && typeof host === "object") {
          const fn = host.handleGoToMarketplace || host.goToMarketplace || host.openMarketplace;
          if (typeof fn === "function") {
            fn.call(host, itemHrid, level);
            return true;
          }
        }
      }
    }
    return false;
  };

  const openItemAllLevels = (itemHrid: string): boolean => {
    const panel = findVisibleMarketPanel();
    if (!panel) return openItemAtLevel(itemHrid, 0);

    const fKey = Reflect.ownKeys(panel).find(
      (k) => typeof k === "string" && (k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"))
    );
    let fiber: any = fKey ? (panel as any)[fKey] : null;
    for (let depth = 0; fiber && depth < 64; depth++, fiber = fiber.return) {
      const host = fiber.stateNode;
      if (
        host &&
        typeof host === "object" &&
        typeof host.handleViewItemSummary === "function" &&
        typeof host.handleViewOrderBook === "function"
      ) {
        host.handleViewItemSummary(itemHrid);
        return true;
      }
    }
    return openItemAtLevel(itemHrid, 0);
  };

  const closeSettingsPopover = (refocus = false) => {
    if (popoverEl) {
      popoverEl.remove();
      popoverEl = null;
    }
    if (settingsBtnRef) {
      settingsBtnRef.setAttribute("aria-expanded", "false");
      if (refocus) settingsBtnRef.focus();
    }
    if (docListenersAttached) {
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      document.removeEventListener("keydown", onDocKeyDown);
      docListenersAttached = false;
    }
  };

  const onDocPointerDown = (ev: Event) => {
    const target = ev.target as Node | null;
    if (target && !popoverEl?.contains(target) && !settingsBtnRef?.contains(target)) {
      closeSettingsPopover(false);
    }
  };

  const onDocKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      closeSettingsPopover(true);
    }
  };

  const positionPopover = () => {
    if (!popoverEl || !settingsBtnRef) return;
    const btnRect = settingsBtnRef.getBoundingClientRect();
    const popRect = popoverEl.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const left = Math.max(8, Math.min(btnRect.right - popRect.width, vw - popRect.width - 8));
    const top = btnRect.bottom + popRect.height + 8 <= vh - 8 ? btnRect.bottom + 8 : Math.max(8, btnRect.top - popRect.height - 8);
    popoverEl.style.left = `${left}px`;
    popoverEl.style.top = `${top}px`;
  };

  const openSettingsPopover = () => {
    if (!ctx) return;
    if (popoverEl) {
      closeSettingsPopover(true);
      return;
    }

    const form = document.createElement("form");
    form.id = SETTINGS_POPOVER_ID;
    form.setAttribute("data-mwi-lite", "1");
    form.setAttribute("role", "dialog");

    const title = document.createElement("strong");
    title.textContent = ctx.i18n.t("市场快捷栏设置", "Market Shortcut Settings");

    const row = document.createElement("label");
    row.className = "mwi-lite-ms-pop-row";
    const rowLabel = document.createElement("span");
    rowLabel.textContent = ctx.i18n.t("显示物品数量", "Items to display");
    const limitInput = document.createElement("input");
    limitInput.type = "number";
    limitInput.min = "1";
    limitInput.max = "50";
    limitInput.step = "1";
    limitInput.required = true;
    limitInput.value = String(state.limit);
    row.append(rowLabel, limitInput);

    const hint = document.createElement("div");
    hint.className = "mwi-lite-ms-pop-hint";
    hint.textContent = ctx.i18n.t("固定与最近共用此上限（1–50）。", "Pinned and recent share this limit (1–50).");

    const footer = document.createElement("div");
    footer.className = "mwi-lite-ms-pop-actions";

    const clearRecentBtn = document.createElement("button");
    clearRecentBtn.type = "button";
    clearRecentBtn.textContent = ctx.i18n.t("清空最近", "Clear Recent");
    clearRecentBtn.addEventListener("click", () => {
      state = { ...state, recent: [] };
      saveState(state);
      lastRenderSig = "";
      syncDom();
    });

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = ctx.i18n.t("关闭", "Close");
    closeBtn.addEventListener("click", () => closeSettingsPopover(true));

    const applyBtn = document.createElement("button");
    applyBtn.type = "submit";
    applyBtn.className = "primary";
    applyBtn.textContent = ctx.i18n.t("应用", "Apply");

    footer.append(clearRecentBtn, closeBtn, applyBtn);
    form.append(title, row, hint, footer);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!limitInput.checkValidity()) {
        limitInput.reportValidity();
        return;
      }
      const nextLimit = Math.max(1, Math.min(50, Math.trunc(limitInput.valueAsNumber || 10)));
      state = { ...state, limit: nextLimit };
      saveState(state);
      lastRenderSig = "";
      closeSettingsPopover(true);
      syncDom();
    });

    document.body.appendChild(form);
    popoverEl = form;
    settingsBtnRef?.setAttribute("aria-expanded", "true");

    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onDocKeyDown);
    docListenersAttached = true;

    positionPopover();
    limitInput.focus();
  };

  const recordRecent = (item: ShortcutItem): boolean => {
    if (item.level === null) return false;
    const k = itemKey(item);
    if (state.recent[0] && itemKey(state.recent[0]) === k) return false;
    state = {
      ...state,
      recent: [item, ...state.recent.filter((x) => itemKey(x) !== k)].slice(0, 50),
    };
    saveState(state);
    return true;
  };

  const isPinned = (item: ShortcutItem): boolean => {
    const k = itemKey(item);
    return state.pinned.some((x) => itemKey(x) === k);
  };

  const togglePin = (item: ShortcutItem) => {
    const k = itemKey(item);
    state = {
      ...state,
      pinned: isPinned(item)
        ? state.pinned.filter((x) => itemKey(x) !== k)
        : [item, ...state.pinned],
    };
    saveState(state);
  };

  const createShortcutButton = (
    item: ShortcutItem,
    kind: "pinned" | "recent",
    activeKey: string | null,
    spriteBase: string
  ): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `mwi-lite-ms-item ${kind === "pinned" ? "is-pinned" : "is-recent"}`;
    const k = itemKey(item);
    const isActive = activeKey === k;
    if (isActive) btn.classList.add("is-active");
    btn.setAttribute("aria-pressed", String(isActive));

    const itemName = ctx?.i18n.getItemName(item.itemHrid) || item.itemHrid.replace("/items/", "");
    const labelSuffix =
      item.level === null
        ? ` · ${ctx?.i18n.t("全", "All")}`
        : canEnhance(item.itemHrid)
          ? ` +${item.level}`
          : "";
    const kindPrefix =
      kind === "pinned" ? ctx?.i18n.t("固定", "Pinned") : ctx?.i18n.t("最近查看", "Recently viewed");
    btn.title = `${kindPrefix} · ${itemName}${labelSuffix}`;
    btn.setAttribute("aria-label", btn.title);

    const slug = item.itemHrid.split("/").pop() || "";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    svg.style.display = "block";
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttributeNS("http://www.w3.org/1999/xlink", "href", `${spriteBase}#${slug}`);
    svg.appendChild(use);
    btn.appendChild(svg);

    if (item.level === null || canEnhance(item.itemHrid)) {
      const badge = document.createElement("span");
      badge.className = "mwi-lite-ms-badge";
      badge.textContent = item.level === null ? ctx?.i18n.t("全", "All") || "All" : `+${item.level}`;
      btn.appendChild(badge);
    }

    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (btn.disabled) return;
      btn.disabled = true;
      closeSettingsPopover(false);
      try {
        if (item.level === null) openItemAllLevels(item.itemHrid);
        else openItemAtLevel(item.itemHrid, item.level);
      } finally {
        btn.disabled = false;
      }
    });

    return btn;
  };

  const syncDom = () => {
    if (!ctx) return;
    const panel = findVisibleMarketPanel();
    if (!panel) {
      closeSettingsPopover(false);
      document.getElementById(BAR_ID)?.remove();
      document.getElementById(JUMP_BAR_ID)?.remove();
      document.getElementById(PIN_BTN_ID)?.remove();
      lastRenderSig = "";
      return;
    }

    const isSummaryView = isElementVisible(panel.querySelector('[class*="MarketplacePanel_itemSummaryTable"]'));
    const isOrderBookView = isElementVisible(panel.querySelector('[class*="MarketplacePanel_orderBooksContainer"]'));
    const curItem = findVisibleCurrentItem(panel);
    const activeDesc: ShortcutItem | null =
      curItem && (isSummaryView || isOrderBookView)
        ? { itemHrid: curItem.itemHrid, level: isSummaryView ? null : curItem.level }
        : null;

    const activeKey = activeDesc ? itemKey(activeDesc) : null;
    if (popoverEl && activeKey && !lastRenderSig.endsWith(`|${activeKey}`)) {
      closeSettingsPopover(false);
    }

    if (activeDesc && !isSummaryView) {
      recordRecent(activeDesc);
    }

    // 1) Render Top Shortcuts Bar below MarketplacePanel_title
    let bar = document.getElementById(BAR_ID);
    if (!bar) {
      bar = document.createElement("div");
      bar.id = BAR_ID;
      bar.setAttribute("data-mwi-lite", "1");
      bar.setAttribute("role", "toolbar");

      const inner = document.createElement("div");
      inner.className = "mwi-lite-ms-inner";

      const scrollWrap = document.createElement("div");
      scrollWrap.className = "mwi-lite-ms-scroll";

      const itemsHost = document.createElement("div");
      itemsHost.className = "mwi-lite-ms-items";
      scrollWrap.appendChild(itemsHost);

      const gearBtn = document.createElement("button");
      gearBtn.type = "button";
      gearBtn.className = "mwi-lite-ms-item mwi-lite-ms-gear";
      gearBtn.textContent = "⚙";
      gearBtn.title = ctx.i18n.t("市场快捷栏设置", "Market Shortcut Settings");
      gearBtn.setAttribute("aria-expanded", "false");
      gearBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSettingsPopover();
      });
      settingsBtnRef = gearBtn;

      inner.append(scrollWrap, gearBtn);
      bar.appendChild(inner);
    }

    const titleEl = panel.querySelector('[class*="MarketplacePanel_title"]');
    const hostParent = titleEl?.parentElement || panel;
    if (bar.parentElement !== hostParent || (titleEl && titleEl.nextElementSibling !== bar)) {
      hostParent.insertBefore(bar, titleEl?.nextElementSibling ?? hostParent.firstChild);
    }

    const pinnedShown = state.pinned.slice(0, state.limit);
    const pinnedSet = new Set(pinnedShown.map(itemKey));
    const recentShown = state.recent.filter((r) => !pinnedSet.has(itemKey(r))).slice(0, state.limit - pinnedShown.length);
    const sig = `${state.limit}|${pinnedShown.map(itemKey).join(",")}|${recentShown.map(itemKey).join(",")}|${activeKey || ""}`;

    if (sig !== lastRenderSig) {
      lastRenderSig = sig;
      const itemsHost = bar.querySelector(".mwi-lite-ms-items");
      if (itemsHost) {
        const spriteBase = resolveSpriteBase();
        const nodes: Node[] = [];
        for (const p of pinnedShown) {
          nodes.push(createShortcutButton(p, "pinned", activeKey, spriteBase));
        }
        if (pinnedShown.length > 0 && recentShown.length > 0) {
          const sep = document.createElement("span");
          sep.className = "mwi-lite-ms-sep";
          sep.setAttribute("role", "separator");
          nodes.push(sep);
        }
        for (const r of recentShown) {
          nodes.push(createShortcutButton(r, "recent", activeKey, spriteBase));
        }
        itemsHost.replaceChildren(...nodes);
      }
    }

    // 2) Render Current-Item Pin Button (top-right) & Enhancement Level Jump Bar (top-left)
    if (!curItem || !activeDesc) {
      document.getElementById(JUMP_BAR_ID)?.remove();
      document.getElementById(PIN_BTN_ID)?.remove();
      return;
    }

    if (!curItem.el.style.position) {
      curItem.el.style.position = "relative";
    }
    curItem.el.classList.add("mwi-lite-current-item-host");

    // 2a) Pin button on top-right of currentItem
    let pinBtn = document.getElementById(PIN_BTN_ID) as HTMLButtonElement | null;
    if (!pinBtn) {
      pinBtn = document.createElement("button");
      pinBtn.id = PIN_BTN_ID;
      pinBtn.type = "button";
      pinBtn.setAttribute("data-mwi-lite", "1");
      pinBtn.textContent = "📌";
    }
    if (pinBtn.parentElement !== curItem.el) {
      curItem.el.appendChild(pinBtn);
    }
    const pinnedNow = isPinned(activeDesc);
    const itemName = ctx.i18n.getItemName(activeDesc.itemHrid);
    const descName =
      activeDesc.level === null
        ? `${itemName} · ${ctx.i18n.t("全", "All")}`
        : canEnhance(activeDesc.itemHrid)
          ? `${itemName} +${activeDesc.level}`
          : itemName;
    pinBtn.classList.toggle("is-pinned", pinnedNow);
    pinBtn.setAttribute("aria-pressed", String(pinnedNow));
    pinBtn.title = pinnedNow
      ? ctx.i18n.t(`取消固定「${descName}」`, `Unpin ${descName}`)
      : ctx.i18n.t(`固定「${descName}」`, `Pin ${descName}`);
    pinBtn.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      togglePin(activeDesc);
      lastRenderSig = "";
      syncDom();
    };

    // 2b) Enhancement Level Jump Bar [0, 5, 7, 8, 10, 12] on top-left of enhanceable items
    if (canEnhance(curItem.itemHrid)) {
      let jumpBar = document.getElementById(JUMP_BAR_ID);
      if (!jumpBar) {
        jumpBar = document.createElement("div");
        jumpBar.id = JUMP_BAR_ID;
        jumpBar.setAttribute("data-mwi-lite", "1");
        for (const lv of ENH_LEVELS) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "mwi-lite-enh-btn";
          btn.textContent = String(lv);
          btn.dataset.level = String(lv);
          btn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const hrid = jumpBar?.dataset.itemHrid;
            if (!hrid || btn.disabled) return;
            btn.disabled = true;
            try {
              openItemAtLevel(hrid, lv);
            } finally {
              btn.disabled = false;
            }
          });
          jumpBar.appendChild(btn);
        }
      }
      if (jumpBar.parentElement !== curItem.el) {
        curItem.el.appendChild(jumpBar);
      }
      jumpBar.dataset.itemHrid = curItem.itemHrid;
      jumpBar.querySelectorAll<HTMLButtonElement>(".mwi-lite-enh-btn").forEach((b) => {
        const lv = Number(b.dataset.level);
        const active = !isSummaryView && curItem.level === lv;
        b.classList.toggle("is-active", active);
        b.title = ctx!.i18n.t(`市场跳转到 +${lv}`, `Open market at +${lv}`);
      });
    } else {
      document.getElementById(JUMP_BAR_ID)?.remove();
    }
  };

  return {
    id: "market-shortcuts-nav",
    nameZh: "市场快捷导航与强化档位跳转",
    nameEn: "Market Shortcuts & Enhancement Jump Bar",
    descriptionZh: "市场顶部固定/最近物品快捷栏（兼容继承 Sunny 固定清单）及可强化装备 0/5/7/8/10/12 一键跳转",
    descriptionEn: "Top pinned/recent market shortcut bar (inherits Sunny pins) and 0/5/7/8/10/12 enhancement jump bar",
    category: "market",
    defaultEnabled: true,
    routes: ["market"],

    init(context) {
      ctx = context;
      state = loadState();

      unregStyle = ctx.addStyle(
        "market-shortcuts-nav",
        `
        #${BAR_ID} {
          display: flex;
          justify-content: center;
          align-items: center;
          width: 100%;
          box-sizing: border-box;
          padding: 8px;
          min-height: 46px;
        }
        #${BAR_ID} .mwi-lite-ms-inner {
          display: flex;
          align-items: center;
          gap: 8px;
          max-width: 100%;
          min-width: 0;
        }
        #${BAR_ID} .mwi-lite-ms-scroll {
          overflow-x: auto;
          min-width: 0;
          max-width: 100%;
          scrollbar-width: thin;
          color-scheme: dark;
        }
        #${BAR_ID} .mwi-lite-ms-items {
          display: flex;
          align-items: center;
          gap: 5px;
          width: max-content;
          min-height: 30px;
        }
        #${BAR_ID} .mwi-lite-ms-sep {
          height: 24px;
          width: 1px;
          flex: 0 0 1px;
          background: rgba(180, 184, 208, 0.4);
          margin: 0 3px;
        }
        #${BAR_ID} .mwi-lite-ms-item {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          flex: 0 0 30px;
          padding: 2px;
          position: relative;
          border: 1px solid rgba(144, 166, 235, 0.55);
          border-radius: 5px;
          background: #282844;
          color: #e8e8ef;
          cursor: pointer;
          box-sizing: border-box;
        }
        #${BAR_ID} .mwi-lite-ms-item.is-pinned {
          border-color: rgba(251, 181, 75, 0.7);
        }
        #${BAR_ID} .mwi-lite-ms-item.is-active {
          background: #404064;
        }
        #${BAR_ID} .mwi-lite-ms-badge {
          position: absolute;
          top: 0;
          left: 1px;
          z-index: 1;
          color: #fbb54b;
          font-size: 12px;
          font-weight: 500;
          line-height: 14px;
          pointer-events: none;
          text-shadow: -1px 0 #131419, 0 1px #131419, 1px 0 #131419, 0 -1px #131419;
        }
        .mwi-lite-current-item-host {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 60px;
          position: relative;
        }
        #${JUMP_BAR_ID} {
          position: absolute;
          right: calc(100% + 6px);
          top: 0;
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 4px;
          z-index: 8;
          white-space: nowrap;
        }
        #${JUMP_BAR_ID} .mwi-lite-enh-btn {
          width: 28px;
          height: 28px;
          min-width: 28px;
          min-height: 28px;
          padding: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #282844;
          border: 1px solid rgba(144, 166, 235, 0.55);
          border-radius: 4px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
          color: #e8e8ef;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          box-sizing: border-box;
        }
        #${JUMP_BAR_ID} .mwi-lite-enh-btn.is-active {
          background: #404064;
          border-color: rgba(251, 181, 75, 0.85);
          color: #fbb54b;
        }
        #${PIN_BTN_ID} {
          position: absolute;
          left: calc(100% + 4px);
          top: 0;
          width: 28px;
          height: 28px;
          min-width: 28px;
          min-height: 28px;
          padding: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(144, 166, 235, 0.55);
          border-radius: 5px;
          background: #282844;
          color: #e8e8ef;
          cursor: pointer;
          z-index: 8;
          box-sizing: border-box;
        }
        #${PIN_BTN_ID}.is-pinned {
          background: #68502d;
          border-color: rgba(251, 181, 75, 0.75);
          color: #fbb54b;
        }
        #${SETTINGS_POPOVER_ID} {
          position: fixed;
          z-index: 10002;
          width: 232px;
          max-width: calc(100vw - 16px);
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 12px;
          box-sizing: border-box;
          border: 1px solid rgba(144, 166, 235, 0.55);
          border-radius: 8px;
          background: #1b1c2c;
          color: #e8e8ef;
          box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
          font-size: 12px;
        }
        #${SETTINGS_POPOVER_ID} .mwi-lite-ms-pop-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        #${SETTINGS_POPOVER_ID} input[type="number"] {
          width: 60px;
          padding: 4px 5px;
          border: 1px solid #666a89;
          border-radius: 4px;
          background: #131419;
          color: #e8e8ef;
          font: inherit;
        }
        #${SETTINGS_POPOVER_ID} .mwi-lite-ms-pop-hint {
          color: #a3a6bd;
          line-height: 1.45;
        }
        #${SETTINGS_POPOVER_ID} .mwi-lite-ms-pop-actions {
          display: flex;
          justify-content: flex-end;
          gap: 6px;
        }
        #${SETTINGS_POPOVER_ID} button {
          padding: 4px 9px;
          border-radius: 4px;
          border: 1px solid #4d5478;
          background: #282844;
          color: #e8e8ef;
          cursor: pointer;
          font-size: 12px;
        }
        #${SETTINGS_POPOVER_ID} button.primary {
          background: #2563eb;
          border-color: #3b82f6;
          color: #fff;
        }
        @media (max-width: 760px) {
          #${JUMP_BAR_ID} { gap: 2px; }
          #${JUMP_BAR_ID} .mwi-lite-enh-btn {
            width: 22px; height: 22px; min-width: 22px; min-height: 22px; font-size: 11px;
          }
        }
        `
      );

      return () => {
        closeSettingsPopover(false);
        unregStyle?.();
        unregStyle = null;
        lastRenderSig = "";
        settingsBtnRef = null;
        document.getElementById(BAR_ID)?.remove();
        document.getElementById(JUMP_BAR_ID)?.remove();
        document.getElementById(PIN_BTN_ID)?.remove();
      };
    },

    onDom() {
      syncDom();
    },
  };
}
