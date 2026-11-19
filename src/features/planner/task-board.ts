import type { FeatureModule, KernelContext } from "../../core/types";

const TASK_SORT_PREF_KEY = "task_board_sort_pref_v1";
const TASK_LIST_SEL = '[class*="TasksPanel_taskList"]';
const TASK_CARD_SEL = '[class*="RandomTask_randomTask"]';
const TASK_NAME_SEL = '[class*="RandomTask_name"]';
const SLOT_COUNT_SEL = '[class*="TasksPanel_taskSlotCount"]';
const TASK_N1_ID = "mwi-lite-task-n1";

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

  // Lazy cached sprite URLs & reverse lookup maps
  const spriteUrls: Partial<Record<SpriteType, string>> = {};
  let manifestFetching: Promise<void> | null = null;
  let actionNameToHrid: Map<string, string> | null = null;
  let monsterNameToHrid: Map<string, string> | null = null;
  let lookupBuilt = false;

  const savePref = () => {
    ctx?.storage.set<TaskSortPref>(TASK_SORT_PREF_KEY, { mode: sortMode, autoSort });
  };

  const ensureLookupMaps = () => {
    if (lookupBuilt || !ctx) return;
    const clientData = ctx.gameData.getClientData();
    if (!clientData) return;

    actionNameToHrid = new Map();
    monsterNameToHrid = new Map();

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
    }

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

    lookupBuilt = true;
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
    const claimBtn = card.querySelector('button[class*="Button_buy"]');
    const isCompleted = Boolean(claimBtn && /领取奖励|Claim Reward/i.test(claimBtn.textContent || ""));
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
        const quests = ctx.gameData.getCharacterQuests();
        const q = quests.find((item) => item?.monsterHrid && parsed.taskTarget.includes(ctx!.i18n.getMonsterName(item.monsterHrid)));
        if (q) monsterHrid = q.monsterHrid;
      }
      if (!monsterHrid) return null;
      const monsterMap = clientData.combatMonsterDetailMap || clientData.monsterDetailMap;
      const sortIndex = monsterMap?.[monsterHrid]?.sortIndex ?? 999;
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
        monsterSortIndex: resolved?.monsterSortIndex ?? 999,
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

  const injectToolbar = () => {
    if (!ctx) return;
    const slotCount = document.querySelector(SLOT_COUNT_SEL);
    if (!slotCount || slotCount.querySelector(".mwi-lite-task-toolbar")) return;

    const bar = document.createElement("span");
    bar.className = "mwi-lite-task-toolbar";
    bar.setAttribute("data-mwi-lite", "1");

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

    bar.append(sortBtn, autoBtn);
    slotCount.appendChild(bar);
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
          background: #1e73be !important;
          color: #fff !important;
          border: none !important;
          border-radius: 4px !important;
          cursor: pointer;
        }
        .mwi-lite-task-auto[data-active="1"] { background: #2e8b57 !important; }
        .mwi-lite-task-auto[data-active="0"] { background: #4b5563 !important; }
        .mwi-lite-task-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          margin-right: 6px;
          border-radius: 4px;
          background: rgba(15, 23, 42, 0.55);
          border: 1px solid rgba(148, 163, 184, 0.25);
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
          gap: 3px;
          margin-left: 6px;
          color: #f59e0b;
          font-size: 12px;
        }
        #${TASK_N1_ID} .mwi-lite-task-n1-btn {
          background: #f8fafc !important;
          color: #0f172a !important;
          padding: 1px 6px !important;
          font-weight: 700 !important;
          border: 1px solid #cbd5e1 !important;
          border-radius: 4px !important;
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
