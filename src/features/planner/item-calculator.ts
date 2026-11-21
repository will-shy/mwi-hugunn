import type { FeatureModule, KernelContext, PanelRoute } from "../../core/types";

const STORAGE_KEY_TARGETS = "calc_targets_v1";
const STORAGE_KEY_CATS = "calc_cats_v1";
const TAB_BTN_ID = "mwi-lite-calculator-tab";
const TAB_PANEL_ID = "mwi-lite-calculator-panel";
const IMPORT_BTN_CLASS = "mwi-lite-import-tasks-btn";

const ITEM_CATEGORIES = [
  "/item_categories/task",
  "/item_categories/house_rooms",
  "/item_categories/currency",
  "/item_categories/loot",
  "/item_categories/key",
  "/item_categories/labyrinth",
  "/item_categories/dungeon_key",
  "/item_categories/food",
  "/item_categories/tea",
  "/item_categories/coffee",
  "/item_categories/drink",
  "/item_categories/ability_book",
  "/item_categories/equipment",
  "/item_categories/materials",
  "/item_categories/resource",
];

const PROCESSABLE_ITEMS = new Map<string, string>([
  ["/items/milk", "/items/cheese"],
  ["/items/verdant_milk", "/items/verdant_cheese"],
  ["/items/azure_milk", "/items/azure_cheese"],
  ["/items/burble_milk", "/items/burble_cheese"],
  ["/items/crimson_milk", "/items/crimson_cheese"],
  ["/items/rainbow_milk", "/items/rainbow_cheese"],
  ["/items/holy_milk", "/items/holy_cheese"],
  ["/items/log", "/items/lumber"],
  ["/items/birch_log", "/items/birch_lumber"],
  ["/items/cedar_log", "/items/cedar_lumber"],
  ["/items/purpleheart_log", "/items/purpleheart_lumber"],
  ["/items/ginkgo_log", "/items/ginkgo_lumber"],
  ["/items/redwood_log", "/items/redwood_lumber"],
  ["/items/arcane_log", "/items/arcane_lumber"],
  ["/items/cotton", "/items/cotton_fabric"],
  ["/items/flax", "/items/linen_fabric"],
  ["/items/bamboo_branch", "/items/bamboo_fabric"],
  ["/items/cocoon", "/items/silk_fabric"],
  ["/items/radiant_fiber", "/items/radiant_fabric"],
  ["/items/rough_hide", "/items/rough_leather"],
  ["/items/reptile_hide", "/items/reptile_leather"],
  ["/items/gobo_hide", "/items/gobo_leather"],
  ["/items/beast_hide", "/items/beast_leather"],
  ["/items/umbral_hide", "/items/umbral_leather"],
]);

interface TargetEntry {
  itemHrid: string;
  count: number;
  needCalc: boolean;
  categoryOverride?: string | null;
  taskRemaining?: number | null;
  ownedAtImport?: number | null;
  taskDone?: number | null;
  taskTotal?: number | null;
  maxCrafted?: number;
}

interface PendingMarketPrefill {
  itemHrid: string;
  quantity: number;
  seen: boolean;
  filledInputs: WeakSet<HTMLInputElement>;
  expiresAt: number;
}

function formatNum(num: number): string {
  if (!Number.isFinite(num)) return "0";
  if (Math.abs(num) <= 999) {
    const fixed = num.toFixed(1);
    return fixed.endsWith(".0") ? String(Math.round(num)) : fixed;
  }
  if (Math.abs(num) <= 99999) return String(Math.ceil(num));
  if (Math.abs(num) <= 9999999) return `${Math.floor(num / 1000)}K`;
  if (Math.abs(num) <= 9999999999) return `${Math.floor(num / 1e6)}M`;
  return `${Math.floor(num / 1e9)}B`;
}

function resolveSpriteBase(prefix: string, fallback: string): string {
  const use = document.querySelector(`use[href*="${prefix}"]`);
  const href = use?.getAttribute("href");
  if (href && href.includes("#")) return href.split("#")[0];
  return fallback;
}

function createSpriteSvg(spritePrefix: string, fallbackUrl: string, symbolId: string): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.style.display = "block";
  svg.style.flexShrink = "0";
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttributeNS(
    "http://www.w3.org/1999/xlink",
    "href",
    `${resolveSpriteBase(spritePrefix, fallbackUrl)}#${symbolId}`
  );
  svg.appendChild(use);
  return svg;
}

function findMarketplaceComponent(el: Element): any | null {
  const fiberKey = Reflect.ownKeys(el).find(
    (k) => typeof k === "string" && (k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"))
  );
  let fiber: any = fiberKey ? (el as any)[fiberKey] : null;
  for (let d = 0; fiber && d < 30; d++, fiber = fiber.return) {
    const sn = fiber.stateNode;
    if (sn?.state && "showPostListing" in sn.state && typeof sn.handleQuantityInputChanged === "function") {
      return sn;
    }
  }
  return null;
}

function isElementVisible(el: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (node.hidden) return false;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

export function createItemCalculatorModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let unregStyle: (() => void) | null = null;
  let unsubs: Array<() => void> = [];
  let targets = new Map<string, TargetEntry>();
  let catEnabled = new Map<string, boolean>();
  let tabButton: HTMLButtonElement | null = null;
  let tabPanel: HTMLDivElement | null = null;
  let listHost: HTMLDivElement | null = null;
  let renderTimer: number | null = null;
  let pendingPrefill: PendingMarketPrefill | null = null;
  let lastCharId: string | number | null = null;

  const getCharScope = () => String(ctx?.gameData.getCharacterId() ?? "default");

  const loadSaved = () => {
    if (!ctx) return;
    const scope = getCharScope();
    lastCharId = scope;
    const savedTargets = ctx.storage.get<TargetEntry[]>(`${STORAGE_KEY_TARGETS}_${scope}`, []);
    const savedCats = ctx.storage.get<Record<string, boolean>>(`${STORAGE_KEY_CATS}_${scope}`, {});
    targets = new Map();
    for (const t of savedTargets) {
      if (t?.itemHrid) targets.set(t.itemHrid, t);
    }
    catEnabled = new Map();
    for (const c of ITEM_CATEGORIES) {
      catEnabled.set(c, typeof savedCats[c] === "boolean" ? savedCats[c] : true);
    }
  };

  const saveAll = () => {
    if (!ctx) return;
    const scope = getCharScope();
    ctx.storage.set(`${STORAGE_KEY_TARGETS}_${scope}`, Array.from(targets.values()));
    ctx.storage.set(`${STORAGE_KEY_CATS}_${scope}`, Object.fromEntries(catEnabled.entries()));
  };

  const getItemCategory = (itemHrid: string, override?: string | null): string => {
    if (override) return override;
    if (itemHrid.startsWith("/house_rooms/")) return "/item_categories/house_rooms";
    if (Array.from(PROCESSABLE_ITEMS.values()).includes(itemHrid)) return "/item_categories/materials";
    if (itemHrid.endsWith("_tea")) return "/item_categories/tea";
    if (itemHrid.endsWith("_coffee")) return "/item_categories/coffee";
    return ctx?.gameData.getClientData()?.itemDetailMap?.[itemHrid]?.categoryHrid || "/item_categories/materials";
  };

  const getInventoryCountMap = (): Map<string, number> => {
    const map = new Map<string, number>();
    if (!ctx) return map;
    for (const item of ctx.gameData.getCharacterItems()) {
      if (!item || item.itemLocationHrid !== "/item_locations/inventory" || (item.enhancementLevel || 0) !== 0) {
        continue;
      }
      map.set(item.itemHrid, (map.get(item.itemHrid) || 0) + (item.count || 0));
    }
    return map;
  };

  const getDrinkConcentration = (): number => {
    if (!ctx) return 1;
    const clientData = ctx.gameData.getClientData();
    const gp = clientData?.itemDetailMap?.["/items/guzzling_pouch"]?.equipmentDetail;
    const multTable = clientData?.enhancementLevelTotalBonusMultiplierTable || [];
    let bestEnh = -1;
    for (const item of ctx.gameData.getCharacterItems()) {
      if (item?.itemHrid === "/items/guzzling_pouch") {
        bestEnh = Math.max(bestEnh, item.enhancementLevel || 0);
      }
    }
    if (bestEnh >= 0 && gp) {
      return (
        1 +
        (gp.noncombatStats?.drinkConcentration || 0) +
        (gp.noncombatEnhancementBonuses?.drinkConcentration || 0) * (multTable[bestEnh] || 0)
      );
    }
    return 1;
  };

  const tryGetRecipe = (itemHrid: string): { inputs: Array<{ itemHrid: string; count: number }>; outputCount: number } | null => {
    if (!ctx) return null;
    const clientData = ctx.gameData.getClientData();
    if (!clientData) return null;

    const slug = itemHrid.split("/").pop() || "";
    const shopDetail = clientData.shopItemDetailMap?.[`/shop_items/${slug}`];
    if (shopDetail?.category === "/shop_categories/dungeon" && Array.isArray(shopDetail.costs)) {
      return {
        inputs: shopDetail.costs.map((c: any) => ({ itemHrid: c.itemHrid, count: c.count })),
        outputCount: 1,
      };
    }

    const drinkSlotsMap = ctx.gameData.getActionTypeDrinkSlots();
    const conc = getDrinkConcentration();

    const craftTypes = ["cheesesmithing", "crafting", "tailoring", "cooking", "brewing"];
    for (const actType of craftTypes) {
      const act = clientData.actionDetailMap?.[`/actions/${actType}/${slug}`];
      if (!act) continue;
      const drinks = drinkSlotsMap.get(`/action_types/${actType}`) || [];
      const hasArtisan = drinks.some((d: any) => d?.itemHrid === "/items/artisan_tea");
      const hasGourmet = drinks.some((d: any) => d?.itemHrid === "/items/gourmet_tea");
      const artisanBuff = hasArtisan ? 0.1 * conc : 0;
      const gourmetBuff = hasGourmet && (actType === "cooking" || actType === "brewing") ? 0.12 * conc : 0;

      const inputs: Array<{ itemHrid: string; count: number }> = (act.inputItems || []).map((i: any) => ({
        itemHrid: i.itemHrid,
        count: i.count * (1 - artisanBuff),
      }));
      if (act.upgradeItemHrid) {
        inputs.push({ itemHrid: act.upgradeItemHrid, count: 1 });
      }
      const matchedOut = (act.outputItems || []).find((o: any) => o.itemHrid === itemHrid);
      const outputCount = (matchedOut?.count || 1) * (1 + gourmetBuff);
      return { inputs, outputCount };
    }
    return null;
  };

  const computeRequiredMap = (inventoryPool: Map<string, number>): Map<string, number> => {
    const result = new Map<string, number>();
    const queue = new Map<string, number>();
    const clientData = ctx?.gameData.getClientData();
    const houseRooms = ctx?.gameData.getHouseRooms() || new Map();

    for (const target of targets.values()) {
      const cat = getItemCategory(target.itemHrid, target.categoryOverride);
      if (!target.needCalc || catEnabled.get(cat) === false) continue;

      if (target.itemHrid.startsWith("/house_rooms/")) {
        const curLv = houseRooms.get(target.itemHrid)?.level || 0;
        const costsMap = clientData?.houseRoomDetailMap?.[target.itemHrid]?.upgradeCostsMap;
        if (costsMap) {
          for (let lv = curLv + 1; lv <= target.count && lv <= 8; lv++) {
            const arr = costsMap[lv];
            if (!Array.isArray(arr)) continue;
            for (const c of arr) {
              queue.set(c.itemHrid, (queue.get(c.itemHrid) || 0) + c.count);
            }
          }
        }
      } else if (target.count < 0) {
        inventoryPool.set(target.itemHrid, (inventoryPool.get(target.itemHrid) || 0) - target.count);
      } else if (target.categoryOverride === "/item_categories/task" && (target.taskRemaining || 0) > 0) {
        const ownedNow = inventoryPool.get(target.itemHrid) || 0;
        const crafted = Math.max(0, ownedNow - (target.ownedAtImport || 0));
        if (crafted > (target.maxCrafted || 0)) target.maxCrafted = crafted;
        const remTask = Math.max(0, (target.taskRemaining || 0) - (target.maxCrafted || 0));
        if (remTask > 0) {
          result.set(target.itemHrid, (result.get(target.itemHrid) || 0) + remTask);
          inventoryPool.set(target.itemHrid, (inventoryPool.get(target.itemHrid) || 0) + remTask);
          const recipe = tryGetRecipe(target.itemHrid);
          if (recipe) {
            const times = Math.ceil(remTask / recipe.outputCount);
            for (const inp of recipe.inputs) {
              queue.set(inp.itemHrid, (queue.get(inp.itemHrid) || 0) + inp.count * times);
            }
          }
        }
      } else {
        queue.set(target.itemHrid, (queue.get(target.itemHrid) || 0) + target.count);
      }
    }

    let guard = 0;
    while (queue.size > 0 && guard++ < 5000) {
      const [hrid, need] = queue.entries().next().value as [string, number];
      queue.delete(hrid);
      const have = inventoryPool.get(hrid) || 0;
      const used = Math.min(have, need);
      if (used > 0) inventoryPool.set(hrid, have - used);
      const remain = need - used;
      if (remain > 0) {
        result.set(hrid, (result.get(hrid) || 0) + remain);
        const recipe = tryGetRecipe(hrid);
        if (!recipe) continue;
        const times = Math.ceil(remain / recipe.outputCount);
        for (const inp of recipe.inputs) {
          queue.set(inp.itemHrid, (queue.get(inp.itemHrid) || 0) + inp.count * times);
        }
      }
    }

    return result;
  };

  const openMarketAndPrefill = (itemHrid: string, qty: number) => {
    if (!ctx || !itemHrid.startsWith("/items/")) return;
    const count = Math.ceil(qty);
    if (!Number.isSafeInteger(count) || count <= 0) return;

    const core = ctx.gameData.getReactGameCore();
    if (typeof core?.handleGoToMarketplace !== "function") return;

    pendingPrefill = {
      itemHrid,
      quantity: count,
      seen: false,
      filledInputs: new WeakSet(),
      expiresAt: Date.now() + 10_000,
    };

    try {
      core.handleGoToMarketplace(itemHrid, 0);
      tryApplyMarketPrefill();
    } catch {
      pendingPrefill = null;
    }
  };

  const tryApplyMarketPrefill = () => {
    if (!pendingPrefill) return;
    if (Date.now() > pendingPrefill.expiresAt && !pendingPrefill.seen) {
      pendingPrefill = null;
      return;
    }

    const marketPanels = Array.from(document.querySelectorAll<HTMLElement>('[class*="MarketplacePanel_marketListings"]'));
    const matchingMarket = marketPanels.some((panel) => {
      if (!isElementVisible(panel)) return false;
      const comp = findMarketplaceComponent(panel);
      return comp?.state?.itemHrid === pendingPrefill?.itemHrid && Number(comp?.state?.enhancementLevel || 0) === 0;
    });

    if (matchingMarket) {
      pendingPrefill.seen = true;
    } else if (pendingPrefill.seen) {
      pendingPrefill = null;
      return;
    }

    const inputs = document.querySelectorAll<HTMLInputElement>(
      '[class*="MarketplacePanel_modalContent"] [class*="quantityInputs"] input'
    );
    for (const input of inputs) {
      if (
        pendingPrefill.filledInputs.has(input) ||
        input.disabled ||
        input.readOnly ||
        !isElementVisible(input)
      ) {
        continue;
      }
      const comp = findMarketplaceComponent(input);
      if (
        !comp?.state?.showPostListing ||
        comp.state.isSell !== false ||
        comp.state.itemHrid !== pendingPrefill.itemHrid ||
        Number(comp.state.enhancementLevelInput || 0) !== 0
      ) {
        continue;
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!setter) continue;
      pendingPrefill.filledInputs.add(input);
      setter.call(input, String(pendingPrefill.quantity));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  const importTasksToCalculator = (): number => {
    if (!ctx) return 0;
    const actionDetailMap = ctx.gameData.getClientData()?.actionDetailMap;
    if (!actionDetailMap) return 0;

    const taskEls = document.querySelectorAll('[class*="RandomTask_randomTask"]');
    if (!taskEls.length) return 0;

    const inv = getInventoryCountMap();
    const taskInfoMap = new Map<string, { done: number; total: number; remaining: number }>();

    for (const el of taskEls) {
      const fKey = Reflect.ownKeys(el).find(
        (k) => typeof k === "string" && (k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"))
      );
      if (!fKey) continue;
      let actionHrid: string | null = null;
      let f: any = (el as any)[fKey];
      for (let d = 0; f && d < 20; d++, f = f.return) {
        const props = f.memoizedProps;
        if (!props) continue;
        if (props.task?.actionHrid) {
          actionHrid = props.task.actionHrid;
          break;
        }
        if (props.randomTask?.actionHrid) {
          actionHrid = props.randomTask.actionHrid;
          break;
        }
        if (props.actionHrid) {
          actionHrid = props.actionHrid;
          break;
        }
      }
      if (!actionHrid) continue;

      const info = el.querySelector('[class*="RandomTask_taskInfo"]');
      if (!info) continue;
      let done = 0;
      let total = 0;
      for (const div of info.querySelectorAll("div")) {
        const m = (div.textContent || "").match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);
        if (m) {
          done = parseInt(m[1].replace(/,/g, ""), 10) || 0;
          total = parseInt(m[2].replace(/,/g, ""), 10) || 0;
          break;
        }
      }
      const rem = Math.max(0, total - done);
      if (rem <= 0) continue;

      const act = actionDetailMap[actionHrid];
      if (!act?.inputItems?.length || !act?.outputItems?.length) continue;
      const outHrid = act.outputItems[0]?.itemHrid;
      if (!outHrid) continue;

      const prev = taskInfoMap.get(outHrid) || { done: 0, total: 0, remaining: 0 };
      taskInfoMap.set(outHrid, {
        done: prev.done + done,
        total: prev.total + total,
        remaining: prev.remaining + rem,
      });
    }

    if (!taskInfoMap.size) return 0;

    for (const [k, v] of targets) {
      if (v.categoryOverride === "/item_categories/task") targets.delete(k);
    }

    for (const [outHrid, stat] of taskInfoMap) {
      targets.set(outHrid, {
        itemHrid: outHrid,
        count: stat.total,
        needCalc: true,
        categoryOverride: "/item_categories/task",
        taskRemaining: stat.remaining,
        taskDone: stat.done,
        taskTotal: stat.total,
        ownedAtImport: inv.get(outHrid) || 0,
        maxCrafted: 0,
      });
    }
    saveAll();
    scheduleRender();
    return taskInfoMap.size;
  };

  const renderCalculatorContent = () => {
    if (!ctx || !listHost || !tabPanel || tabPanel.style.display === "none") return;

    const inv = getInventoryCountMap();
    const houseRooms = ctx.gameData.getHouseRooms();
    const totalNeeds = computeRequiredMap(new Map());
    const remainNeeds = computeRequiredMap(new Map(inv));
    const clientData = ctx.gameData.getClientData();

    // Left column: Targets grouped by category
    const catTargetRows = new Map<string, TargetEntry[]>();
    for (const t of targets.values()) {
      const cat = getItemCategory(t.itemHrid, t.categoryOverride);
      const arr = catTargetRows.get(cat) || [];
      arr.push(t);
      catTargetRows.set(cat, arr);
    }

    const leftEl = listHost.querySelector<HTMLElement>(".mwi-lite-calc-left");
    const rightEl = listHost.querySelector<HTMLElement>(".mwi-lite-calc-right");
    if (!leftEl || !rightEl) return;

    leftEl.innerHTML = "";
    for (const cat of ITEM_CATEGORIES) {
      const list = catTargetRows.get(cat);
      if (!list?.length) continue;
      list.sort(
        (a, b) =>
          (clientData?.itemDetailMap?.[a.itemHrid]?.sortIndex || 9999) -
          (clientData?.itemDetailMap?.[b.itemHrid]?.sortIndex || 9999)
      );

      const isCatOn = catEnabled.get(cat) !== false;
      const details = document.createElement("details");
      details.open = true;
      details.className = `mwi-lite-calc-cat ${isCatOn ? "active" : "muted"}`;

      const summary = document.createElement("summary");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = isCatOn;
      cb.addEventListener("change", () => {
        catEnabled.set(cat, cb.checked);
        saveAll();
        renderCalculatorContent();
      });

      const titleSpan = document.createElement("span");
      titleSpan.textContent =
        cat === "/item_categories/task"
          ? ctx.i18n.t("任务", "Tasks")
          : cat === "/item_categories/house_rooms"
            ? ctx.i18n.t("房屋", "House")
            : ctx.i18n.getName(cat, "itemCategoryNames") || cat.split("/").pop() || "";

      const clearBtn = document.createElement("span");
      clearBtn.className = "mwi-lite-calc-x";
      clearBtn.textContent = "✕";
      clearBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        for (const t of list) targets.delete(t.itemHrid);
        saveAll();
        renderCalculatorContent();
      });

      summary.append(cb, titleSpan, clearBtn);
      details.appendChild(summary);

      for (const item of list) {
        const row = document.createElement("div");
        row.className = `mwi-lite-calc-row ${item.needCalc ? "" : "off"}`;

        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = item.needCalc;
        check.addEventListener("change", () => {
          item.needCalc = check.checked;
          saveAll();
          renderCalculatorContent();
        });

        const isHouse = item.itemHrid.startsWith("/house_rooms/");
        const nameLabel = isHouse ? ctx.i18n.getHouseRoomName(item.itemHrid) : ctx.i18n.getItemName(item.itemHrid);
        const icon = isHouse
          ? createSpriteSvg(
              "skills_sprite",
              "/static/media/skills_sprite.3bb4d936.svg",
              (clientData?.houseRoomDetailMap?.[item.itemHrid]?.skillHrid || "").split("/").pop() || "house"
            )
          : createSpriteSvg("items_sprite", "/static/media/items_sprite.9c39e2ec.svg", item.itemHrid.split("/").pop() || "");

        const labelBtn = document.createElement("div");
        labelBtn.className = "mwi-lite-calc-itemname";
        labelBtn.append(icon, Object.assign(document.createElement("span"), { textContent: nameLabel }));
        if (!isHouse) {
          labelBtn.title = ctx.i18n.t("双击前往市场购买缺口", "Dbl-click to buy shortage in Market");
          labelBtn.addEventListener("dblclick", () => {
            const owned = inv.get(item.itemHrid) || 0;
            openMarketAndPrefill(item.itemHrid, Math.max(1, item.count - owned));
          });
        }

        const ownedVal = isHouse
          ? houseRooms.get(item.itemHrid)?.level || 0
          : item.categoryOverride === "/item_categories/task"
            ? Math.min((item.taskDone || 0) + (item.maxCrafted || 0), item.taskTotal || item.count)
            : inv.get(item.itemHrid) || 0;

        const rightControls = document.createElement("div");
        rightControls.className = "mwi-lite-calc-rightctrl";

        const ownedSpan = document.createElement("span");
        ownedSpan.textContent = formatNum(ownedVal);

        const input = document.createElement("input");
        input.type = "text";
        input.className = "mwi-lite-calc-num";
        input.value = String(item.count);
        if (item.categoryOverride === "/item_categories/task") {
          input.readOnly = true;
        } else {
          input.addEventListener("change", () => {
            const v = parseInt(input.value, 10) || 0;
            item.count = v;
            saveAll();
            renderCalculatorContent();
          });
        }

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "mwi-lite-calc-del";
        delBtn.textContent = "✕";
        delBtn.addEventListener("click", () => {
          targets.delete(item.itemHrid);
          saveAll();
          renderCalculatorContent();
        });

        rightControls.append(ownedSpan, document.createTextNode("/"), input, delBtn);
        row.append(check, labelBtn, rightControls);
        details.appendChild(row);
      }

      leftEl.appendChild(details);
    }

    // Right column: Shortages + Total cost estimate + All Required
    rightEl.innerHTML = "";
    let estTotalGold = 0;

    const shortageWrap = document.createElement("details");
    shortageWrap.open = true;
    shortageWrap.className = "mwi-lite-calc-shortages";
    const shortageSummary = document.createElement("summary");

    const sortedItems = Array.from(totalNeeds.keys()).sort(
      (a, b) =>
        (clientData?.itemDetailMap?.[a]?.sortIndex || 9999) -
        (clientData?.itemDetailMap?.[b]?.sortIndex || 9999)
    );

    const shortageListEl = document.createElement("div");
    const reqListEl = document.createElement("div");

    for (const hrid of sortedItems) {
      const req = totalNeeds.get(hrid) || 0;
      const short = remainNeeds.get(hrid) || 0;
      const have = inv.get(hrid) || 0;
      const name = ctx.i18n.getItemName(hrid);

      if (short > 0) {
        const p = ctx.marketStore.getPrice(hrid, 0);
        const unit = p?.ask ?? p?.bid ?? 0;
        estTotalGold += unit * short;

        const row = document.createElement("div");
        row.className = "mwi-lite-calc-row";
        row.title = ctx.i18n.t("双击前往市场自动填入缺口数量", "Dbl-click to open Market & prefill shortage");
        row.addEventListener("dblclick", () => openMarketAndPrefill(hrid, short));

        const left = document.createElement("div");
        left.className = "mwi-lite-calc-itemname";
        left.append(
          createSpriteSvg("items_sprite", "/static/media/items_sprite.9c39e2ec.svg", hrid.split("/").pop() || ""),
          Object.assign(document.createElement("span"), { textContent: name })
        );

        const badge = document.createElement("span");
        badge.className = "mwi-lite-calc-short-badge";
        badge.textContent = formatNum(short);
        row.append(left, badge);
        shortageListEl.appendChild(row);
      }

      const rRow = document.createElement("div");
      rRow.className = "mwi-lite-calc-row";
      rRow.addEventListener("dblclick", () => {
        if (short > 0) openMarketAndPrefill(hrid, short);
      });
      const rLeft = document.createElement("div");
      rLeft.className = "mwi-lite-calc-itemname";
      rLeft.append(
        createSpriteSvg("items_sprite", "/static/media/items_sprite.9c39e2ec.svg", hrid.split("/").pop() || ""),
        Object.assign(document.createElement("span"), { textContent: name })
      );
      const net = short > 0 ? -short : have;
      const rRight = document.createElement("span");
      rRight.style.color = short > 0 ? "#f87171" : "#86efac";
      rRight.textContent = `${formatNum(net)} / ${formatNum(req)}`;
      rRow.append(rLeft, rRight);
      reqListEl.appendChild(rRow);
    }

    shortageSummary.textContent = `${ctx.i18n.t("缺口", "Shortages")}${
      estTotalGold > 0 ? ` (≈ ${formatNum(estTotalGold)})` : ""
    }`;
    shortageWrap.append(shortageSummary, shortageListEl);

    const reqWrap = document.createElement("details");
    reqWrap.className = "mwi-lite-calc-required";
    const reqSummary = document.createElement("summary");
    reqSummary.textContent = ctx.i18n.t("详情 (净值/总需求)", "Details (Net/Required)");
    reqWrap.append(reqSummary, reqListEl);

    rightEl.append(shortageWrap, reqWrap);
  };

  const scheduleRender = () => {
    if (!tabPanel || tabPanel.style.display === "none") return;
    if (renderTimer !== null) clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => {
      renderTimer = null;
      renderCalculatorContent();
    }, 180);
  };

  const buildCalculatorPanelDom = (): HTMLDivElement => {
    const panel = document.createElement("div");
    panel.className = "mwi-lite-calc-root";
    panel.setAttribute("data-mwi-lite", "1");

    // Top controls: Item search + House upgrade selector
    const topBar = document.createElement("div");
    topBar.className = "mwi-lite-calc-topbar";

    const searchWrap = document.createElement("div");
    searchWrap.className = "mwi-lite-calc-searchbox";
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = ctx!.i18n.t("搜索物品名称...", "Search item...");

    const dropdown = document.createElement("div");
    dropdown.className = "mwi-lite-calc-dropdown";
    dropdown.style.display = "none";

    const qtyInput = document.createElement("input");
    qtyInput.type = "text";
    qtyInput.className = "mwi-lite-calc-qty";
    qtyInput.value = "1";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "mwi-lite-calc-add";
    addBtn.textContent = ctx!.i18n.t("添加", "Add");

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "mwi-lite-calc-clear";
    clearBtn.textContent = ctx!.i18n.t("清空", "Clear");

    const commitItem = () => {
      const hrid = ctx!.i18n.getItemHridByName(searchInput.value.trim());
      if (!hrid) return;
      const cnt = parseInt(qtyInput.value, 10) || 1;
      const existing = targets.get(hrid);
      if (existing) {
        if (existing.categoryOverride !== "/item_categories/task") existing.count += cnt;
      } else {
        targets.set(hrid, { itemHrid: hrid, count: cnt, needCalc: true });
      }
      searchInput.value = "";
      qtyInput.value = "1";
      dropdown.style.display = "none";
      saveAll();
      renderCalculatorContent();
    };

    searchInput.addEventListener("input", () => {
      const q = searchInput.value.trim().toLowerCase();
      if (q.length < 1) {
        dropdown.style.display = "none";
        return;
      }
      const itemMap = ctx?.gameData.getClientData()?.itemDetailMap;
      if (!itemMap) return;
      const hits = Object.keys(itemMap)
        .filter((h) => ctx!.i18n.getItemName(h).toLowerCase().includes(q))
        .slice(0, 30);
      if (!hits.length) {
        dropdown.style.display = "none";
        return;
      }
      dropdown.innerHTML = "";
      for (const hrid of hits) {
        const opt = document.createElement("div");
        opt.className = "mwi-lite-calc-opt";
        opt.append(
          createSpriteSvg("items_sprite", "/static/media/items_sprite.9c39e2ec.svg", hrid.split("/").pop() || ""),
          Object.assign(document.createElement("span"), { textContent: ctx!.i18n.getItemName(hrid) })
        );
        opt.addEventListener("click", () => {
          searchInput.value = ctx!.i18n.getItemName(hrid);
          dropdown.style.display = "none";
        });
        dropdown.appendChild(opt);
      }
      dropdown.style.display = "block";
    });
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commitItem();
      else if (e.key === "Escape") dropdown.style.display = "none";
    });
    addBtn.addEventListener("click", commitItem);
    clearBtn.addEventListener("click", () => {
      targets.clear();
      saveAll();
      renderCalculatorContent();
    });

    searchWrap.append(searchInput, qtyInput, addBtn, clearBtn, dropdown);

    // House room selector
    const houseWrap = document.createElement("div");
    houseWrap.className = "mwi-lite-calc-housebox";
    const houseSelect = document.createElement("select");
    const houseRoomsMap = ctx!.gameData.getClientData()?.houseRoomDetailMap || {};
    for (const hr of Object.values<any>(houseRoomsMap).sort((a, b) => (a.sortIndex ?? 99) - (b.sortIndex ?? 99))) {
      const opt = document.createElement("option");
      opt.value = hr.hrid;
      opt.textContent = ctx!.i18n.getHouseRoomName(hr.hrid);
      houseSelect.appendChild(opt);
    }
    const houseLv = document.createElement("input");
    houseLv.type = "number";
    houseLv.min = "1";
    houseLv.max = "8";
    houseLv.value = "1";
    houseLv.className = "mwi-lite-calc-lv";

    const addHouseBtn = document.createElement("button");
    addHouseBtn.type = "button";
    addHouseBtn.className = "mwi-lite-calc-add";
    addHouseBtn.textContent = ctx!.i18n.t("房屋", "+Room");
    addHouseBtn.addEventListener("click", () => {
      const hrid = houseSelect.value;
      const lv = Math.max(1, Math.min(8, parseInt(houseLv.value, 10) || 1));
      if (!hrid) return;
      targets.set(hrid, { itemHrid: hrid, count: lv, needCalc: true });
      saveAll();
      renderCalculatorContent();
    });
    houseWrap.append(houseSelect, houseLv, addHouseBtn);

    topBar.append(searchWrap, houseWrap);

    listHost = document.createElement("div");
    listHost.className = "mwi-lite-calc-columns";
    listHost.innerHTML = `<div class="mwi-lite-calc-left"></div><div class="mwi-lite-calc-right"></div>`;

    panel.append(topBar, listHost);
    return panel;
  };

  const ensureTabInjected = () => {
    if (!ctx) return;
    const tabsContainer = document.querySelector(
      '[class^="CharacterManagement_tabsComponentContainer"] [class*="TabsComponent_tabsContainer"]'
    );
    const panelsContainer = document.querySelector(
      '[class^="CharacterManagement_tabsComponentContainer"] [class*="TabsComponent_tabPanelsContainer"]'
    );
    if (!tabsContainer || !panelsContainer) return;

    const charId = getCharScope();
    if (lastCharId !== charId) {
      loadSaved();
    }

    if (document.getElementById(TAB_BTN_ID)) {
      // If user clicked a native tab, yield display cleanly without extra MutationObserver
      const gameButtons = Array.from(tabsContainer.querySelectorAll<HTMLButtonElement>("button")).filter(
        (b) => b.id !== TAB_BTN_ID
      );
      if (tabPanel && tabPanel.style.display !== "none" && gameButtons.some((b) => b.classList.contains("Mui-selected"))) {
        Array.from(panelsContainer.children).forEach((n) => {
          if (n !== tabPanel && (n as HTMLElement).style.display === "none") {
            (n as HTMLElement).style.display = "";
          }
        });
        tabPanel.style.display = "none";
        tabButton?.classList.remove("Mui-selected");
      }
      return;
    }

    const gameButtons = Array.from(tabsContainer.querySelectorAll<HTMLButtonElement>("button"));
    const samplePanel = panelsContainer.children[0] as HTMLElement | undefined;
    if (!gameButtons.length || !samplePanel) return;

    tabButton = gameButtons[gameButtons.length - 1].cloneNode(true) as HTMLButtonElement;
    tabButton.id = TAB_BTN_ID;
    tabButton.setAttribute("data-mwi-lite", "1");
    const labelNode = (tabButton.children[0] as HTMLElement | undefined) || tabButton;
    labelNode.textContent = ctx.i18n.t("MWI计算器", "Calculator");
    gameButtons[0].parentElement?.appendChild(tabButton);

    tabPanel = document.createElement("div");
    tabPanel.id = TAB_PANEL_ID;
    tabPanel.setAttribute("data-mwi-lite", "1");
    tabPanel.className = samplePanel.className.replace(/TabPanel_hidden__[A-Za-z0-9_-]+/g, "").trim();
    tabPanel.style.display = "none";
    tabPanel.appendChild(buildCalculatorPanelDom());
    panelsContainer.appendChild(tabPanel);

    const showMine = () => {
      Array.from(panelsContainer.children).forEach((p) => {
        if (p !== tabPanel) (p as HTMLElement).style.display = "none";
      });
      if (tabPanel) tabPanel.style.display = "";
      gameButtons.forEach((b) => {
        b.classList.remove("Mui-selected");
        b.tabIndex = -1;
      });
      if (tabButton) {
        tabButton.classList.add("Mui-selected");
        tabButton.tabIndex = 0;
      }
      renderCalculatorContent();
      ctx?.domScheduler.scheduleRun(false);
    };

    const showTheirs = () => {
      Array.from(panelsContainer.children).forEach((p) => {
        if (p !== tabPanel && (p as HTMLElement).style.display === "none") {
          (p as HTMLElement).style.display = "";
        }
      });
      if (tabPanel) tabPanel.style.display = "none";
      if (tabButton) {
        tabButton.classList.remove("Mui-selected");
        tabButton.tabIndex = -1;
      }
      ctx?.domScheduler.scheduleRun(false);
    };

    gameButtons.forEach((b) => b.addEventListener("click", showTheirs, true));
    tabButton.addEventListener("click", showMine, true);
  };

  const ensureImportTasksButton = () => {
    if (!ctx) return;
    const taskBoardInfo = document.querySelector('[class*="TasksPanel_taskBoardInfo"]');
    if (!taskBoardInfo || taskBoardInfo.querySelector(`.${IMPORT_BTN_CLASS}`)) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = IMPORT_BTN_CLASS;
    btn.setAttribute("data-mwi-lite", "1");
    btn.textContent = ctx.i18n.t("导入计算器", "Import to Calc");
    btn.addEventListener("click", () => {
      const cnt = importTasksToCalculator();
      if (cnt === 0) {
        alert(ctx!.i18n.t("未找到可导入的制造任务", "No crafting tasks found"));
      }
    });

    const slotCount = taskBoardInfo.querySelector('[class*="TasksPanel_taskSlotCount"]');
    (slotCount || taskBoardInfo).appendChild(btn);
  };

  return {
    id: "planner-item-calculator",
    nameZh: "物品规划计算器",
    nameEn: "Item Planner Calculator",
    descriptionZh: "目标物品/房屋材料递归计算、导入制造任务、库存抵扣与缺口双击跳市场自动填量",
    descriptionEn: "Recursive crafting & house material planner with task import and market shortage prefill",
    category: "planner",
    defaultEnabled: true,

    init(context) {
      ctx = context;
      loadSaved();

      unregStyle = ctx.addStyle(
        "planner-item-calculator",
        `
        .${IMPORT_BTN_CLASS} {
          background: var(--mwi-px-btn-bg, linear-gradient(180deg, #324a8f 0%, #22356b 100%));
          color: #f8fafc;
          border: 1px solid var(--mwi-px-border, #8eb1ff);
          border-radius: 0;
          box-shadow: var(--mwi-px-shadow-btn, 0 0 0 1px #080d1a);
          padding: 3px 9px;
          margin-left: 8px;
          cursor: pointer;
          font-family: var(--mwi-px-mono, monospace);
          font-size: 11.5px;
          font-weight: 700;
        }
        .mwi-lite-calc-root {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 8px;
          background: var(--mwi-px-panel-bg, linear-gradient(180deg, #121c3b 0%, #0c1228 100%));
          border: 2px solid var(--mwi-px-border, #9dbbff);
          box-shadow: var(--mwi-px-shadow-card, 0 0 0 2px #070b16);
          font-family: var(--mwi-px-mono, monospace);
          font-variant-numeric: tabular-nums;
          font-size: 12px;
          color: var(--mwi-px-text, #e2e8f0);
        }
        .mwi-lite-calc-topbar {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .mwi-lite-calc-searchbox, .mwi-lite-calc-housebox {
          display: flex;
          align-items: center;
          gap: 4px;
          background: #141f46;
          border: 1px solid var(--mwi-px-border-inner, #4f6fc4);
          padding: 4px;
          border-radius: 0;
          position: relative;
        }
        .mwi-lite-calc-searchbox { flex: 1.4; min-width: 240px; }
        .mwi-lite-calc-housebox { flex: 1; min-width: 180px; }
        .mwi-lite-calc-searchbox input[type="text"],
        .mwi-lite-calc-housebox select,
        .mwi-lite-calc-housebox input {
          background: #0b1124;
          color: #f8fafc;
          border: 1px solid #5c7cd4;
          border-radius: 0;
          padding: 3px 6px;
          font-size: 11.5px;
          font-family: inherit;
        }
        .mwi-lite-calc-searchbox > input:first-child,
        .mwi-lite-calc-housebox select { flex: 1; min-width: 60px; }
        .mwi-lite-calc-qty { width: 52px; }
        .mwi-lite-calc-lv { width: 42px; }
        .mwi-lite-calc-add {
          background: var(--mwi-px-btn-green, linear-gradient(180deg, #1f6d43 0%, #165132 100%));
          color: #fff;
          border: 1px solid var(--mwi-px-green-soft, #86efac);
          border-radius: 0;
          box-shadow: 0 0 0 1px #06140c;
          padding: 3px 8px;
          font-weight: 700;
          cursor: pointer;
        }
        .mwi-lite-calc-clear, .mwi-lite-calc-del {
          background: linear-gradient(180deg, #7f1d1d 0%, #581313 100%);
          color: #fff;
          border: 1px solid #fca5a5;
          border-radius: 0;
          padding: 3px 7px;
          font-weight: 700;
          cursor: pointer;
        }
        .mwi-lite-calc-dropdown {
          position: absolute; left: 4px; top: 34px; width: 224px; max-height: 280px; overflow-y: auto;
          background: #0e1634; border: 2px solid var(--mwi-px-border, #9dbbff);
          box-shadow: 0 0 0 2px #070b16; border-radius: 0; z-index: 1200; padding: 3px;
        }
        .mwi-lite-calc-opt {
          display: flex; align-items: center; gap: 6px; padding: 4px 6px; cursor: pointer; border-radius: 0;
        }
        .mwi-lite-calc-opt:hover { background: #22356b; }
        .mwi-lite-calc-columns {
          display: grid; grid-template-columns: 1.3fr 1fr; gap: 8px; align-items: start;
        }
        .mwi-lite-calc-cat, .mwi-lite-calc-shortages, .mwi-lite-calc-required {
          background: var(--mwi-px-card-bg, linear-gradient(180deg, #17244d 0%, #0e1634 100%));
          border: 1px solid var(--mwi-px-border-inner, #4f6fc4);
          box-shadow: 0 0 0 1px #070b16;
          border-radius: 0; margin-bottom: 6px; padding: 3px;
        }
        .mwi-lite-calc-cat.active > summary { background: #165132; border-bottom: 1px solid #4ade80; }
        .mwi-lite-calc-cat.muted > summary { background: #1c284f; }
        .mwi-lite-calc-shortages > summary { background: #6b2416; border-bottom: 1px solid #f87171; }
        .mwi-lite-calc-required > summary { background: #22356b; border-bottom: 1px solid #8eb1ff; }
        .mwi-lite-calc-root summary {
          display: flex; align-items: center; gap: 5px; padding: 3px 6px; border-radius: 0; cursor: pointer; font-weight: 700;
        }
        .mwi-lite-calc-x { margin-left: auto; color: #fca5a5; padding: 0 4px; cursor: pointer; }
        .mwi-lite-calc-row {
          display: flex; align-items: center; justify-content: space-between; gap: 6px;
          padding: 3px 5px; border-bottom: 1px dashed #223468;
        }
        .mwi-lite-calc-row.off { opacity: 0.55; }
        .mwi-lite-calc-itemname {
          display: flex; align-items: center; gap: 5px; cursor: pointer; min-width: 0; overflow: hidden;
        }
        .mwi-lite-calc-itemname span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mwi-lite-calc-rightctrl { display: flex; align-items: center; gap: 4px; }
        .mwi-lite-calc-num {
          width: 56px; background: #0b1124; color: #f8fafc; border: 1px solid #5c7cd4; border-radius: 0; padding: 2px 4px; text-align: right;
        }
        .mwi-lite-calc-short-badge {
          background: #141f46; border: 1px solid var(--mwi-px-gold, #fde047); color: var(--mwi-px-gold, #fde047); border-radius: 0; padding: 1px 6px; font-weight: 700;
        }
        `
      );

      unsubs = [
        ctx.gameData.on("character_initialized", () => {
          loadSaved();
          scheduleRender();
        }),
        ctx.gameData.on("items_updated", scheduleRender),
        ctx.gameData.on("house_rooms_updated", scheduleRender),
        ctx.marketStore.onPriceUpdate(scheduleRender),
      ];

      return () => {
        unsubs.forEach((u) => u());
        unsubs = [];
        unregStyle?.();
        unregStyle = null;
        if (renderTimer !== null) clearTimeout(renderTimer);
        pendingPrefill = null;
        document.getElementById(TAB_BTN_ID)?.remove();
        document.getElementById(TAB_PANEL_ID)?.remove();
        document.querySelectorAll(`.${IMPORT_BTN_CLASS}`).forEach((el) => el.remove());
        tabButton = null;
        tabPanel = null;
        listHost = null;
      };
    },

    onDom(_doc, route: PanelRoute) {
      ensureTabInjected();
      if (route === "tasks" || document.querySelector('[class*="TasksPanel_taskBoardInfo"]')) {
        ensureImportTasksButton();
      }
      if (pendingPrefill) {
        tryApplyMarketPrefill();
      }
    },
  };
}
