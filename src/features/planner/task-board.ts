import type { FeatureModule, KernelContext } from "../../core/types";

const TASK_SORT_PREF_KEY = "task_board_sort_pref_v1";
const TASK_LIST_SEL = '[class*="TasksPanel_taskList"]';
const TASK_CARD_SEL = '[class*="RandomTask_randomTask"]';
const TASK_NAME_SEL = '[class*="RandomTask_name"]';
const SLOT_COUNT_SEL = '[class*="TasksPanel_taskSlotCount"]';
const TASK_N1_ID = "mwi-lite-task-n1";
const CLAIM_REWARD_BTN_RE = /领取奖励|Claim\s*Reward/i;

function findClaimButton(card: Element): HTMLButtonElement | null {
  const btns = card.querySelectorAll<HTMLButtonElement>("button");
  for (const btn of btns) {
    if (btn.disabled || btn.className.includes("Button_disabled")) continue;
    if (CLAIM_REWARD_BTN_RE.test(btn.textContent || "")) return btn;
  }
  return null;
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

function setReactInputValue(input: HTMLInputElement, value: number): void {
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  proto?.set?.call(input, String(value));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.focus();
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

type SpriteType = "items" | "actions" | "monsters";

export function createTaskBoardModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let unregStyle: (() => void) | null = null;
  let unregQuests: (() => void) | null = null;
  let sortMode: TaskSortMode = "skill";
  let autoSort = true;
  let lastPointerDownTs = 0;
  let lastTaskListRef: Element | null = null;
  let timers: number[] = [];
  let isClaimingAll = false;
  let claimingFreezeUntil = 0;
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
    const isCompleted = Boolean(findClaimButton(card));
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

  const sortTaskCards = (force = false) => {
    if (!ctx) return;
    if (!force && !autoSort) return;
    if (!force && (isClaimingAll || Date.now() < claimingFreezeUntil)) return;
    if (!force && Date.now() - lastPointerDownTs < 250) {
      const id = window.setTimeout(() => sortTaskCards(false), 260);
      timers.push(id);
      return;
    }

    const taskList = document.querySelector(TASK_LIST_SEL);
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
    const taskList = document.querySelector(TASK_LIST_SEL);
    if (!taskList) return [];
    return Array.from(taskList.children).filter((el): el is HTMLElement => el.matches(TASK_CARD_SEL));
  };

  const syncClaimAllButton = (cards?: Element[]) => {
    if (!ctx) return;
    const btn = document.querySelector<HTMLButtonElement>(".mwi-lite-task-claim-all");
    if (!btn || isClaimingAll) return;
    const list = cards ?? getTaskCards();
    let claimableCount = 0;
    for (const c of list) {
      if (findClaimButton(c)) claimableCount++;
    }
    btn.disabled = claimableCount === 0;
    btn.dataset.ready = claimableCount > 0 ? "1" : "0";
    btn.textContent =
      claimableCount > 0
        ? ctx.i18n.t(`一键领取 (${claimableCount})`, `Claim All (${claimableCount})`)
        : ctx.i18n.t("一键领取", "Claim All");
    btn.title = ctx.i18n.t(
      "依次领取所有已完成任务的积分奖励",
      "Claim rewards from all completed tasks"
    );
  };

  const claimAllCompletedTasks = async () => {
    if (!ctx || isClaimingAll || destroyed) return;
    const initialCards = getTaskCards();
    const total = initialCards.reduce((sum, c) => sum + (findClaimButton(c) ? 1 : 0), 0);
    if (total === 0) {
      syncClaimAllButton(initialCards);
      return;
    }

    const claimBtn = document.querySelector<HTMLButtonElement>(".mwi-lite-task-claim-all");
    isClaimingAll = true;
    const dispatched = new WeakSet<HTMLButtonElement>();
    let claimed = 0;
    let idleWaitSteps = 0;

    try {
      for (let step = 0; step < total * 3 + 30; step++) {
        if (destroyed || !isClaimingAll) break;
        const pending = getTaskCards()
          .map((c) => findClaimButton(c))
          .filter((b): b is HTMLButtonElement => b !== null);
        if (pending.length === 0) break;

        const targetBtn = pending.find((b) => !dispatched.has(b));
        if (!targetBtn) {
          idleWaitSteps++;
          if (idleWaitSteps >= 15) break;
          await new Promise<void>((resolve) => {
            const t = window.setTimeout(resolve, 80);
            timers.push(t);
          });
          continue;
        }

        idleWaitSteps = 0;
        dispatched.add(targetBtn);
        claimed++;
        claimingFreezeUntil = Date.now() + 900;
        if (claimBtn && claimBtn.isConnected) {
          claimBtn.disabled = true;
          claimBtn.textContent = ctx.i18n.t(
            `领取中 (${claimed}/${total})`,
            `Claiming (${claimed}/${total})`
          );
        }
        targetBtn.click();
        await new Promise<void>((resolve) => {
          const t = window.setTimeout(resolve, 95);
          timers.push(t);
        });
      }
    } finally {
      isClaimingAll = false;
      claimingFreezeUntil = Date.now() + 220;
      syncClaimAllButton();
      const t = window.setTimeout(() => {
        if (!destroyed) ctx?.domScheduler.scheduleRun(false);
      }, 240);
      timers.push(t);
    }
  };

  const injectToolbar = () => {
    if (!ctx) return;
    const slotCount = document.querySelector(SLOT_COUNT_SEL);
    if (!slotCount || slotCount.querySelector(".mwi-lite-task-toolbar")) return;

    const bar = document.createElement("span");
    bar.className = "mwi-lite-task-toolbar";
    bar.setAttribute("data-mwi-lite", "1");

    const claimAllBtn = document.createElement("button");
    claimAllBtn.type = "button";
    claimAllBtn.className = "Button_button__1Fe9z Button_small__3fqC7 mwi-lite-task-btn mwi-lite-task-claim-all";
    claimAllBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void claimAllCompletedTasks();
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

  const syncDom = (route: string) => {
    injectTaskMinusOneButton();
    if (route !== "tasks" && !document.querySelector(TASK_LIST_SEL)) return;

    const taskList = document.querySelector(TASK_LIST_SEL);
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
    sortTaskCards(false);
  };

  return {
    id: "planner-task-board",
    nameZh: "任务图标、排序与跳转 N-1",
    nameEn: "Task Icons, Sorter & (N-1)",
    descriptionZh: "显示任务图标与自动排序，并在任务跳转后的行动弹窗提供快捷 (N-1) 次数按钮",
    descriptionEn: "Task icons, smart sorter, and (N-1) action count helper on task navigation",
    category: "planner",
    defaultEnabled: true,

    init(context) {
      ctx = context;
      destroyed = false;
      isClaimingAll = false;
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
        `
      );

      unregQuests = ctx.gameData.on("quests_updated", () => {
        if (ctx?.domScheduler.getActiveRoute() === "tasks") {
          const id = window.setTimeout(() => {
            ctx?.domScheduler.scheduleRun(false);
          }, 120);
          timers.push(id);
        }
      });

      return () => {
        destroyed = true;
        isClaimingAll = false;
        unregStyle?.();
        unregStyle = null;
        unregQuests?.();
        unregQuests = null;
        timers.forEach((t) => clearTimeout(t));
        timers = [];
        lastTaskListRef = null;
        document
          .querySelectorAll(`.mwi-lite-task-toolbar, .mwi-lite-task-icon, #${TASK_N1_ID}`)
          .forEach((el) => el.remove());
        document.querySelectorAll("[data-mwi-task-icon]").forEach((el) => el.removeAttribute("data-mwi-task-icon"));
      };
    },

    onDom(_doc, route) {
      syncDom(route);
    },
  };
}
