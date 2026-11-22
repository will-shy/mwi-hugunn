import type { FeatureModule, KernelContext } from "../../core/types";

export const TASK_AUTO_N1_MODULE_ID = "planner-task-auto-n1";

const TASK_SORT_PREF_KEY = "task_board_sort_pref_v1";
const TASK_LIST_SEL = '[class*="TasksPanel_taskList"]';
const TASK_CARD_SEL = '[class*="RandomTask_randomTask"]';
const TASK_ACTION_SEL = '[class*="RandomTask_action"]';
const TASK_NAME_SEL = '[class*="RandomTask_name"]';
const SLOT_COUNT_SEL = '[class*="TasksPanel_taskSlotCount"]';
const SKILL_DETAIL_SEL = '[class*="SkillActionDetail_skillActionDetail"]';
const MAIN_PANEL_SEL = '[class*="MainPanel_mainPanel"]';
const TASKS_PANEL_SEL = '[class*="TasksPanel_tasksPanel"]';
const TAB_PANEL_SEL = '[class*="TabPanel_tabPanel"]';
const SUB_PANEL_SEL = '[class*="MainPanel_subPanelContainer"]';
const NAV_LINK_SEL = '[class*="NavigationBar_navigationLink__"]';
const TASK_N1_ID = "mwi-lite-task-n1";
const TASK_QUEUE_BTN_CLASS = "mwi-lite-task-queue-btn";
const FREEZE_OVERLAY_ID = "mwi-lite-task-freeze-overlay";
const CLAIM_REWARD_BTN_RE = /领取奖励|Claim\s*Reward/i;
const GO_BTN_RE = /^(前往|Go)$/i;
const ADD_TO_QUEUE_BTN_RE = /添加到队列|Add\s*(?:to\s*)?Queue/i;
const UPGRADE_QUEUE_BTN_RE = /升级(?:行动)?队列|解锁(?:行动)?队列|Upgrade\s*Queue|Unlock\s*Queue/i;
const START_ONLY_BTN_RE = /^(开始|Start)$/i;
const STOP_BTN_RE = /^(停止|Stop)$/i;
const ACTION_DETAIL_MOUNTED_SEL =
  '[class*="enhancingComponent"], [class*="alchemyComponent"], [class*="primaryItemSelectorContainer"], [class*="buttonsContainer"]';
const MAX_CLAIM_BATCH = 20;
const SYNC_CLICK_BUDGET_MS = 55;
const TRUSTED_CLICK_WINDOW_MS = 85;
const QUICK_QUEUE_ASYNC_TIMEOUT_MS = 600;
const QUEUE_FEEDBACK_TTL_MS = 1200;

function findAnyClaimButton(card: Element): HTMLButtonElement | null {
  const btns = card.querySelectorAll<HTMLButtonElement>("button");
  for (const btn of btns) {
    if (CLAIM_REWARD_BTN_RE.test(btn.textContent || "")) return btn;
  }
  return null;
}

function isClaimButtonReady(btn: HTMLButtonElement): boolean {
  return !btn.disabled && !btn.className.includes("Button_disabled");
}

function findReadyClaimButton(card: Element): HTMLButtonElement | null {
  const btn = findAnyClaimButton(card);
  return btn && isClaimButtonReady(btn) ? btn : null;
}

function parseActionCount(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).trim().toLowerCase().replace(/[\s,]/g, "");
  if (!cleaned || cleaned === "\u221e") return null;
  let mul = 1;
  let numStr = cleaned;
  if (numStr.endsWith("k")) {
    mul = 1e3;
    numStr = numStr.slice(0, -1);
  } else if (numStr.endsWith("m")) {
    mul = 1e6;
    numStr = numStr.slice(0, -1);
  } else if (numStr.endsWith("b")) {
    mul = 1e9;
    numStr = numStr.slice(0, -1);
  }
  const n = Number(numStr);
  return Number.isFinite(n) ? Math.floor(n * mul) : null;
}

function formatActionCount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

function setReactInputValue(input: HTMLInputElement, value: number, focusInput = true): void {
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  proto?.set?.call(input, String(value));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  if (focusInput) input.focus();
}

export function computeQuickQueueCount(baseCount: number | null, autoMinusOne: boolean): number | null {
  if (baseCount === null || !Number.isFinite(baseCount) || baseCount <= 0) return null;
  const normalized = Math.floor(baseCount);
  if (autoMinusOne && normalized > 1) return normalized - 1;
  return normalized;
}

function findRealGameElement<T extends Element = HTMLElement>(doc: Document, selector: string): T | null {
  const els = doc.querySelectorAll<T>(selector);
  for (const el of els) {
    if (!el.closest(`#${FREEZE_OVERLAY_ID}`) && !el.closest("[data-mwi-lite]")) {
      return el;
    }
  }
  return null;
}

function findGoButton(card: Element): HTMLButtonElement | null {
  const btns = card.querySelectorAll<HTMLButtonElement>("button");
  for (const btn of btns) {
    if (btn.classList.contains(TASK_QUEUE_BTN_CLASS)) continue;
    if (GO_BTN_RE.test((btn.textContent || "").trim())) return btn;
  }
  return null;
}

function findButtonByTextRe(root: ParentNode, re: RegExp): HTMLButtonElement | null {
  const btns = root.querySelectorAll<HTMLButtonElement>("button");
  for (const btn of btns) {
    if (re.test((btn.textContent || "").trim())) return btn;
  }
  return null;
}

function findTasksNavButton(doc: Document): HTMLElement | null {
  const links = Array.from(doc.querySelectorAll<HTMLElement>(NAV_LINK_SEL));
  const iconMatches = links.filter((el) => {
    if (el.querySelector('svg[aria-label="navigationBar.tasks"]')) return true;
    const useEl = el.querySelector("use");
    const href = useEl?.getAttribute("href") || useEl?.getAttribute("xlink:href") || "";
    return href.endsWith("#tasks");
  });
  const visibleIcon = iconMatches.find((el) => el.offsetParent !== null);
  if (visibleIcon) return visibleIcon;
  if (iconMatches.length > 0) return iconMatches[0];

  const textMatches = links.filter((el) => /^(任务|Tasks)(\s*\d+)?$/i.test((el.textContent || "").trim()));
  return textMatches.find((el) => el.offsetParent !== null) || textMatches[0] || null;
}

function findReactNavCore(doc: Document): { handleChangeNavTarget?: (target: string) => void } | null {
  const root = doc.getElementById("root") || doc.body;
  if (!root) return null;
  const key = Reflect.ownKeys(root).find(
    (k) => typeof k === "string" && (k.startsWith("__reactContainer$") || k.startsWith("__reactFiber$"))
  );
  const start = key ? (root as any)[key] : null;
  if (!start) return null;
  const queue: any[] = [start];
  let visited = 0;
  while (queue.length > 0 && visited++ < 2000) {
    const cur = queue.shift();
    if (!cur) continue;
    const inst = cur.stateNode;
    if (inst && inst.state && "navTarget" in inst.state && typeof inst.handleChangeNavTarget === "function") {
      return inst;
    }
    if (cur.child) queue.push(cur.child);
    if (cur.sibling) queue.push(cur.sibling);
  }
  return null;
}

function getDetailActionCount(detail: Element): number | null {
  const key = Reflect.ownKeys(detail).find(
    (k) => typeof k === "string" && (k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"))
  );
  let fiber: any = key ? (detail as any)[key] : null;
  for (let depth = 0; fiber && depth < 16; depth++, fiber = fiber.return) {
    const inst = fiber.stateNode;
    if (inst && typeof inst.getActionCount === "function") {
      try {
        const count = Number(inst.getActionCount());
        if (Number.isFinite(count)) return count;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function triggerButtonActionSafe(btn: HTMLElement, clickStartTs: number): boolean {
  // Within trusted click window (<85ms), native .click() keeps game's ws.exceeded(100) false and runs full React handler
  if (Date.now() - clickStartTs < TRUSTED_CLICK_WINDOW_MS) {
    btn.click();
    return true;
  }
  // Fallback when async render exceeded window: invoke inner React onClick without dispatching untrusted DOM click
  const key = Reflect.ownKeys(btn).find(
    (k) => typeof k === "string" && (k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"))
  );
  let fiber: any = key ? (btn as any)[key] : null;
  const isButtonHost = btn.tagName === "BUTTON";
  for (let depth = 0; fiber && depth < 8; depth++, fiber = fiber.return) {
    const onClick = fiber.memoizedProps?.onClick;
    if (typeof onClick === "function") {
      const fnStr = Function.prototype.toString.call(onClick);
      if (fnStr.includes("cooldownMs") || (isButtonHost && depth === 0)) continue;
      onClick({ preventDefault() {}, stopPropagation() {}, isTrusted: true, currentTarget: btn, target: btn });
      return true;
    }
  }
  btn.click();
  return true;
}

type TaskSortMode = "skill" | "name";

interface TaskSortPref {
  mode: TaskSortMode;
  autoSort: boolean;
}

const SKILL_ORDER: Record<string, number> = {
  Milking: 1,
  "挤奶": 1,
  Foraging: 2,
  "采摘": 2,
  "采集": 2,
  Woodcutting: 3,
  "伐木": 3,
  Cheesesmithing: 4,
  "奶酪锻造": 4,
  Crafting: 5,
  "制作": 5,
  "锻造": 5,
  Tailoring: 6,
  "缝纫": 6,
  "裁缝": 6,
  Cooking: 7,
  "烹饪": 7,
  Brewing: 8,
  "冲泡": 8,
  "酿造": 8,
  Alchemy: 9,
  "炼金": 9,
  Enhancing: 10,
  "强化": 10,
  Defeat: 99,
  "击败": 99,
};

/**
 * Build monster sort keys grouped by combat zone category order, then zone action sortIndex,
 * keeping zone bosses right behind their zone's regular monsters and dungeon-exclusive monsters
 * ordered cleanly under Dungeons.
 */
function buildMonsterZoneOrderMap(clientData: any): Map<string, number> {
  const orderMap = new Map<string, number>();
  const catMap = clientData?.actionCategoryDetailMap || {};
  const actionMap = clientData?.actionDetailMap || {};
  const monsterMap = clientData?.combatMonsterDetailMap || clientData?.monsterDetailMap || {};

  const combatActions = Object.values<any>(actionMap)
    .filter((d) => d?.type === "/action_types/combat" && d?.combatZoneInfo)
    .sort((a, b) => (a.sortIndex ?? 999) - (b.sortIndex ?? 999));

  const register = (monsterHrid: string | undefined, zoneOrder: number, actionOrder: number, subOrder: number) => {
    if (!monsterHrid || orderMap.has(monsterHrid)) return;
    orderMap.set(monsterHrid, zoneOrder * 1_000_000 + actionOrder * 1_000 + subOrder);
  };

  // 1) Single-monster combat spots in non-dungeon zones give each monster its exact zone placement
  for (const detail of combatActions) {
    const zi = detail.combatZoneInfo;
    if (zi.isDungeon) continue;
    const fi = zi.fightInfo || {};
    const spawns = [
      ...(fi.randomSpawnInfo?.spawns || []),
      ...(fi.fixedSpawns || []),
      ...(fi.bossSpawns || []),
    ]
      .map((s: any) => s?.combatMonsterHrid)
      .filter((h): h is string => typeof h === "string" && h.length > 0);
    const uniq = Array.from(new Set(spawns));
    if (uniq.length !== 1) continue;
    const zoneOrder = catMap[detail.category]?.sortIndex ?? 999;
    register(uniq[0], zoneOrder, detail.sortIndex ?? 999, 0);
  }

  // 2) Multi-monster non-dungeon zone encounters assign zone bosses & zone-only monsters to their zone
  for (const detail of combatActions) {
    const zi = detail.combatZoneInfo;
    if (zi.isDungeon) continue;
    const fi = zi.fightInfo || {};
    const zoneOrder = catMap[detail.category]?.sortIndex ?? 999;
    const actionOrder = detail.sortIndex ?? 999;
    let sub = 0;
    for (const s of fi.randomSpawnInfo?.spawns || []) {
      register(s?.combatMonsterHrid, zoneOrder, actionOrder, sub++);
    }
    for (const s of fi.fixedSpawns || []) {
      register(s?.combatMonsterHrid, zoneOrder, actionOrder, sub++);
    }
    for (const s of fi.bossSpawns || []) {
      register(s?.combatMonsterHrid, zoneOrder, actionOrder, 500 + sub++);
    }
  }

  // 3) Dungeon encounters assign remaining dungeon-exclusive monsters by dungeon & wave order
  for (const detail of combatActions) {
    const zi = detail.combatZoneInfo;
    if (!zi.isDungeon) continue;
    const di = zi.dungeonInfo || {};
    const zoneOrder = catMap[detail.category]?.sortIndex ?? 999;
    const actionOrder = detail.sortIndex ?? 999;
    let sub = 0;
    const randomWaves = Object.entries<any>(di.randomSpawnInfoMap || {}).sort(
      (a, b) => Number(a[0]) - Number(b[0])
    );
    for (const [, waveInfo] of randomWaves) {
      for (const s of waveInfo?.spawns || []) {
        register(s?.combatMonsterHrid, zoneOrder, actionOrder, sub++);
      }
    }
    const fixedWaves = Object.entries<any>(di.fixedSpawnsMap || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
    for (const [, spawns] of fixedWaves) {
      for (const s of spawns || []) {
        register(s?.combatMonsterHrid, zoneOrder, actionOrder, 500 + sub++);
      }
    }
  }

  // 4) Fallback by combat level for any unmapped special/trial monster
  for (const [hrid, monster] of Object.entries<any>(monsterMap)) {
    if (orderMap.has(hrid)) continue;
    const lvl = Number(monster?.combatDetails?.combatLevel);
    orderMap.set(hrid, 900_000_000 + (Number.isFinite(lvl) ? Math.round(lvl * 100) : 999_999));
  }

  return orderMap;
}

function resolveActionOutputHrids(actionHrid: string, clientData: any): string[] {
  const action = clientData?.actionDetailMap?.[actionHrid];
  if (!action || action.type === "/action_types/combat") return [];
  const itemMap = clientData?.itemDetailMap || {};
  const outputs: string[] = [];
  const pushUnique = (hrid: unknown) => {
    if (typeof hrid === "string" && itemMap[hrid] && !outputs.includes(hrid)) {
      outputs.push(hrid);
    }
  };

  if (Array.isArray(action.outputItems)) {
    for (const out of action.outputItems) {
      pushUnique(out?.itemHrid);
    }
  }
  // Gathering actions (milking/foraging/woodcutting) store outputs in dropTable
  if (outputs.length === 0 && Array.isArray(action.dropTable)) {
    for (const drop of action.dropTable) {
      pushUnique(drop?.itemHrid);
    }
  }
  if (outputs.length === 0) {
    const actionKey = actionHrid.split("/").pop() || "";
    if (actionKey) pushUnique(`/items/${actionKey}`);
  }
  return outputs;
}

function buildInventoryCountMap(context: KernelContext): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of context.gameData.getCharacterItems()) {
    if (!item?.itemHrid || !item.count || item.count <= 0) continue;
    if (item.itemLocationHrid && item.itemLocationHrid !== "/item_locations/inventory") continue;
    counts.set(item.itemHrid, (counts.get(item.itemHrid) || 0) + item.count);
  }
  return counts;
}

type SpriteType = "items" | "actions" | "monsters";

export function createTaskBoardModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let unregStyle: (() => void) | null = null;
  let unregQuests: (() => void) | null = null;
  let unregItems: (() => void) | null = null;
  let unregInit: (() => void) | null = null;
  let sortMode: TaskSortMode = "skill";
  let autoSort = true;
  let lastPointerDownTs = 0;
  let lastTaskListRef: Element | null = null;
  let timers: number[] = [];
  let cooldownSyncTimer: number | null = null;
  let cooldownWaitStartTs = 0;
  let activeSettleCleanup: (() => void) | null = null;
  let isClaimingAll = false;
  let claimingStatusText = "";
  let claimingFreezeUntil = 0;
  let isQuickQueueing = false;
  let manualSortedActive = false;
  let quickQueueAsyncCleanup: (() => void) | null = null;
  const queueFeedbackMap = new Map<string, { label: string; tone: "ok" | "err"; expiresAt: number }>();
  let destroyed = false;

  // Lazy cached sprite URLs & reverse lookup maps
  const spriteUrls: Partial<Record<SpriteType, string>> = {};
  let manifestFetching: Promise<void> | null = null;
  let actionNameToHrid: Map<string, string> | null = null;
  let monsterNameToHrid: Map<string, string> | null = null;
  let monsterZoneOrder: Map<string, number> | null = null;
  let clientLookupBuilt = false;
  let i18nLookupBuilt = false;

  const savePref = () => {
    ctx?.storage.set<TaskSortPref>(TASK_SORT_PREF_KEY, { mode: sortMode, autoSort });
  };

  const ensureLookupMaps = () => {
    if ((clientLookupBuilt && i18nLookupBuilt) || !ctx) return;
    const clientData = ctx.gameData.getClientData();
    if (!clientData) return;

    if (!actionNameToHrid) actionNameToHrid = new Map();
    if (!monsterNameToHrid) monsterNameToHrid = new Map();

    if (!i18nLookupBuilt) {
      const core = ctx.gameData.getReactGameCore();
      const resources = core?.props?.i18n?.options?.resources;
      if (resources) {
        for (const lang of Object.keys(resources)) {
          const trans = resources[lang]?.translation;
          if (trans?.actionNames) {
            for (const [hrid, name] of Object.entries(trans.actionNames)) {
              if (typeof name === "string" && name.trim()) {
                actionNameToHrid.set(name.trim().toLowerCase(), hrid);
              }
            }
          }
          if (trans?.monsterNames) {
            for (const [hrid, name] of Object.entries(trans.monsterNames)) {
              if (typeof name === "string" && name.trim()) {
                monsterNameToHrid.set(name.trim().toLowerCase(), hrid);
              }
            }
          }
        }
        i18nLookupBuilt = true;
      }
    }

    if (!clientLookupBuilt) {
      if (clientData.actionDetailMap) {
        for (const [hrid, detail] of Object.entries<any>(clientData.actionDetailMap)) {
          if (typeof detail?.name === "string" && detail.name.trim()) {
            actionNameToHrid.set(detail.name.trim().toLowerCase(), hrid);
          }
        }
      }
      const monsterMap = clientData.combatMonsterDetailMap || clientData.monsterDetailMap;
      if (monsterMap) {
        for (const [hrid, detail] of Object.entries<any>(monsterMap)) {
          if (typeof detail?.name === "string" && detail.name.trim()) {
            monsterNameToHrid.set(detail.name.trim().toLowerCase(), hrid);
          }
        }
      }
      monsterZoneOrder = buildMonsterZoneOrderMap(clientData);
      clientLookupBuilt = true;
    }
  };

  const detectDomSprites = () => {
    const patterns: Array<[SpriteType, string]> = [
      ["items", "items_sprite"],
      ["actions", "actions_sprite"],
      ["monsters", "combat_monsters_sprite"],
    ];
    for (const [key, token] of patterns) {
      if (spriteUrls[key]) continue;
      const useEl = document.querySelector(`use[href*="${token}"]`);
      const href = useEl?.getAttribute("href") || (useEl as SVGUseElement | null)?.href?.baseVal || "";
      const base = href.split("#")[0];
      if (base) spriteUrls[key] = base;
    }
  };

  const ensureManifestSprites = () => {
    detectDomSprites();
    if (spriteUrls.items && spriteUrls.actions && spriteUrls.monsters) return;
    if (manifestFetching) return;

    manifestFetching = (async () => {
      try {
        const res = await fetch("/asset-manifest.json");
        if (!res.ok) return;
        const manifest = await res.json();
        const files: Record<string, string> = manifest?.files || manifest || {};
        for (const [key, val] of Object.entries(files)) {
          if (typeof val !== "string" || !val.endsWith(".svg")) continue;
          if (!spriteUrls.items && key.includes("items_sprite")) spriteUrls.items = val;
          else if (!spriteUrls.actions && key.includes("actions_sprite")) spriteUrls.actions = val;
          else if (!spriteUrls.monsters && key.includes("combat_monsters_sprite")) spriteUrls.monsters = val;
        }
      } catch {
        // Optional fallback; DOM sprites still work
      }
    })();
  };

  const parseCard = (card: Element) => {
    const nameEl = card.querySelector(TASK_NAME_SEL);
    if (!nameEl) return null;
    const fullText = (nameEl.textContent || "").trim();
    const match = fullText.match(/^(.+?)\s*-\s*(.+)$/);
    if (!match) return null;
    const skillType = match[1].trim();
    const taskTarget = match[2].trim();
    const isCombat = skillType === "Defeat" || skillType === "击败";
    const isCompleted = Boolean(findAnyClaimButton(card));
    return { nameEl, fullText, skillType, taskTarget, isCombat, isCompleted };
  };

  const resolveIconForCard = (
    parsed: NonNullable<ReturnType<typeof parseCard>>
  ): { spriteType: SpriteType; symbolId: string; monsterSortIndex: number } | null => {
    if (!ctx) return null;
    ensureLookupMaps();
    const clientData = ctx.gameData.getClientData();
    if (!clientData) return null;

    if (parsed.isCombat) {
      const cleanName = parsed.taskTarget.replace(/Z\d+$/i, "").trim().toLowerCase();
      let monsterHrid = monsterNameToHrid?.get(cleanName) || null;
      if (!monsterHrid) {
        const monsterMap = clientData.combatMonsterDetailMap || clientData.monsterDetailMap || {};
        for (const hrid of Object.keys(monsterMap)) {
          const localized = ctx.i18n.getMonsterName(hrid).trim().toLowerCase();
          if (localized && localized === cleanName) {
            monsterHrid = hrid;
            monsterNameToHrid?.set(localized, hrid);
            break;
          }
        }
      }
      if (!monsterHrid) {
        const quests = ctx.gameData.getCharacterQuests();
        const q = quests.find((item) => item?.monsterHrid && parsed.taskTarget.includes(ctx!.i18n.getMonsterName(item.monsterHrid)));
        if (q) monsterHrid = q.monsterHrid;
      }
      if (!monsterHrid) return null;
      const sortIndex = monsterZoneOrder?.get(monsterHrid) ?? 999_999_999;
      return {
        spriteType: "monsters",
        symbolId: monsterHrid.split("/").pop() || "",
        monsterSortIndex: sortIndex,
      };
    }

    const actionHrid = actionNameToHrid?.get(parsed.taskTarget.toLowerCase()) || null;
    if (!actionHrid) return null;
    const action = clientData.actionDetailMap?.[actionHrid];
    const outHrid: string | undefined = action?.outputItems?.[0]?.itemHrid;
    if (outHrid && clientData.itemDetailMap?.[outHrid]) {
      return {
        spriteType: "items",
        symbolId: outHrid.split("/").pop() || "",
        monsterSortIndex: 0,
      };
    }

    const actionKey = actionHrid.split("/").pop() || "";
    if (clientData.itemDetailMap?.[`/items/${actionKey}`]) {
      return { spriteType: "items", symbolId: actionKey, monsterSortIndex: 0 };
    }
    return { spriteType: "actions", symbolId: actionKey, monsterSortIndex: 0 };
  };

  const renderTaskIcons = (cards: HTMLElement[]) => {
    detectDomSprites();
    let needManifest = false;

    for (const card of cards) {
      const parsed = parseCard(card);
      if (!parsed) continue;
      if (card.getAttribute("data-mwi-task-icon") === parsed.fullText && card.querySelector(".mwi-lite-task-icon")) {
        continue;
      }

      card.querySelector(".mwi-lite-task-icon")?.remove();
      const resolved = resolveIconForCard(parsed);
      if (!resolved || !resolved.symbolId) {
        card.setAttribute("data-mwi-task-icon", parsed.fullText);
        continue;
      }

      const spriteUrl = spriteUrls[resolved.spriteType];
      if (!spriteUrl) {
        needManifest = true;
        continue;
      }

      const wrap = document.createElement("span");
      wrap.className = "mwi-lite-task-icon";
      wrap.setAttribute("data-mwi-lite", "1");
      wrap.innerHTML = `<svg width="20" height="20" aria-hidden="true"><use href="${spriteUrl}#${resolved.symbolId}"></use></svg>`;
      parsed.nameEl.insertBefore(wrap, parsed.nameEl.firstChild);
      card.setAttribute("data-mwi-task-icon", parsed.fullText);
    }

    if (needManifest) {
      ensureManifestSprites();
      if (manifestFetching) {
        void manifestFetching.then(() => {
          ctx?.domScheduler.scheduleRun(false);
        });
      }
    }
  };

  const resolveActionHridByTarget = (targetName: string, clientData: any): string | null => {
    const key = targetName.trim().toLowerCase();
    if (!key) return null;
    let actionHrid = actionNameToHrid?.get(key) || null;
    if (actionHrid || !ctx) return actionHrid;
    const actionMap = clientData?.actionDetailMap || {};
    for (const hrid of Object.keys(actionMap)) {
      const localized = ctx.i18n.getActionName(hrid).trim().toLowerCase();
      if (localized && localized === key) {
        actionHrid = hrid;
        actionNameToHrid?.set(localized, hrid);
        break;
      }
    }
    return actionHrid;
  };

  const renderTaskStockBadges = (cards: HTMLElement[]) => {
    if (!ctx) return;
    ensureLookupMaps();
    const clientData = ctx.gameData.getClientData();
    if (!clientData) return;

    const invCounts = buildInventoryCountMap(ctx);
    const targetLowerCache = new Map<string, string>();

    for (const card of cards) {
      const parsed = parseCard(card);
      if (!parsed || parsed.isCombat) {
        card.querySelector(".mwi-lite-task-stock-group, .mwi-lite-task-stock")?.remove();
        card.removeAttribute("data-mwi-task-stock");
        continue;
      }

      const actionHrid = resolveActionHridByTarget(parsed.taskTarget, clientData);
      const outputHrids = actionHrid ? resolveActionOutputHrids(actionHrid, clientData) : [];
      if (!outputHrids.length) {
        card.querySelector(".mwi-lite-task-stock-group, .mwi-lite-task-stock")?.remove();
        card.removeAttribute("data-mwi-task-stock");
        continue;
      }

      let targetLower = targetLowerCache.get(parsed.taskTarget);
      if (targetLower === undefined) {
        targetLower = parsed.taskTarget.trim().toLowerCase();
        targetLowerCache.set(parsed.taskTarget, targetLower);
      }

      const entries = outputHrids.map((hrid) => {
        const count = invCounts.get(hrid) || 0;
        const itemName = ctx!.i18n.getItemName(hrid);
        const text =
          outputHrids.length === 1 && itemName.trim().toLowerCase() === targetLower
            ? `${ctx!.i18n.t("库存", "Stock")} ${formatActionCount(count)}`
            : `${itemName} ${formatActionCount(count)}`;
        const title = `${ctx!.i18n.t("仓库库存", "Inventory stock")}: ${itemName} ${count.toLocaleString()}`;
        return { hrid, itemName, count, text, title };
      });

      const sig = `${parsed.fullText}|${entries.map((e) => `${e.hrid}:${e.count}:${e.text}`).join(";")}`;
      const existingGroup = card.querySelector<HTMLElement>(".mwi-lite-task-stock-group");
      if (existingGroup && card.getAttribute("data-mwi-task-stock") === sig) {
        continue;
      }

      const host = card.querySelector(TASK_ACTION_SEL) || parsed.nameEl.parentElement;
      if (!host) continue;

      const group = existingGroup || document.createElement("span");
      group.className = "mwi-lite-task-stock-group";
      group.setAttribute("data-mwi-lite", "1");
      group.replaceChildren(
        ...entries.map((e) => {
          const badge = document.createElement("span");
          badge.className = "mwi-lite-task-stock";
          badge.setAttribute("data-mwi-lite", "1");
          badge.dataset.level = e.count === 0 ? "zero" : "ok";
          badge.textContent = e.text;
          badge.title = e.title;
          return badge;
        })
      );
      if (!existingGroup) {
        host.appendChild(group);
      }
      card.setAttribute("data-mwi-task-stock", sig);
    }
  };

  const sortTaskCards = (force = false) => {
    if (!ctx) return;
    if (!force && !autoSort) return;
    if (!force && (isClaimingAll || Date.now() < claimingFreezeUntil)) return;
    if (!force && Date.now() - lastPointerDownTs < 250) {
      const id = window.setTimeout(() => sortTaskCards(false), 260);
      timers.push(id);
      return;
    }

    const taskList = findRealGameElement(document, TASK_LIST_SEL);
    if (!taskList) return;

    const cards = Array.from(taskList.children).filter(
      (el): el is HTMLElement => el.matches(TASK_CARD_SEL)
    );
    if (cards.length < 2) return;

    const keyed = cards.map((card, idx) => {
      const parsed = parseCard(card);
      const resolved = parsed ? resolveIconForCard(parsed) : null;
      return {
        card,
        idx,
        isCompleted: parsed?.isCompleted ?? false,
        skillOrder: parsed ? SKILL_ORDER[parsed.skillType] ?? 999 : 999,
        isCombat: parsed?.isCombat ?? false,
        monsterSortIndex: resolved?.monsterSortIndex ?? 999_999_999,
        targetName: parsed?.taskTarget || "",
      };
    });

    keyed.sort((a, b) => {
      if (a.isCompleted !== b.isCompleted) return a.isCompleted ? -1 : 1;
      if (sortMode === "skill") {
        if (a.skillOrder !== b.skillOrder) return a.skillOrder - b.skillOrder;
        if (a.isCombat && b.isCombat && a.monsterSortIndex !== b.monsterSortIndex) {
          return a.monsterSortIndex - b.monsterSortIndex;
        }
      }
      const cmp = a.targetName.localeCompare(b.targetName, "zh-CN");
      return cmp !== 0 ? cmp : a.idx - b.idx;
    });

    let alreadyOrdered = true;
    for (let i = 0; i < keyed.length; i++) {
      if (keyed[i].card !== cards[i]) {
        alreadyOrdered = false;
        break;
      }
    }
    if (alreadyOrdered) return;

    for (let i = keyed.length - 1; i >= 0; i--) {
      const card = keyed[i].card;
      const nextSibling = i + 1 < keyed.length ? keyed[i + 1].card : null;
      if (card.nextSibling !== nextSibling) {
        taskList.insertBefore(card, nextSibling);
      }
    }
  };

  const getTaskCards = (): HTMLElement[] => {
    const taskList = findRealGameElement(document, TASK_LIST_SEL);
    if (!taskList) return [];
    return Array.from(taskList.children).filter((el): el is HTMLElement => el.matches(TASK_CARD_SEL));
  };

  const scheduleCooldownResync = () => {
    if (cooldownSyncTimer !== null || destroyed) return;
    if (cooldownWaitStartTs === 0) cooldownWaitStartTs = Date.now();
    if (Date.now() - cooldownWaitStartTs >= 2500) return;
    cooldownSyncTimer = window.setTimeout(() => {
      cooldownSyncTimer = null;
      if (!destroyed && !isClaimingAll && ctx?.domScheduler.getActiveRoute() === "tasks") {
        syncClaimAllButton();
      }
    }, 200);
  };

  const applyClaimAllBtnState = (
    btn: HTMLButtonElement,
    disabled: boolean,
    ready: "0" | "1",
    text: string,
    title: string
  ) => {
    if (btn.disabled !== disabled) btn.disabled = disabled;
    if (btn.dataset.ready !== ready) btn.dataset.ready = ready;
    if (btn.textContent !== text) btn.textContent = text;
    if (btn.title !== title) btn.title = title;
  };

  const syncClaimAllButton = (cards?: Element[]) => {
    if (!ctx) return;
    const btn = document.querySelector<HTMLButtonElement>(".mwi-lite-task-claim-all");
    if (!btn) return;
    const title = ctx.i18n.t(
      "领取所有已完成任务的积分奖励",
      "Claim rewards from all completed tasks"
    );
    if (isClaimingAll) {
      if (claimingStatusText) {
        applyClaimAllBtnState(btn, true, "0", claimingStatusText, title);
      }
      return;
    }
    const list = cards ?? getTaskCards();
    let readyCount = 0;
    let pendingCount = 0;
    for (const c of list) {
      const claimBtn = findAnyClaimButton(c);
      if (!claimBtn) continue;
      pendingCount++;
      if (isClaimButtonReady(claimBtn)) readyCount++;
    }

    if (readyCount > 0) {
      cooldownWaitStartTs = 0;
      if (cooldownSyncTimer !== null) {
        clearTimeout(cooldownSyncTimer);
        cooldownSyncTimer = null;
      }
      applyClaimAllBtnState(
        btn,
        false,
        "1",
        ctx.i18n.t(`一键领取 (${readyCount})`, `Claim All (${readyCount})`),
        title
      );
    } else if (pendingCount > 0) {
      applyClaimAllBtnState(
        btn,
        true,
        "0",
        ctx.i18n.t(`冷却中 (${pendingCount})`, `Cooldown (${pendingCount})`),
        title
      );
      if (btn.isConnected && ctx.domScheduler.getActiveRoute() === "tasks") {
        scheduleCooldownResync();
      }
    } else {
      cooldownWaitStartTs = 0;
      if (cooldownSyncTimer !== null) {
        clearTimeout(cooldownSyncTimer);
        cooldownSyncTimer = null;
      }
      applyClaimAllBtnState(btn, true, "0", ctx.i18n.t("一键领取", "Claim All"), title);
    }
  };

  const waitForBatchSettlement = (dispatchedCards: HTMLElement[]): Promise<void> => {
    return new Promise<void>((resolve) => {
      const total = dispatchedCards.length;
      if (destroyed || !isClaimingAll || total === 0) {
        resolve();
        return;
      }

      const startTs = Date.now();
      let lastProgressTs = startTs;
      let lastSettledCount = -1;
      let settled = false;
      let unsubWs: (() => void) | null = null;
      let pollId: number | null = null;
      let timeoutId: number | null = null;
      const wsCheckTimers: number[] = [];

      const finish = () => {
        if (settled) return;
        settled = true;
        unsubWs?.();
        if (pollId !== null) clearInterval(pollId);
        if (timeoutId !== null) clearTimeout(timeoutId);
        for (const t of wsCheckTimers) clearTimeout(t);
        wsCheckTimers.length = 0;
        activeSettleCleanup = null;
        resolve();
      };
      activeSettleCleanup = finish;

      const checkProgress = () => {
        if (destroyed || !isClaimingAll) {
          finish();
          return;
        }
        let settledCount = 0;
        for (const card of dispatchedCards) {
          if (!card.isConnected || !findAnyClaimButton(card)) {
            settledCount++;
          }
        }
        if (settledCount !== lastSettledCount) {
          lastSettledCount = settledCount;
          lastProgressTs = Date.now();
          claimingStatusText = ctx!.i18n.t(
            `领取中 (${settledCount}/${total})`,
            `Claiming (${settledCount}/${total})`
          );
          const claimAllBtn = document.querySelector<HTMLButtonElement>(".mwi-lite-task-claim-all");
          if (claimAllBtn && claimAllBtn.isConnected) {
            if (!claimAllBtn.disabled) claimAllBtn.disabled = true;
            if (claimAllBtn.dataset.ready !== "0") claimAllBtn.dataset.ready = "0";
            if (claimAllBtn.textContent !== claimingStatusText) {
              claimAllBtn.textContent = claimingStatusText;
            }
          }
        }

        if (settledCount >= total) {
          finish();
          return;
        }

        const now = Date.now();
        // Real test-server telemetry showed tail claim confirmations arriving up to ~636ms after prior frames (e.g. 462ms -> 1098ms).
        // Wait >=1200ms overall and >=700ms quiet since last settled card before treating leftovers as un-claimed; full success exits immediately above.
        if (now - startTs >= 1200 && now - lastProgressTs >= 700) {
          finish();
        }
      };

      checkProgress();
      pollId = window.setInterval(checkProgress, 25);
      unsubWs =
        ctx?.wsBus.on("quests_updated", (msg: any) => {
          const hasClaimed =
            Array.isArray(msg?.endCharacterQuests) &&
            msg.endCharacterQuests.some((q: any) => q?.status === "/quest_status/claimed");
          if (hasClaimed) {
            lastProgressTs = Date.now();
          }
          const t = window.setTimeout(checkProgress, 16);
          wsCheckTimers.push(t);
        }) ?? null;

      timeoutId = window.setTimeout(finish, 2400);
    });
  };

  const claimAllCompletedTasks = (clickStartTs = Date.now()) => {
    if (!ctx || isClaimingAll || destroyed) return;
    const cards = getTaskCards();
    const targets: Array<{ card: HTMLElement; btn: HTMLButtonElement }> = [];
    for (const c of cards) {
      const btn = findReadyClaimButton(c);
      if (btn) targets.push({ card: c, btn });
    }
    if (targets.length === 0) {
      syncClaimAllButton(cards);
      return;
    }

    const batch = targets.slice(0, MAX_CLAIM_BATCH);
    isClaimingAll = true;
    cooldownWaitStartTs = 0;
    claimingFreezeUntil = Date.now() + 2600;
    if (cooldownSyncTimer !== null) {
      clearTimeout(cooldownSyncTimer);
      cooldownSyncTimer = null;
    }

    const dispatchedCards: HTMLElement[] = [];

    // Must run synchronously within the user's trusted click (<100ms) so the game client does not flag isAuto=true
    for (let i = 0; i < batch.length; i++) {
      if (i > 0 && Date.now() - clickStartTs >= SYNC_CLICK_BUDGET_MS) break;
      const { card, btn } = batch[i];
      if (!card.isConnected || !isClaimButtonReady(btn)) continue;
      try {
        btn.click();
        dispatchedCards.push(card);
      } catch {
        // Ignore individual click errors and continue remaining cards
      }
    }

    if (dispatchedCards.length === 0) {
      isClaimingAll = false;
      claimingStatusText = "";
      claimingFreezeUntil = 0;
      syncClaimAllButton();
      return;
    }

    claimingStatusText = ctx.i18n.t(
      `领取中 (0/${dispatchedCards.length})`,
      `Claiming (0/${dispatchedCards.length})`
    );
    const claimAllBtn = document.querySelector<HTMLButtonElement>(".mwi-lite-task-claim-all");
    if (claimAllBtn && claimAllBtn.isConnected) {
      claimAllBtn.disabled = true;
      claimAllBtn.dataset.ready = "0";
      claimAllBtn.textContent = claimingStatusText;
    }

    void waitForBatchSettlement(dispatchedCards).finally(() => {
      isClaimingAll = false;
      claimingStatusText = "";
      claimingFreezeUntil = 0;
      syncClaimAllButton();
      sortTaskCards(false);
    });
  };

  const injectToolbar = () => {
    if (!ctx) return;
    const slotCount = findRealGameElement(document, SLOT_COUNT_SEL);
    if (!slotCount || slotCount.querySelector(".mwi-lite-task-toolbar")) return;

    const bar = document.createElement("span");
    bar.className = "mwi-lite-task-toolbar";
    bar.setAttribute("data-mwi-lite", "1");

    const claimAllBtn = document.createElement("button");
    claimAllBtn.type = "button";
    claimAllBtn.className = "Button_button__1Fe9z Button_small__3fqC7 mwi-lite-task-btn mwi-lite-task-claim-all";
    claimAllBtn.addEventListener("click", (e) => {
      const clickStartTs = Date.now();
      e.preventDefault();
      e.stopPropagation();
      claimAllCompletedTasks(clickStartTs);
    });

    const sortBtn = document.createElement("button");
    sortBtn.type = "button";
    sortBtn.className = "Button_button__1Fe9z Button_small__3fqC7 mwi-lite-task-btn";
    const syncLabels = () => {
      const modeLbl =
        sortMode === "skill" ? ctx!.i18n.t("按类型", "Skill") : ctx!.i18n.t("按名称", "Name");
      sortBtn.textContent = `${ctx!.i18n.t("排序", "Sort")}: ${modeLbl}`;
    };
    syncLabels();
    sortBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      sortMode = sortMode === "skill" ? "name" : "skill";
      manualSortedActive = true;
      syncLabels();
      savePref();
      sortTaskCards(true);
    });

    const autoBtn = document.createElement("button");
    autoBtn.type = "button";
    autoBtn.className = "Button_button__1Fe9z Button_small__3fqC7 mwi-lite-task-btn mwi-lite-task-auto";
    const syncAuto = () => {
      autoBtn.textContent = autoSort
        ? ctx!.i18n.t("自动排序: 开", "Auto: ON")
        : ctx!.i18n.t("自动排序: 关", "Auto: OFF");
      autoBtn.dataset.active = autoSort ? "1" : "0";
    };
    syncAuto();
    autoBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      autoSort = !autoSort;
      if (autoSort) manualSortedActive = false;
      syncAuto();
      savePref();
      if (autoSort) sortTaskCards(true);
    });

    bar.append(claimAllBtn, sortBtn, autoBtn);
    slotCount.appendChild(bar);
    syncClaimAllButton();
  };

  const injectTaskMinusOneButton = () => {
    if (!ctx) return;
    const panel = document.querySelector('[class*="SkillActionDetail_skillActionDetail"]');
    if (!panel || panel.querySelector(`#${TASK_N1_ID}`)) return;

    const inputSections = panel.querySelectorAll('[class*="maxActionCountInput"]');
    if (!inputSections.length) return;
    const firstSection = inputSections[0];
    const mainInput = firstSection.querySelector<HTMLInputElement>('input[class*="Input_input"]');
    if (!mainInput) return;

    const wrap = document.createElement("div");
    wrap.id = TASK_N1_ID;
    wrap.setAttribute("data-mwi-lite", "1");

    const prefix = document.createElement("span");
    prefix.textContent = ctx.i18n.t("任务次数 ", "Task count ");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "Button_button__1Fe9z Button_small__3fqC7 mwi-lite-task-n1-btn";

    const suffix = document.createElement("span");
    suffix.textContent = " (N-1)";

    wrap.append(prefix, btn, suffix);

    const siblingBtns = firstSection.querySelectorAll(":scope > button");
    const lastBtn = siblingBtns.length > 0 ? siblingBtns[siblingBtns.length - 1] : null;
    if (lastBtn) {
      lastBtn.insertAdjacentElement("afterend", wrap);
    } else {
      firstSection.appendChild(wrap);
    }

    const updateBtn = () => {
      const base = parseActionCount(mainInput.value);
      if (base === null || base <= 0) {
        btn.textContent = "-";
        btn.disabled = true;
        return;
      }
      const nextVal = Math.max(base - 1, 0);
      btn.textContent = formatActionCount(nextVal);
      btn.disabled = base <= 1;
    };

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const base = parseActionCount(mainInput.value);
      if (base === null || base <= 1) return;
      setReactInputValue(mainInput, Math.max(base - 1, 0));
      updateBtn();
    });

    mainInput.addEventListener("input", updateBtn);
    mainInput.addEventListener("change", updateBtn);
    if (inputSections.length > 1) {
      const itemInput = inputSections[1].querySelector<HTMLInputElement>('input[class*="Input_input"]');
      itemInput?.addEventListener("input", updateBtn);
    }

    updateBtn();
    const tId = window.setTimeout(updateBtn, 150);
    timers.push(tId);
  };

  const getCardBaseName = (card: Element): string => {
    const parsed = parseCard(card);
    return parsed ? parsed.fullText : (card.querySelector(TASK_NAME_SEL)?.textContent || "").trim();
  };

  const buildTaskCardKeys = (cards: Element[]): string[] => {
    const counts = new Map<string, number>();
    return cards.map((card, idx) => {
      const base = getCardBaseName(card);
      if (!base) return `idx:${idx}`;
      const nth = counts.get(base) || 0;
      counts.set(base, nth + 1);
      return `${base}#${nth}`;
    });
  };

  const getTaskCardKey = (card: Element, cards: Element[]): string => {
    const idx = cards.indexOf(card);
    if (idx < 0) return "";
    const keys = buildTaskCardKeys(cards);
    return keys[idx] || "";
  };

  const isTaskListSorted = (cards: HTMLElement[]): boolean => {
    if (cards.length < 2) return true;
    const toKey = (card: HTMLElement) => {
      const parsed = parseCard(card);
      const resolved = parsed ? resolveIconForCard(parsed) : null;
      return {
        isCompleted: parsed?.isCompleted ?? false,
        skillOrder: parsed ? SKILL_ORDER[parsed.skillType] ?? 999 : 999,
        isCombat: parsed?.isCombat ?? false,
        monsterSortIndex: resolved?.monsterSortIndex ?? 999_999_999,
        targetName: parsed?.taskTarget || "",
      };
    };
    let prev = toKey(cards[0]);
    for (let i = 1; i < cards.length; i++) {
      const cur = toKey(cards[i]);
      if (prev.isCompleted !== cur.isCompleted) {
        if (!prev.isCompleted && cur.isCompleted) return false;
      } else if (sortMode === "skill") {
        if (prev.skillOrder !== cur.skillOrder) {
          if (prev.skillOrder > cur.skillOrder) return false;
        } else if (prev.isCombat && cur.isCombat && prev.monsterSortIndex !== cur.monsterSortIndex) {
          if (prev.monsterSortIndex > cur.monsterSortIndex) return false;
        } else if (prev.targetName.localeCompare(cur.targetName, "zh-CN") > 0) {
          return false;
        }
      } else if (prev.targetName.localeCompare(cur.targetName, "zh-CN") > 0) {
        return false;
      }
      prev = cur;
    }
    return true;
  };

  const setQueueFeedback = (taskKey: string, label: string, tone: "ok" | "err") => {
    const expiresAt = Date.now() + QUEUE_FEEDBACK_TTL_MS;
    queueFeedbackMap.set(taskKey, { label, tone, expiresAt });
    const tId = window.setTimeout(() => {
      const cur = queueFeedbackMap.get(taskKey);
      if (cur && cur.expiresAt <= Date.now()) {
        queueFeedbackMap.delete(taskKey);
        if (!destroyed && ctx?.domScheduler.getActiveRoute() === "tasks") {
          const list = getTaskCards();
          if (list.length) renderTaskQueueButtons(list);
        }
      }
    }, QUEUE_FEEDBACK_TTL_MS + 20);
    timers.push(tId);
  };

  const captureVisualFreezeOverlay = (savedTabScrollTop: number) => {
    const mainPanel = findRealGameElement<HTMLElement>(document, MAIN_PANEL_SEL);
    const tasksPanel = findRealGameElement<HTMLElement>(document, TASKS_PANEL_SEL);
    if (!mainPanel || !tasksPanel) {
      return { mount: () => {}, remove: () => {} };
    }
    const clone = tasksPanel.cloneNode(true) as HTMLElement;
    clone.style.width = "100%";
    clone.style.height = "100%";
    clone.style.boxSizing = "border-box";
    const clonedTabPanel = clone.querySelector<HTMLElement>(TAB_PANEL_SEL);
    let overlayEl: HTMLElement | null = null;

    return {
      mount() {
        if (overlayEl || destroyed || !document.body) return;
        const rect = mainPanel.getBoundingClientRect();
        const bg = getComputedStyle(mainPanel).backgroundColor || "#121629";
        document.getElementById(FREEZE_OVERLAY_ID)?.remove();
        overlayEl = document.createElement("div");
        overlayEl.id = FREEZE_OVERLAY_ID;
        overlayEl.setAttribute("data-mwi-lite", "1");
        overlayEl.style.cssText = [
          "position:fixed",
          `left:${rect.left}px`,
          `top:${rect.top}px`,
          `width:${rect.width}px`,
          `height:${rect.height}px`,
          `background:${bg === "rgba(0, 0, 0, 0)" || bg === "transparent" ? "#121629" : bg}`,
          "z-index:9400",
          "overflow:hidden",
          "pointer-events:auto",
        ].join(";");
        overlayEl.appendChild(clone);
        document.body.appendChild(overlayEl);
        if (clonedTabPanel && savedTabScrollTop > 0) {
          clonedTabPanel.scrollTop = savedTabScrollTop;
        }
      },
      remove() {
        overlayEl?.remove();
        overlayEl = null;
      },
    };
  };

  const renderTaskQueueButtons = (cards: HTMLElement[]) => {
    if (!ctx) return;
    const now = Date.now();
    const autoMinusOne = ctx.isFeatureEnabled(TASK_AUTO_N1_MODULE_ID);
    const baseText = ctx.i18n.t("添加到队列", "Add to Queue");
    const baseTitle = autoMinusOne
      ? ctx.i18n.t(
          "后台静默前往并按 (N-1) 添加到队列后返回任务界面",
          "Silently go, apply (N-1), add to queue, and return"
        )
      : ctx.i18n.t(
          "后台静默前往并添加到队列后返回任务界面",
          "Silently go, add to queue, and return"
        );

    const taskKeys = buildTaskCardKeys(cards);
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const goBtn = findGoButton(card);
      const existing = card.querySelector<HTMLButtonElement>(`button.${TASK_QUEUE_BTN_CLASS}`);

      if (!goBtn) {
        existing?.remove();
        continue;
      }

      const taskKey = taskKeys[i];
      const fb = queueFeedbackMap.get(taskKey);
      const activeFb = fb && fb.expiresAt > now ? fb : null;
      if (fb && !activeFb) {
        queueFeedbackMap.delete(taskKey);
      }

      let queueBtn = existing;
      if (!queueBtn) {
        queueBtn = document.createElement("button");
        queueBtn.type = "button";
        queueBtn.className = `Button_button__1Fe9z ${TASK_QUEUE_BTN_CLASS}`;
        queueBtn.setAttribute("data-mwi-lite", "1");
        queueBtn.addEventListener("click", (ev) => {
          const clickStartTs = Date.now();
          ev.preventDefault();
          ev.stopPropagation();
          const curCard = queueBtn!.closest(TASK_CARD_SEL);
          const curGoBtn = curCard ? findGoButton(curCard) : null;
          if (!curCard || !curGoBtn || curGoBtn.disabled) return;
          quickQueueTaskCard(curCard, curGoBtn, clickStartTs);
        });
        goBtn.insertAdjacentElement("afterend", queueBtn);
      } else if (queueBtn.previousElementSibling !== goBtn) {
        goBtn.insertAdjacentElement("afterend", queueBtn);
      }

      const nextLabel = activeFb ? activeFb.label : baseText;
      const nextState = activeFb ? activeFb.tone : "";
      const nextDisabled = goBtn.disabled || isQuickQueueing;

      if (queueBtn.textContent !== nextLabel) queueBtn.textContent = nextLabel;
      if (queueBtn.dataset.state !== nextState) {
        if (nextState) queueBtn.dataset.state = nextState;
        else queueBtn.removeAttribute("data-state");
      }
      if (queueBtn.disabled !== nextDisabled) queueBtn.disabled = nextDisabled;
      if (queueBtn.title !== baseTitle) queueBtn.title = baseTitle;
    }
  };

  const quickQueueTaskCard = (
    card: Element,
    goBtn: HTMLButtonElement,
    clickStartTs: number
  ) => {
    if (!ctx || destroyed || isQuickQueueing || isClaimingAll) return;
    if (!goBtn.isConnected || goBtn.disabled) return;

    const cardsBefore = getTaskCards();
    const taskKey = getTaskCardKey(card, cardsBefore);
    const preserveManualSort = manualSortedActive || isTaskListSorted(cardsBefore);
    const taskListBefore = findRealGameElement(document, TASK_LIST_SEL);
    const tabScrollBefore = taskListBefore?.closest<HTMLElement>(TAB_PANEL_SEL)?.scrollTop ?? 0;
    const subScrollBefore = findRealGameElement(document, SUB_PANEL_SEL)?.scrollTop ?? 0;
    const winScrollXBefore = window.scrollX;
    const winScrollYBefore = window.scrollY;

    isQuickQueueing = true;
    const freeze = captureVisualFreezeOverlay(tabScrollBefore);

    const navigateBackToTasks = () => {
      const navBtn = findTasksNavButton(document);
      if (navBtn) {
        triggerButtonActionSafe(navBtn, clickStartTs);
      }
      if (!findRealGameElement(document, TASK_LIST_SEL)) {
        findReactNavCore(document)?.handleChangeNavTarget?.("tasks");
      }
    };

    const finalizeOnTasks = (feedback?: { label: string; tone: "ok" | "err" }): boolean => {
      const taskListAfter = findRealGameElement(document, TASK_LIST_SEL);
      if (!taskListAfter) return false;

      isQuickQueueing = false;
      if (feedback) {
        setQueueFeedback(taskKey, feedback.label, feedback.tone);
      }

      syncDom("tasks", autoSort || preserveManualSort);

      const tabPanelAfter = taskListAfter.closest<HTMLElement>(TAB_PANEL_SEL);
      if (tabPanelAfter && tabPanelAfter.scrollTop !== tabScrollBefore) {
        tabPanelAfter.scrollTop = tabScrollBefore;
      }
      const subPanelAfter = findRealGameElement(document, SUB_PANEL_SEL);
      if (subPanelAfter && subPanelAfter.scrollTop !== subScrollBefore) {
        subPanelAfter.scrollTop = subScrollBefore;
      }
      if (window.scrollX !== winScrollXBefore || window.scrollY !== winScrollYBefore) {
        window.scrollTo(winScrollXBefore, winScrollYBefore);
      }
      return true;
    };

    const tryDetailStep = (detail: HTMLElement): { status: "done" | "retry"; feedback?: { label: string; tone: "ok" | "err" } } => {
      const inputSections = detail.querySelectorAll('[class*="maxActionCountInput"]');
      const mainInput = inputSections[0]?.querySelector<HTMLInputElement>('input[class*="Input_input"]') || null;
      const addQueueBtn = findButtonByTextRe(detail, ADD_TO_QUEUE_BTN_RE);
      const upgradeQueueBtn = findButtonByTextRe(detail, UPGRADE_QUEUE_BTN_RE);
      const startOnlyBtn = findButtonByTextRe(detail, START_ONLY_BTN_RE);

      if (!mainInput && !addQueueBtn && !upgradeQueueBtn && !startOnlyBtn) {
        // Alchemy/Enhancing without pre-selected item mounts selector & instructions immediately without action buttons
        if (detail.querySelector(ACTION_DETAIL_MOUNTED_SEL)) {
          return {
            status: "done",
            feedback: { label: ctx!.i18n.t("无法入队", "Cannot Queue"), tone: "err" },
          };
        }
        return { status: "retry" };
      }

      if (upgradeQueueBtn && !addQueueBtn) {
        return {
          status: "done",
          feedback: { label: ctx!.i18n.t("队列已满", "Queue Full"), tone: "err" },
        };
      }

      const autoMinusOne = ctx!.isFeatureEnabled(TASK_AUTO_N1_MODULE_ID);
      if (autoMinusOne && mainInput) {
        const baseCount = parseActionCount(mainInput.value);
        const targetCount = computeQuickQueueCount(baseCount, true);
        if (targetCount !== null && baseCount !== null && targetCount !== baseCount) {
          setReactInputValue(mainInput, targetCount, false);
        }
      }

      const latestAddQueueBtn = findButtonByTextRe(detail, ADD_TO_QUEUE_BTN_RE);
      if (latestAddQueueBtn) {
        if (latestAddQueueBtn.disabled || latestAddQueueBtn.className.includes("Button_disabled")) {
          return {
            status: "done",
            feedback: { label: ctx!.i18n.t("无法入队", "Cannot Queue"), tone: "err" },
          };
        }
        triggerButtonActionSafe(latestAddQueueBtn, clickStartTs);
        return {
          status: "done",
          feedback: { label: ctx!.i18n.t("✓ 已入队", "✓ Queued"), tone: "ok" },
        };
      }

      // Only click "Start" if character truly has 0 active/queued actions (never click "Start Now"!)
      const detailCount = getDetailActionCount(detail);
      const isEmptyQueue =
        detailCount !== null ? detailCount === 0 : ctx!.gameData.getCharacterActions().length === 0;
      let latestStartBtn = isEmptyQueue ? findButtonByTextRe(detail, START_ONLY_BTN_RE) : null;
      if (!latestStartBtn && isEmptyQueue && detail.querySelector('[class*="enhancingComponent"], [class*="alchemyComponent"]')) {
        // When queue is empty, Alchemy/Enhancing primary button displays the action name instead of "Start"
        const successBtn = detail.querySelector<HTMLButtonElement>('[class*="buttonsContainer"] button[class*="Button_success"]');
        if (successBtn && !STOP_BTN_RE.test((successBtn.textContent || "").trim())) {
          latestStartBtn = successBtn;
        }
      }
      if (latestStartBtn) {
        if (latestStartBtn.disabled || latestStartBtn.className.includes("Button_disabled")) {
          return {
            status: "done",
            feedback: { label: ctx!.i18n.t("无法开始", "Cannot Start"), tone: "err" },
          };
        }
        triggerButtonActionSafe(latestStartBtn, clickStartTs);
        return {
          status: "done",
          feedback: { label: ctx!.i18n.t("✓ 已开始", "✓ Started"), tone: "ok" },
        };
      }

      return {
        status: "done",
        feedback: { label: ctx!.i18n.t("无法入队", "Cannot Queue"), tone: "err" },
      };
    };

    // Step 1: trigger native [前往]
    goBtn.click();

    // Step 2: fast synchronous path (React legacy mode completes inside this call stack with 0 paint frames)
    const syncDetail = findRealGameElement<HTMLElement>(document, SKILL_DETAIL_SEL);
    let pendingFeedback: { label: string; tone: "ok" | "err" } | undefined;
    let detailHandled = false;
    let backNavDispatchedTs = 0;

    if (syncDetail) {
      const step = tryDetailStep(syncDetail);
      if (step.status === "done") {
        detailHandled = true;
        pendingFeedback = step.feedback;
        backNavDispatchedTs = Date.now();
        navigateBackToTasks();
        if (finalizeOnTasks(pendingFeedback)) {
          return;
        }
      }
    }

    // Step 3: async fallback path (mount visual freeze overlay before browser paints intermediate screen)
    freeze.mount();
    let pollTimerId: number | null = null;
    let guardTimerId: number | null = null;
    let restoreTimerId: number | null = null;
    let finished = false;

    const cleanupAsync = (restoreFailFeedback?: { label: string; tone: "ok" | "err" }) => {
      if (finished) return;
      finished = true;
      if (pollTimerId !== null) clearTimeout(pollTimerId);
      if (guardTimerId !== null) clearTimeout(guardTimerId);
      if (restoreTimerId !== null) clearTimeout(restoreTimerId);
      const finalFeedback = restoreFailFeedback ?? pendingFeedback;
      if (!findRealGameElement(document, TASK_LIST_SEL)) {
        navigateBackToTasks();
      }
      if (finalizeOnTasks(finalFeedback)) {
        quickQueueAsyncCleanup = null;
        freeze.remove();
        return;
      }
      // If TasksPanel renders asynchronously after return navigation, preserve feedback & wait briefly before unmounting overlay
      isQuickQueueing = false;
      if (finalFeedback) {
        setQueueFeedback(taskKey, finalFeedback.label, finalFeedback.tone);
      }
      const restoreStart = Date.now();
      const waitRestore = () => {
        if (destroyed) {
          quickQueueAsyncCleanup = null;
          freeze.remove();
          return;
        }
        if (finalizeOnTasks(finalFeedback) || Date.now() - restoreStart >= 300) {
          quickQueueAsyncCleanup = null;
          freeze.remove();
          return;
        }
        restoreTimerId = window.setTimeout(waitRestore, 16);
      };
      restoreTimerId = window.setTimeout(waitRestore, 16);
    };

    quickQueueAsyncCleanup = () => {
      if (finished) return;
      finished = true;
      if (pollTimerId !== null) clearTimeout(pollTimerId);
      if (guardTimerId !== null) clearTimeout(guardTimerId);
      if (restoreTimerId !== null) clearTimeout(restoreTimerId);
      quickQueueAsyncCleanup = null;
      freeze.remove();
      isQuickQueueing = false;
    };

    const tick = () => {
      if (finished || destroyed) {
        cleanupAsync();
        return;
      }

      if (!detailHandled) {
        const detail = findRealGameElement<HTMLElement>(document, SKILL_DETAIL_SEL);
        if (detail) {
          const step = tryDetailStep(detail);
          if (step.status === "done") {
            detailHandled = true;
            pendingFeedback = step.feedback;
            backNavDispatchedTs = Date.now();
            navigateBackToTasks();
          }
        }
      } else if (!findRealGameElement(document, TASK_LIST_SEL) && Date.now() - backNavDispatchedTs >= 250) {
        backNavDispatchedTs = Date.now();
        navigateBackToTasks();
      }

      if (detailHandled && finalizeOnTasks(pendingFeedback)) {
        finished = true;
        if (guardTimerId !== null) clearTimeout(guardTimerId);
        quickQueueAsyncCleanup = null;
        freeze.remove();
        return;
      }

      if (Date.now() - clickStartTs >= QUICK_QUEUE_ASYNC_TIMEOUT_MS) {
        cleanupAsync(
          detailHandled
            ? pendingFeedback
            : { label: ctx!.i18n.t("操作超时", "Timeout"), tone: "err" }
        );
        return;
      }

      pollTimerId = window.setTimeout(tick, 16);
    };

    guardTimerId = window.setTimeout(() => {
      cleanupAsync(
        detailHandled
          ? pendingFeedback
          : { label: ctx!.i18n.t("操作超时", "Timeout"), tone: "err" }
      );
    }, QUICK_QUEUE_ASYNC_TIMEOUT_MS + 40);
    timers.push(guardTimerId);
    pollTimerId = window.setTimeout(tick, 16);
  };

  const syncDom = (route: string, forceSort = false) => {
    injectTaskMinusOneButton();
    if (route !== "tasks" && !findRealGameElement(document, TASK_LIST_SEL)) return;

    const taskList = findRealGameElement(document, TASK_LIST_SEL);
    if (!taskList) return;

    injectToolbar();

    if (lastTaskListRef !== taskList) {
      lastTaskListRef = taskList;
      taskList.addEventListener(
        "pointerdown",
        () => {
          lastPointerDownTs = Date.now();
        },
        true
      );
    }

    const cards = Array.from(taskList.children).filter(
      (el): el is HTMLElement => el.matches(TASK_CARD_SEL)
    );
    syncClaimAllButton(cards);
    if (!cards.length) return;

    renderTaskIcons(cards);
    renderTaskStockBadges(cards);
    sortTaskCards(forceSort);
    renderTaskQueueButtons(cards);
  };

  return {
    id: "planner-task-board",
    nameZh: "任务图标、排序与快速入队",
    nameEn: "Task Icons, Sorter & Quick-Queue",
    descriptionZh: "显示任务图标、库存与自动排序，在「前往」旁提供静默「添加到队列」按钮并在行动弹窗提供 (N-1) 按钮",
    descriptionEn: "Task icons, stock badges, sorter, silent Quick-Queue beside Go, and (N-1) action helper",
    category: "planner",
    defaultEnabled: true,

    init(context) {
      ctx = context;
      destroyed = false;
      isClaimingAll = false;
      claimingStatusText = "";
      cooldownWaitStartTs = 0;
      const saved = ctx.storage.get<TaskSortPref | null>(TASK_SORT_PREF_KEY, null);
      if (saved) {
        if (saved.mode === "skill" || saved.mode === "name") sortMode = saved.mode;
        if (typeof saved.autoSort === "boolean") autoSort = saved.autoSort;
      }

      unregStyle = ctx.addStyle(
        "planner-task-board",
        `
        .mwi-lite-task-toolbar {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-left: 10px;
          vertical-align: middle;
        }
        .mwi-lite-task-btn {
          padding: 2px 8px !important;
          font-size: 11.5px !important;
          font-weight: 700 !important;
          font-family: var(--mwi-px-mono, monospace) !important;
          background: var(--mwi-px-btn-bg, linear-gradient(180deg, #324a8f 0%, #22356b 100%)) !important;
          color: #f8fafc !important;
          border: 1px solid var(--mwi-px-border, #8eb1ff) !important;
          border-radius: 0 !important;
          box-shadow: var(--mwi-px-shadow-btn, 0 0 0 1px #080d1a) !important;
          cursor: pointer;
        }
        .mwi-lite-task-auto[data-active="1"] {
          border-color: var(--mwi-px-green-soft, #86efac) !important;
          background: var(--mwi-px-btn-green, linear-gradient(180deg, #1f6d43 0%, #165132 100%)) !important;
        }
        .mwi-lite-task-auto[data-active="0"] {
          background: linear-gradient(180deg, #27324a 0%, #1a2235 100%) !important;
          border-color: #64748b !important;
        }
        .mwi-lite-task-claim-all {
          font-variant-numeric: tabular-nums !important;
        }
        .mwi-lite-task-claim-all[data-ready="1"] {
          border-color: var(--mwi-px-gold, #fde047) !important;
          background: var(--mwi-px-btn-gold, linear-gradient(180deg, #7c580c 0%, #523907 100%)) !important;
          color: #fef08a !important;
          box-shadow: 0 0 0 1px #080d1a, inset 1px 1px 0 #eab308 !important;
        }
        .mwi-lite-task-claim-all:disabled {
          opacity: 0.5;
          cursor: not-allowed !important;
          background: linear-gradient(180deg, #27324a 0%, #1a2235 100%) !important;
          border-color: #64748b !important;
          color: #94a3b8 !important;
        }
        .mwi-lite-task-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          margin-right: 6px;
          border-radius: 0;
          background: #0e1634;
          border: 1px solid var(--mwi-px-border-inner, #4f6fc4);
          box-shadow: 0 0 0 1px #070b16;
          vertical-align: middle;
          pointer-events: none;
          flex-shrink: 0;
        }
        .mwi-lite-task-icon svg {
          display: block;
        }
        ${TASK_ACTION_SEL} {
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          flex-wrap: wrap !important;
          gap: 4px 8px !important;
        }
        .mwi-lite-task-stock-group {
          display: inline-flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: flex-end;
          gap: 4px;
          max-width: 100%;
          margin-left: auto;
        }
        .mwi-lite-task-stock {
          display: inline-flex;
          align-items: center;
          max-width: 100%;
          padding: 1px 6px;
          border-radius: 0;
          font-size: 11px;
          font-weight: 700;
          font-family: var(--mwi-px-mono, monospace);
          font-variant-numeric: tabular-nums;
          line-height: 1.35;
          background: #0b1228;
          border: 1px solid var(--mwi-px-border-inner, #4f6fc4);
          box-shadow: 0 0 0 1px #070b16;
          color: var(--mwi-px-accent, #93c5fd);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .mwi-lite-task-stock[data-level="zero"] {
          background: #3d2a06;
          border-color: var(--mwi-px-gold, #fde047);
          color: var(--mwi-px-gold, #fde047);
        }
        #${TASK_N1_ID} {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          margin-left: 6px;
          color: var(--mwi-px-gold, #fde047);
          font-family: var(--mwi-px-mono, monospace);
          font-size: 11.5px;
        }
        #${TASK_N1_ID} .mwi-lite-task-n1-btn {
          background: var(--mwi-px-btn-gold, linear-gradient(180deg, #7c580c 0%, #523907 100%)) !important;
          color: #fef08a !important;
          padding: 2px 7px !important;
          font-weight: 800 !important;
          font-family: var(--mwi-px-mono, monospace) !important;
          border: 1px solid var(--mwi-px-gold, #fde047) !important;
          border-radius: 0 !important;
          box-shadow: 0 0 0 1px #080d1a, inset 1px 1px 0 #eab308 !important;
          cursor: pointer;
        }
        #${TASK_N1_ID} .mwi-lite-task-n1-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        [class*="RandomTask_buttonsContainer"]:has(.${TASK_QUEUE_BTN_CLASS}) {
          flex-wrap: wrap !important;
          gap: 4px 6px !important;
        }
        [class*="RandomTask_buttonsContainer"]:has(.${TASK_QUEUE_BTN_CLASS}) > [class*="RandomTask_buttonGroup"] {
          margin-right: auto !important;
        }
        .${TASK_QUEUE_BTN_CLASS} {
          padding: 0 10px !important;
          border-radius: 0 !important;
          font-size: 12px !important;
          font-weight: 700 !important;
          font-family: var(--mwi-px-mono, monospace) !important;
          background: var(--mwi-px-btn-bg, linear-gradient(180deg, #324a8f 0%, #22356b 100%)) !important;
          color: #f8fafc !important;
          border: 1px solid var(--mwi-px-border, #8eb1ff) !important;
          box-shadow: var(--mwi-px-shadow-btn, 0 0 0 1px #080d1a) !important;
          white-space: nowrap !important;
          cursor: pointer;
        }
        @media (max-width: 767px) {
          .${TASK_QUEUE_BTN_CLASS} {
            padding: 0 7px !important;
            font-size: 10px !important;
          }
        }
        .${TASK_QUEUE_BTN_CLASS}:hover:not(:disabled) {
          background: var(--mwi-px-btn-hover, linear-gradient(180deg, #405eb3 0%, #2b4385 100%)) !important;
        }
        .${TASK_QUEUE_BTN_CLASS}[data-state="ok"] {
          border-color: var(--mwi-px-green-soft, #86efac) !important;
          background: var(--mwi-px-btn-green, linear-gradient(180deg, #1f6d43 0%, #165132 100%)) !important;
          color: #dcfce7 !important;
        }
        .${TASK_QUEUE_BTN_CLASS}[data-state="err"] {
          border-color: #fca5a5 !important;
          background: linear-gradient(180deg, #7f1d1d 0%, #581313 100%) !important;
          color: #fee2e2 !important;
        }
        .${TASK_QUEUE_BTN_CLASS}:disabled {
          opacity: 0.55;
          cursor: not-allowed !important;
        }
        `
      );

      const scheduleTasksRefresh = () => {
        if (ctx?.domScheduler.getActiveRoute() === "tasks") {
          const id = window.setTimeout(() => {
            ctx?.domScheduler.scheduleRun(false);
          }, 120);
          timers.push(id);
        }
      };

      unregQuests = ctx.gameData.on("quests_updated", scheduleTasksRefresh);
      unregItems = ctx.gameData.on("items_updated", scheduleTasksRefresh);
      unregInit = ctx.gameData.on("character_initialized", scheduleTasksRefresh);

      return () => {
        destroyed = true;
        isClaimingAll = false;
        isQuickQueueing = false;
        manualSortedActive = false;
        claimingStatusText = "";
        cooldownWaitStartTs = 0;
        activeSettleCleanup?.();
        activeSettleCleanup = null;
        quickQueueAsyncCleanup?.();
        quickQueueAsyncCleanup = null;
        queueFeedbackMap.clear();
        if (cooldownSyncTimer !== null) {
          clearTimeout(cooldownSyncTimer);
          cooldownSyncTimer = null;
        }
        unregStyle?.();
        unregStyle = null;
        unregQuests?.();
        unregQuests = null;
        unregItems?.();
        unregItems = null;
        unregInit?.();
        unregInit = null;
        timers.forEach((t) => clearTimeout(t));
        timers = [];
        lastTaskListRef = null;
        document
          .querySelectorAll(
            `.mwi-lite-task-toolbar, .mwi-lite-task-icon, .mwi-lite-task-stock-group, .mwi-lite-task-stock, .${TASK_QUEUE_BTN_CLASS}, #${TASK_N1_ID}, #${FREEZE_OVERLAY_ID}`
          )
          .forEach((el) => el.remove());
        document.querySelectorAll("[data-mwi-task-icon]").forEach((el) => el.removeAttribute("data-mwi-task-icon"));
        document.querySelectorAll("[data-mwi-task-stock]").forEach((el) => el.removeAttribute("data-mwi-task-stock"));
      };
    },

    onDom(_doc, route) {
      syncDom(route);
    },
  };
}

export function createTaskAutoMinusOneModule(): FeatureModule {
  return {
    id: TASK_AUTO_N1_MODULE_ID,
    nameZh: "任务一键入队自动 (N-1)",
    nameEn: "Task Quick-Queue: Auto (N-1)",
    descriptionZh: "点击任务界面「添加到队列」时自动将次数减 1（N≤1 时保持不变，默认关闭）",
    descriptionEn: "Automatically apply (N-1) count when using Quick-Queue on task cards (keeps 1 if N≤1)",
    category: "planner",
    defaultEnabled: false,

    init() {
      // Setting-only toggle consumed by planner-task-board
    },
  };
}
