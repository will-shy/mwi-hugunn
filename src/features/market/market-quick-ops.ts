// Credit: Market listing helpers & queue age estimation inspired by Sunny's MWI 增强 (Foreversunny, MIT License) & Toolasha (Celasha, CC-BY-NC-SA-4.0).
import type { FeatureModule, KernelContext } from "../../core/types";
import {
  computeEnhancementPlan,
  createRealisticPriceResolvers,
  detectCharacterEnhancingSetup,
  type CharacterEnhancingSetup,
  type EnhancementCostPlan,
} from "./enhancement-math";

const QUICK_MARK = "data-mwi-lite-qops";
const MARKET_TAX = 0.02;
const ENH_POPUP_ID = "mwi-lite-enh-profit-popup";

function setReactInputValue(input: HTMLInputElement, value: number | string): void {
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  proto?.set?.call(input, String(value));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2).replace(/\.?0+$/, "")}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.?0+$/, "")}K`;
  return String(Math.round(n));
}

function formatSignedCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const sign = n < 0 ? "-" : n > 0 ? "+" : "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(2)}K`;
  return `${sign}${Math.round(abs)}`;
}

function formatAgeDateTime(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function formatElapsedDuration(ageMs: number, isZh: boolean): string {
  const totalMin = Math.max(0, Math.floor(ageMs / 60_000));
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  return isZh ? `${days}天${hours}时${mins}分` : `${days}d ${hours}h ${mins}m`;
}

/** Smooth green (0h) -> yellow (~48h) -> red (>=96h) gradient for listing age. */
function getAgeGradientColor(ageMs: number): string {
  const hours = Math.max(0, ageMs / 3_600_000);
  const ratio = Math.min(1, hours / 96);
  const hue = Math.round(120 * (1 - ratio));
  const sat = Math.round(78 + 6 * ratio);
  const light = Math.round(50 + 4 * ratio);
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

function getCurrentMarketItem(): { itemHrid: string; enhancementLevel: number } | null {
  const cur = document.querySelector('[class*="MarketplacePanel_currentItem"]');
  if (!cur) return null;
  const useEl = cur.querySelector("use");
  const href = useEl?.getAttribute("href") || (useEl as SVGUseElement | null)?.href?.baseVal || "";
  const hash = href.split("#")[1] || "";
  if (!hash) return null;
  const enhEl = cur.querySelector('[class*="Item_enhancementLevel"]');
  const enhancementLevel = enhEl ? Number((enhEl.textContent || "").replace(/\+/g, "").trim()) || 0 : 0;
  return { itemHrid: `/items/${hash}`, enhancementLevel };
}

export function createMarketQuickOpsModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let unregStyle: (() => void) | null = null;
  let unsubs: Array<() => void> = [];
  const processedModals = new WeakSet<Element>();
  const anchors: Array<{ id: number; ts: number }> = [];
  let timers: number[] = [];
  let planCacheKey = "";
  let planCache: { setup: CharacterEnhancingSetup; plan: EnhancementCostPlan | null } | null = null;
  let outsidePopupListenerAttached = false;

  const invalidateEnhPlan = () => {
    planCacheKey = "";
    planCache = null;
  };

  const closeEnhPopup = () => {
    document.getElementById(ENH_POPUP_ID)?.remove();
    if (outsidePopupListenerAttached) {
      document.removeEventListener("pointerdown", onOutsidePopupPointerDown, true);
      outsidePopupListenerAttached = false;
    }
  };

  const onOutsidePopupPointerDown = (e: Event) => {
    const popup = document.getElementById(ENH_POPUP_ID);
    const target = e.target as Element | null;
    if (!popup || !target) {
      closeEnhPopup();
      return;
    }
    if (popup.contains(target) || target.closest(".mwi-lite-ob-hourly-btn")) return;
    closeEnhPopup();
  };

  const getCachedEnhPlan = (
    itemHrid: string,
    enhancementLevel: number
  ): { setup: CharacterEnhancingSetup; plan: EnhancementCostPlan | null } | null => {
    if (!ctx || enhancementLevel < 1) return null;
    const clientData = ctx.gameData.getClientData();
    if (!clientData?.itemDetailMap?.[itemHrid]?.enhancementCosts?.length) return null;

    const key = `${itemHrid}:${enhancementLevel}`;
    if (planCacheKey === key && planCache) return planCache;

    const setup = detectCharacterEnhancingSetup(ctx.gameData);
    const { getBasePrice, getMaterialAsk } = createRealisticPriceResolvers(clientData, ctx.marketStore);

    const plan = computeEnhancementPlan(
      itemHrid,
      enhancementLevel,
      setup,
      clientData,
      ctx.marketStore,
      getBasePrice,
      getMaterialAsk
    );
    planCacheKey = key;
    planCache = { setup, plan };
    return planCache;
  };

  const openEnhDetailsPopup = (
    anchor: HTMLElement,
    itemHrid: string,
    enhancementLevel: number,
    askPrice: number,
    setup: CharacterEnhancingSetup,
    plan: EnhancementCostPlan
  ) => {
    if (!ctx) return;
    closeEnhPopup();

    const netSale = askPrice * (1 - MARKET_TAX);
    const singleProfit = netSale - plan.totalCost;
    const hourlyProfit = plan.totalTimeHours > 0 ? singleProfit / plan.totalTimeHours : 0;

    const popup = document.createElement("div");
    popup.id = ENH_POPUP_ID;
    popup.setAttribute("data-mwi-lite", "1");

    const rect = anchor.getBoundingClientRect();
    const top = Math.min(window.innerHeight - 310, Math.max(10, Math.round(rect.bottom + 6)));
    const left = Math.min(window.innerWidth - 330, Math.max(10, Math.round(rect.left)));
    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;

    const teaNames = setup.activeTeaHrids.length
      ? setup.activeTeaHrids.map((h) => ctx!.i18n.getItemName(h)).join(", ")
      : ctx.i18n.t("无茶水", "None");
    const equipNames = setup.equippedLabels.length
      ? setup.equippedLabels.join(", ")
      : ctx.i18n.t("未检测到强化装备", "No enhancing gear equipped");
    const protLabel =
      plan.protectFrom > 0
        ? ctx.i18n.t(
            `+${plan.protectFrom} 起保护 (${plan.protectItemHrid ? ctx.i18n.getItemName(plan.protectItemHrid) : ""})`,
            `Protect >= +${plan.protectFrom}`
          )
        : ctx.i18n.t("全程不保护", "No protection");

    popup.innerHTML = `
      <div class="mwi-lite-enh-pop-hdr">
        <span>${ctx.i18n.getItemName(itemHrid)} +${enhancementLevel}</span>
        <button type="button" class="mwi-lite-enh-pop-close">✕</button>
      </div>
      <div class="mwi-lite-enh-pop-sec">${ctx.i18n.t("角色实时配装", "Character Setup")}</div>
      <div class="mwi-lite-enh-pop-line"><span>${ctx.i18n.t("强化等级", "Enhancing Lv")}</span><b>${setup.baseEnhancingLevel} → ${setup.effectiveEnhancingLevel.toFixed(1)}</b></div>
      <div class="mwi-lite-enh-pop-line"><span>${ctx.i18n.t("天文台房屋", "Observatory")}</span><b>Lv ${setup.houseLevel}</b></div>
      <div class="mwi-lite-enh-pop-line"><span>${ctx.i18n.t("总成功/速度加成", "Success / Speed")}</span><b>+${setup.toolBonus.toFixed(2)}% / +${setup.speedBonus.toFixed(1)}%</b></div>
      <div class="mwi-lite-enh-pop-line"><span>${ctx.i18n.t("喝茶 / 浓度", "Teas / Conc.")}</span><b>${teaNames} (+${setup.drinkConcentration.toFixed(1)}%)</b></div>
      <div class="mwi-lite-enh-pop-gear" title="${equipNames}">${ctx.i18n.t("配装", "Gear")}: ${equipNames}</div>
      <div class="mwi-lite-enh-pop-sec">${ctx.i18n.t("强化数学期望", "Markov Expectation")}</div>
      <div class="mwi-lite-enh-pop-line"><span>${ctx.i18n.t("最优策略", "Strategy")}</span><b>${protLabel}${plan.mirrorStartLevel ? ` + ${ctx.i18n.t(`贤镜(+${plan.mirrorStartLevel})`, `Mirror(+${plan.mirrorStartLevel})`)}` : ""}</b></div>
      <div class="mwi-lite-enh-pop-line"><span>${ctx.i18n.t("期望次数 / 单件耗时", "Attempts / Time")}</span><b>${plan.attempts.toFixed(1)} · ${plan.totalTimeHours.toFixed(2)}h</b></div>
      <div class="mwi-lite-enh-pop-line"><span>${ctx.i18n.t(`坯子底价 (×${plan.baseCount})`, `Base (×${plan.baseCount})`)}</span><b>${formatCompact(plan.basePrice * plan.baseCount)}</b></div>
      <div class="mwi-lite-enh-pop-line"><span>${ctx.i18n.t("材料 + 保护 + 贤镜 + 茶", "Mats + Prot + Mirror + Tea")}</span><b>${formatCompact(plan.materialCost)} + ${formatCompact(plan.protectionCost)} + ${formatCompact(plan.mirrorCost)} + ${formatCompact(plan.teaCost)}</b></div>
      <div class="mwi-lite-enh-pop-line"><span>${ctx.i18n.t("总期望成本", "Total Cost")}</span><b>${formatCompact(plan.totalCost)}</b></div>
      <div class="mwi-lite-enh-pop-line"><span>${ctx.i18n.t("挂单价 (税后)", "Ask (After 2%)")}</span><b>${formatCompact(netSale)}</b></div>
      <div class="mwi-lite-enh-pop-line mwi-lite-enh-pop-res"><span>${ctx.i18n.t("单次利润 / 工时费/h", "Profit / Hourly")}</span><b style="color:${singleProfit > 0 ? "#4ade80" : "#f87171"}">${formatSignedCompact(singleProfit)} / ${formatSignedCompact(hourlyProfit)}</b></div>
    `;

    popup.querySelector(".mwi-lite-enh-pop-close")?.addEventListener("click", (e) => {
      e.stopPropagation();
      closeEnhPopup();
    });
    document.body.appendChild(popup);

    if (!outsidePopupListenerAttached) {
      document.addEventListener("pointerdown", onOutsidePopupPointerDown, true);
      outsidePopupListenerAttached = true;
    }
  };

  const recordAnchors = (listings: any[]) => {
    if (!Array.isArray(listings)) return;
    let changed = false;
    for (const l of listings) {
      if (!l || typeof l.id !== "number" || !l.createdTimestamp) continue;
      const ts = new Date(l.createdTimestamp).getTime();
      if (!Number.isFinite(ts) || ts <= 0) continue;
      if (!anchors.some((a) => a.id === l.id)) {
        anchors.push({ id: l.id, ts });
        changed = true;
      }
    }
    if (changed) {
      anchors.sort((a, b) => a.id - b.id);
      if (anchors.length > 250) {
        anchors.splice(0, anchors.length - 250);
      }
    }
  };

  const estimateTimestamp = (listingId: number): number => {
    const now = Date.now();
    if (!anchors.length) return now - 3600_000;
    if (anchors.length === 1) return Math.min(now, anchors[0].ts);

    const first = anchors[0];
    const last = anchors[anchors.length - 1];
    if (listingId >= first.id && listingId <= last.id) {
      for (let i = 0; i < anchors.length - 1; i++) {
        const a = anchors[i];
        const b = anchors[i + 1];
        if (listingId >= a.id && listingId <= b.id) {
          if (b.id === a.id) return a.ts;
          const ratio = (listingId - a.id) / (b.id - a.id);
          return Math.min(now, Math.round(a.ts + ratio * (b.ts - a.ts)));
        }
      }
    }

    // Simple linear regression across anchors when outside range
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumXY = 0;
    const n = anchors.length;
    for (const pt of anchors) {
      sumX += pt.id;
      sumY += pt.ts;
      sumXX += pt.id * pt.id;
      sumXY += pt.id * pt.ts;
    }
    const denom = n * sumXX - sumX * sumX;
    if (Math.abs(denom) < 1e-6) return Math.min(now, last.ts);
    const slope = Math.max(0, (n * sumXY - sumX * sumY) / denom);
    const intercept = (sumY - slope * sumX) / n;
    return Math.min(now, Math.max(0, Math.round(intercept + slope * listingId)));
  };

  const handleOrderModal = (modal: Element) => {
    if (!ctx || processedModals.has(modal)) return;
    const header = modal.querySelector('div[class*="MarketplacePanel_header"]');
    if (!header) return;
    processedModals.add(modal);

    const headerText = (header.textContent || "").toLowerCase();
    const translatedHeader = (header.getAttribute("script_translatedfrom") || "").toLowerCase();
    const isBuy =
      headerText.includes("buy") || headerText.includes("购买") || translatedHeader.includes("buy");
    const isSell =
      headerText.includes("sell") || headerText.includes("出售") || translatedHeader.includes("sell");

    // 1) Auto-fill competitive price on listing modals
    const bestPriceLabel = modal.querySelector<HTMLElement>('span[class*="MarketplacePanel_bestPrice"]');
    if (bestPriceLabel) {
      bestPriceLabel.click();
      const t1 = window.setTimeout(() => {
        if (!modal.isConnected) return;
        const priceRow = modal.querySelector('div[class*="MarketplacePanel_priceInputs"]');
        const input = priceRow?.querySelector<HTMLInputElement>('input[type="number"]');
        if (input && ctx) {
          const curVal = Number(input.value);
          if (Number.isFinite(curVal) && curVal > 0) {
            if (isBuy) {
              setReactInputValue(input, ctx.marketStore.stepLegalPrice(curVal, 1));
            } else if (isSell) {
              setReactInputValue(input, ctx.marketStore.stepLegalPrice(curVal, -1));
            }
          }
        }
      }, 45);
      timers.push(t1);
    }

    // 2) Auto-click Max/All on Sell modals
    if (isSell) {
      const t2 = window.setTimeout(() => {
        if (!modal.isConnected) return;
        const maxBtn = Array.from(modal.querySelectorAll("button")).find((b) => {
          const txt = (b.textContent || "").trim();
          return txt === "Max" || txt === "All" || txt === "最大" || txt === "全部";
        });
        if (maxBtn && !maxBtn.disabled) {
          maxBtn.click();
        }
      }, 55);
      timers.push(t2);
    }

    // 3) Inject Ask-1 / Bid+1 (N-1) and ÷2 / ×2 / Max helpers
    const t3 = window.setTimeout(() => {
      if (!modal.isConnected || !ctx || modal.querySelector(`[${QUICK_MARK}]`)) return;

      const priceRow = modal.querySelector('div[class*="MarketplacePanel_priceInputs"]');
      if (priceRow) {
        const priceInput = priceRow.querySelector<HTMLInputElement>('input[type="number"]');
        const btnContainers = priceRow.querySelectorAll('div[class*="MarketplacePanel_buttonContainer"]');
        const refBtn = btnContainers[0]?.querySelector("button");
        const btnCls = refBtn?.className || "";

        if (priceInput) {
          const wrap = document.createElement("div");
          wrap.setAttribute(QUICK_MARK, "price");
          wrap.setAttribute("data-mwi-lite", "1");
          wrap.className = "mwi-lite-qops-group";

          const minusBtn = document.createElement("button");
          minusBtn.type = "button";
          minusBtn.className = `${btnCls} mwi-lite-qops-btn`;
          minusBtn.textContent = ctx.i18n.t("N-1 压价", "Step -1");
          minusBtn.title = ctx.i18n.t("降低 1 个合法价格档位 (Ask-1)", "Decrease by 1 legal price tick");
          minusBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const v = Number(priceInput.value) || 0;
            if (v > 1) setReactInputValue(priceInput, ctx!.marketStore.stepLegalPrice(v, -1));
          });

          const plusBtn = document.createElement("button");
          plusBtn.type = "button";
          plusBtn.className = `${btnCls} mwi-lite-qops-btn`;
          plusBtn.textContent = ctx.i18n.t("+1档", "Step +1");
          plusBtn.title = ctx.i18n.t("提高 1 个合法价格档位 (Bid+1)", "Increase by 1 legal price tick");
          plusBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const v = Number(priceInput.value) || 1;
            setReactInputValue(priceInput, ctx!.marketStore.stepLegalPrice(v, 1));
          });

          wrap.append(minusBtn, plusBtn);
          priceRow.appendChild(wrap);
        }
      }

      const qtyRow = modal.querySelector('div[class*="MarketplacePanel_quantityInputs"]');
      if (qtyRow) {
        const qtyInput = qtyRow.querySelector<HTMLInputElement>('input[type="number"]');
        const refBtn = qtyRow.querySelector("button");
        const btnCls = refBtn?.className || "";

        if (qtyInput) {
          const wrap = document.createElement("div");
          wrap.setAttribute(QUICK_MARK, "qty");
          wrap.setAttribute("data-mwi-lite", "1");
          wrap.className = "mwi-lite-qops-group";

          const divBtn = document.createElement("button");
          divBtn.type = "button";
          divBtn.className = `${btnCls} mwi-lite-qops-btn`;
          divBtn.textContent = "÷2";
          divBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const cur = parseInt(qtyInput.value, 10) || 1;
            setReactInputValue(qtyInput, Math.max(1, Math.floor(cur / 2)));
          });

          const mulBtn = document.createElement("button");
          mulBtn.type = "button";
          mulBtn.className = `${btnCls} mwi-lite-qops-btn`;
          mulBtn.textContent = "×2";
          mulBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const cur = parseInt(qtyInput.value, 10) || 1;
            setReactInputValue(qtyInput, Math.max(1, cur * 2));
          });

          wrap.append(divBtn, mulBtn);
          qtyRow.appendChild(wrap);
        }
      }
    }, 65);
    timers.push(t3);
  };

  const renderOrderBookInsights = () => {
    if (!ctx) return;
    const current = getCurrentMarketItem();
    if (!current) return;

    const ob = ctx.marketStore.getOrderBook(current.itemHrid, current.enhancementLevel);
    if (!ob) return;

    // 1) Queue Length Estimator right below newListingButtonsContainer (never squeeze Buy/Sell flex buttons)
    const btnContainer = document.querySelector('[class*="MarketplacePanel_newListingButtonsContainer"]');
    if (btnContainer) {
      let badgeWrap =
        btnContainer.nextElementSibling?.classList.contains("mwi-lite-queue-depth")
          ? (btnContainer.nextElementSibling as HTMLElement)
          : null;
      if (!badgeWrap) {
        document.querySelectorAll(".mwi-lite-queue-depth").forEach((el) => el.remove());
        badgeWrap = document.createElement("div");
        badgeWrap.className = "mwi-lite-queue-depth";
        badgeWrap.setAttribute("data-mwi-lite", "1");
        btnContainer.insertAdjacentElement("afterend", badgeWrap);
      }

      const calcDepth = (listings: any[]) => {
        if (!listings.length) return { qty: 0, est: false };
        const topPrice = listings[0].price;
        let visible = 0;
        for (const l of listings) {
          if (l.price === topPrice) visible += l.quantity || 0;
        }
        let qty = visible;
        let est = false;
        if (listings.length >= 20 && listings[19]?.price === topPrice && listings[0]?.listingId && listings[19]?.listingId) {
          const tFirst = estimateTimestamp(listings[0].listingId);
          const tLast = estimateTimestamp(listings[19].listingId);
          const span = tLast - tFirst;
          const since = Date.now() - tLast;
          if (span > 0 && since > 0) {
            qty = Math.round(visible * (1 + (19 / 20) * (since / span)));
            est = true;
          }
        }
        return { qty, est };
      };

      const askDepth = calcDepth(ob.asks);
      const bidDepth = calcDepth(ob.bids);
      badgeWrap.innerHTML = `
        <span class="ask">${ctx.i18n.t("卖1队列", "Ask Q")}: ${askDepth.est ? "~" : ""}${formatCompact(askDepth.qty)}</span>
        <span class="bid">${ctx.i18n.t("买1队列", "Bid Q")}: ${bidDepth.est ? "~" : ""}${formatCompact(bidDepth.qty)}</span>
      `;
    }

    // 2) Order book columns: [工时费/h, 单次利润, ~Age] on enhanced Asks, and [~Age] on Bids / +0 Asks
    const obContainer = document.querySelector('[class*="MarketplacePanel_orderBooksContainer"]');
    if (obContainer) {
      const enhBundle = getCachedEnhPlan(current.itemHrid, current.enhancementLevel);
      const hasEnhColumns = Boolean(current.enhancementLevel >= 1 && enhBundle?.plan);

      const knownIdToTs = new Map<number, number>();
      for (const l of ctx.gameData.getMarketListings()) {
        if (l?.id && l?.createdTimestamp) {
          const ts = new Date(l.createdTimestamp).getTime();
          if (Number.isFinite(ts) && ts > 0) knownIdToTs.set(l.id, ts);
        }
      }

      const tables = Array.from(obContainer.querySelectorAll("table"));
      tables.forEach((tbl, tblIdx) => {
        const listings = tblIdx === 0 ? ob.asks : tblIdx === 1 ? ob.bids : [];
        const showEnhForTable = tblIdx === 0 && hasEnhColumns;
        const theadRow = tbl.querySelector("thead tr");
        const tbody = tbl.querySelector("tbody");
        if (!theadRow || !tbody) return;

        // Clean any legacy inline age tags
        tbl.querySelectorAll(".mwi-lite-age-tag").forEach((el) => el.remove());

        // Sync custom column headers: [工时费/h, 单次利润, 估计创建时间, ~Age]
        const desiredMode = showEnhForTable ? "enh-est-age" : "plain-est-age";
        if (theadRow.getAttribute("data-mwi-ob-mode") !== desiredMode) {
          theadRow.querySelectorAll(".mwi-lite-ob-hdr").forEach((el) => el.remove());
          if (showEnhForTable) {
            const thHourly = document.createElement("th");
            thHourly.className = "mwi-lite-ob-hdr mwi-lite-ob-enh";
            thHourly.setAttribute("data-mwi-lite", "1");
            thHourly.textContent = ctx!.i18n.t("工时费/h", "Hourly");

            const thProfit = document.createElement("th");
            thProfit.className = "mwi-lite-ob-hdr mwi-lite-ob-enh";
            thProfit.setAttribute("data-mwi-lite", "1");
            thProfit.textContent = ctx!.i18n.t("单次利润", "Profit");

            theadRow.append(thHourly, thProfit);
          }

          const thEst = document.createElement("th");
          thEst.className = "mwi-lite-ob-hdr mwi-lite-ob-est-hdr";
          thEst.setAttribute("data-mwi-lite", "1");
          thEst.textContent = ctx!.i18n.t("估计创建时间", "Est. Age");

          const thAge = document.createElement("th");
          thAge.className = "mwi-lite-ob-hdr mwi-lite-ob-age";
          thAge.setAttribute("data-mwi-lite", "1");
          thAge.textContent = "~Age";
          thAge.title = ctx!.i18n.t("挂单时间（基于挂单 ID 估算 / 己方为精确时间）", "Estimated listing timestamp");
          theadRow.append(thEst, thAge);
          theadRow.setAttribute("data-mwi-ob-mode", desiredMode);
        }

        const nowMs = Date.now();
        const isZh = ctx!.i18n.isZh();
        const rows = Array.from(tbody.children).filter((tr): tr is HTMLTableRowElement => tr.tagName === "TR");
        rows.forEach((tr, rowIdx) => {
          const listing = rowIdx < listings.length ? listings[rowIdx] : null;
          if (tr.getAttribute("data-mwi-ob-row-mode") !== desiredMode) {
            tr.querySelectorAll(".mwi-lite-ob-cell").forEach((el) => el.remove());
            if (showEnhForTable) {
              const tdHourly = document.createElement("td");
              tdHourly.className = "mwi-lite-ob-cell mwi-lite-ob-hourly";
              tdHourly.setAttribute("data-mwi-lite", "1");

              const tdProfit = document.createElement("td");
              tdProfit.className = "mwi-lite-ob-cell mwi-lite-ob-profit";
              tdProfit.setAttribute("data-mwi-lite", "1");

              tr.append(tdHourly, tdProfit);
            }
            const tdEst = document.createElement("td");
            tdEst.className = "mwi-lite-ob-cell mwi-lite-ob-est-cell";
            tdEst.setAttribute("data-mwi-lite", "1");

            const tdAge = document.createElement("td");
            tdAge.className = "mwi-lite-ob-cell mwi-lite-ob-age-cell";
            tdAge.setAttribute("data-mwi-lite", "1");
            tr.append(tdEst, tdAge);
            tr.setAttribute("data-mwi-ob-row-mode", desiredMode);
          }

          const tdHourly = tr.querySelector<HTMLElement>(".mwi-lite-ob-hourly");
          const tdProfit = tr.querySelector<HTMLElement>(".mwi-lite-ob-profit");
          const tdEst = tr.querySelector<HTMLElement>(".mwi-lite-ob-est-cell");
          const tdAge = tr.querySelector<HTMLElement>(".mwi-lite-ob-age-cell");

          if (!listing || !listing.listingId) {
            if (tdHourly) tdHourly.textContent = "";
            if (tdProfit) tdProfit.textContent = "";
            if (tdEst) tdEst.textContent = "";
            if (tdAge) {
              const isEllipsis = tr.textContent?.includes("...") || tr.textContent?.includes("·");
              const fallbackTxt = isEllipsis ? "· · ·" : "";
              if (tdAge.textContent !== fallbackTxt) {
                tdAge.textContent = fallbackTxt;
                tdAge.style.color = "#6b7280";
              }
            }
            return;
          }

          // Update enhancement Hourly & Single Profit cells
          if (showEnhForTable && tdHourly && tdProfit && enhBundle?.plan) {
            const plan = enhBundle.plan;
            const askPrice = Number(listing.price) || 0;
            const netSale = askPrice * (1 - MARKET_TAX);
            const singleProfit = netSale - plan.totalCost;
            const hourlyProfit = plan.totalTimeHours > 0 ? singleProfit / plan.totalTimeHours : 0;
            const profitColor = singleProfit > 0 ? "#4ade80" : "#9ca3af";

            const hourlyTxt = formatSignedCompact(hourlyProfit);
            const profitTxt = formatSignedCompact(singleProfit);

            let btn = tdHourly.querySelector<HTMLButtonElement>(".mwi-lite-ob-hourly-btn");
            if (!btn) {
              btn = document.createElement("button");
              btn.type = "button";
              btn.className = "mwi-lite-ob-hourly-btn";
              btn.setAttribute("data-mwi-lite", "1");
              tdHourly.appendChild(btn);
            }
            if (btn.textContent !== hourlyTxt) btn.textContent = hourlyTxt;
            btn.style.color = profitColor;
            btn.title = ctx!.i18n.t("点击查看角色强化配装与期望成本明细", "Click for enhancing setup & cost details");
            btn.onclick = (e) => {
              e.stopPropagation();
              openEnhDetailsPopup(
                btn!,
                current.itemHrid,
                current.enhancementLevel,
                askPrice,
                enhBundle.setup,
                plan
              );
            };

            if (tdProfit.textContent !== profitTxt) tdProfit.textContent = profitTxt;
            tdProfit.style.color = profitColor;
          }

          // Update [估计创建时间] (red-green gradient) & [~Age] (MM-DD HH:MM:SS)
          const exactTs = knownIdToTs.get(listing.listingId);
          const ts =
            exactTs ??
            (listing.createdTimestamp
              ? new Date(listing.createdTimestamp).getTime()
              : estimateTimestamp(listing.listingId));
          const ageMs = Math.max(0, nowMs - ts);

          if (tdEst) {
            const estTxt = formatElapsedDuration(ageMs, isZh);
            if (tdEst.textContent !== estTxt) tdEst.textContent = estTxt;
            const estColor = getAgeGradientColor(ageMs);
            if (tdEst.style.color !== estColor) tdEst.style.color = estColor;
          }

          if (tdAge) {
            const txt = formatAgeDateTime(ts);
            if (tdAge.textContent !== txt) tdAge.textContent = txt;
            tdAge.style.color = exactTs ? "#00ff00" : "#00e600";
            tdAge.style.fontWeight = exactTs ? "600" : "400";
            tdAge.title = exactTs
              ? ctx!.i18n.t("你的挂单精确创建时间", "Your listing exact creation time")
              : ctx!.i18n.t("~基于挂单 ID 推算的创建时间", "Estimated listing creation time");
          }
        });
      });
    }
  };

  return {
    id: "market-quick-ops",
    nameZh: "市场快捷操作与排队估算",
    nameEn: "Market Quick Ops & Queue Depth",
    descriptionZh: "自动填竞争价、N-1 合法档位微调、Max/÷2/×2 快捷按钮、最优价队列深度与挂单账龄估算",
    descriptionEn: "Auto-fill best price, N-1 legal tick buttons, Max/÷2/×2 helpers, queue length & listing age",
    category: "market",
    defaultEnabled: true,
    routes: ["market"],

    init(context) {
      ctx = context;

      unregStyle = ctx.addStyle(
        "market-quick-ops",
        `
        .mwi-lite-qops-group {
          display: inline-flex;
          gap: 4px;
          margin-left: 6px;
          align-items: center;
        }
        .mwi-lite-qops-btn {
          padding: 2px 7px !important;
          font-size: 11px !important;
          font-weight: 700 !important;
          font-family: var(--mwi-px-mono, monospace) !important;
          min-width: 34px !important;
          background: var(--mwi-px-btn-bg, linear-gradient(180deg, #324a8f 0%, #22356b 100%)) !important;
          color: #f8fafc !important;
          border: 1px solid var(--mwi-px-border, #8eb1ff) !important;
          border-radius: 0 !important;
          box-shadow: var(--mwi-px-shadow-btn, 0 0 0 1px #080d1a) !important;
          cursor: pointer;
        }
        .mwi-lite-qops-btn:hover { background: var(--mwi-px-btn-hover, linear-gradient(180deg, #405eb3 0%, #2b4385 100%)) !important; }
        .mwi-lite-queue-depth {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          font-size: 11.5px;
          font-family: var(--mwi-px-mono, monospace);
          font-variant-numeric: tabular-nums;
          margin: 3px 0 4px;
          padding: 2px 6px;
          border: 1px solid #2b3f7d;
          background: #0e1634;
          color: #cbd5e1;
        }
        .mwi-lite-queue-depth .ask { color: #fca5a5; }
        .mwi-lite-queue-depth .bid { color: #86efac; }
        .mwi-estimated-age-header,
        .mwi-estimated-age-cell {
          display: none !important;
        }
        .mwi-lite-ob-hdr {
          white-space: nowrap;
          padding: 4px 8px !important;
          text-align: center !important;
          font-size: 11.5px;
          font-family: var(--mwi-px-mono, monospace);
          color: var(--mwi-px-sub, #9dbbff);
        }
        .mwi-lite-ob-cell {
          white-space: nowrap;
          padding: 4px 8px !important;
          text-align: center !important;
          font-family: var(--mwi-px-mono, monospace);
          font-variant-numeric: tabular-nums;
          font-size: 11.5px;
        }
        .mwi-lite-ob-hourly-btn {
          background: none;
          border: none;
          padding: 0;
          margin: 0;
          font: inherit;
          text-decoration: underline;
          cursor: pointer;
        }
        #${ENH_POPUP_ID} {
          position: fixed;
          z-index: 9800;
          width: 318px;
          background: var(--mwi-px-panel-bg, linear-gradient(180deg, #121c3b 0%, #0c1228 100%));
          border: 2px solid var(--mwi-px-border-bright, #d5e5ff);
          border-radius: 0;
          padding: 10px 12px;
          color: var(--mwi-px-text, #e2e8f0);
          font-family: var(--mwi-px-mono, monospace);
          font-variant-numeric: tabular-nums;
          font-size: 11.5px;
          box-shadow: var(--mwi-px-shadow-panel, 0 0 0 2px #060913);
        }
        #${ENH_POPUP_ID} .mwi-lite-enh-pop-hdr {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-weight: 800;
          color: var(--mwi-px-gold, #fde047);
          text-shadow: 1px 1px 0 #070b16;
          padding-bottom: 5px;
          border-bottom: 2px solid var(--mwi-px-border-inner, #4f6fc4);
          margin-bottom: 6px;
        }
        #${ENH_POPUP_ID} .mwi-lite-enh-pop-close {
          background: linear-gradient(180deg, #7f1d1d 0%, #581313 100%);
          border: 1px solid #fca5a5;
          border-radius: 0;
          color: #ffffff;
          font-size: 11.5px;
          font-weight: 700;
          cursor: pointer;
          padding: 1px 6px;
        }
        #${ENH_POPUP_ID} .mwi-lite-enh-pop-sec {
          margin-top: 6px;
          margin-bottom: 2px;
          font-size: 11px;
          font-weight: 800;
          color: var(--mwi-px-sub, #9dbbff);
          border-top: 1px dashed #2b3f7d;
          padding-top: 4px;
        }
        #${ENH_POPUP_ID} .mwi-lite-enh-pop-line {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          padding: 1.5px 0;
        }
        #${ENH_POPUP_ID} .mwi-lite-enh-pop-gear {
          font-size: 11px;
          color: #cbd5e1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-top: 2px;
        }
        #${ENH_POPUP_ID} .mwi-lite-enh-pop-res {
          margin-top: 4px;
          padding-top: 4px;
          border-top: 2px solid var(--mwi-px-border-inner, #4f6fc4);
        }
        `
      );

      recordAnchors(ctx.gameData.getMarketListings());
      let obRefreshTimer: number | null = null;
      const scheduleObRefresh = (invalidatePlan = true) => {
        if (invalidatePlan) invalidateEnhPlan();
        if (ctx?.domScheduler.getActiveRoute() !== "market") return;
        if (obRefreshTimer !== null) return;
        obRefreshTimer = window.setTimeout(() => {
          obRefreshTimer = null;
          if (ctx?.domScheduler.getActiveRoute() !== "market") return;
          const obEl = document.querySelector<HTMLElement>('[class*="MarketplacePanel_orderBooksContainer"]');
          if (obEl && obEl.offsetParent !== null) {
            ctx.domScheduler.scheduleRun(false);
          }
        }, 80);
      };

      const onItemsUpdated = (data: any) => {
        // Inventory item gains (e.g. Claim All) do not alter equipped enhancing setup
        const hasEquipChange = Array.isArray(data?.endCharacterItems)
          ? data.endCharacterItems.some(
              (it: any) => it?.itemLocationHrid && it.itemLocationHrid !== "/item_locations/inventory"
            )
          : true;
        scheduleObRefresh(hasEquipChange);
      };

      unsubs = [
        ctx.gameData.on("character_initialized", () => {
          recordAnchors(ctx?.gameData.getMarketListings() || []);
          scheduleObRefresh(true);
        }),
        ctx.gameData.on("items_updated", onItemsUpdated),
        ctx.gameData.on("skills_updated", () => scheduleObRefresh(true)),
        ctx.gameData.on("house_rooms_updated", () => scheduleObRefresh(true)),
        ctx.gameData.on("consumables_updated", () => scheduleObRefresh(true)),
        ctx.marketStore.onPriceUpdate(() => scheduleObRefresh(true)),
        ctx.wsBus.on("market_listings_updated", (data) => {
          recordAnchors(data?.endMarketListings || []);
          scheduleObRefresh(false);
        }),
        () => {
          if (obRefreshTimer !== null) {
            clearTimeout(obRefreshTimer);
            obRefreshTimer = null;
          }
        },
      ];

      return () => {
        closeEnhPopup();
        unregStyle?.();
        unregStyle = null;
        unsubs.forEach((u) => u());
        unsubs = [];
        timers.forEach((t) => clearTimeout(t));
        timers = [];
        document
          .querySelectorAll(`[${QUICK_MARK}], .mwi-lite-queue-depth, .mwi-lite-age-tag, .mwi-lite-ob-hdr, .mwi-lite-ob-cell`)
          .forEach((el) => el.remove());
        document
          .querySelectorAll('[data-mwi-ob-mode]')
          .forEach((el) => el.removeAttribute("data-mwi-ob-mode"));
        document
          .querySelectorAll('[data-mwi-ob-row-mode]')
          .forEach((el) => el.removeAttribute("data-mwi-ob-row-mode"));
      };
    },

    onDom(doc) {
      doc.querySelectorAll('[class*="Modal_modalContainer"]').forEach(handleOrderModal);
      renderOrderBookInsights();
    },
  };
}
