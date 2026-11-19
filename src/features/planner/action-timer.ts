import type { FeatureModule, KernelContext } from "../../core/types";

const HEADER_TIMER_ID = "mwi-lite-action-timer";
const QUEUE_TAG_CLASS = "mwi-lite-queue-time-tag";

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "0s";
  const s = Math.ceil(sec);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(rem).padStart(2, "0")}s`;
  return `${rem}s`;
}

function formatFinishClock(secFromNow: number): string {
  if (!Number.isFinite(secFromNow) || secFromNow <= 0) return "";
  const end = new Date(Date.now() + secFromNow * 1000);
  const hh = String(end.getHours()).padStart(2, "0");
  const mm = String(end.getMinutes()).padStart(2, "0");
  const now = new Date();
  if (end.getDate() !== now.getDate() || end.getMonth() !== now.getMonth()) {
    return `${end.getMonth() + 1}/${end.getDate()} ${hh}:${mm}`;
  }
  return `${hh}:${mm}`;
}

function estimateActionSeconds(ctx: KernelContext, action: any): {
  perActionSec: number;
  remainingActions: number;
  totalSec: number;
  isInfinite: boolean;
} {
  const clientData = ctx.gameData.getClientData();
  const detail = clientData?.actionDetailMap?.[action.actionHrid];
  if (!detail) {
    return { perActionSec: 0, remainingActions: 0, totalSec: 0, isInfinite: false };
  }

  let baseSec = (detail.baseTimeCost || 0) / 1e9;
  if (baseSec <= 0) baseSec = 3;

  // Read equipment speed bonus + personal + guild speed bonus if available
  const actionType = detail.type;
  let speedBonus = 0;

  const personal = ctx.gameData.getPersonalBuffs()?.[actionType];
  if (Array.isArray(personal)) {
    for (const b of personal) {
      if (b?.typeHrid === "/buff_types/action_speed") {
        speedBonus += (b.flatBoost || 0) + (b.ratioBoost || 0);
      }
    }
  }

  const guildBuffs = ctx.gameData.getGuildActionBuffs()?.[actionType];
  if (Array.isArray(guildBuffs)) {
    for (const b of guildBuffs) {
      if (b?.typeHrid === "/buff_types/action_speed") {
        speedBonus += (b.flatBoost || 0) + (b.ratioBoost || 0);
      }
    }
  }

  // Equipment action speed bonuses
  const itemDetailMap = clientData?.itemDetailMap || {};
  const multTable = clientData?.enhancementLevelTotalBonusMultiplierTable || [];
  for (const item of ctx.gameData.getCharacterItems()) {
    if (!item || item.itemLocationHrid === "/item_locations/inventory") continue;
    const eq = itemDetailMap[item.itemHrid]?.equipmentDetail;
    if (!eq) continue;
    const stats = eq.noncombatStats || {};
    const enhStats = eq.noncombatEnhancementBonuses || {};
    const enhMult = multTable[item.enhancementLevel || 0] || 0;
    const skillPart = actionType?.split("/").pop() || "";
    const speedKey = `${skillPart}Speed`;
    if (typeof stats[speedKey] === "number") speedBonus += stats[speedKey];
    if (typeof enhStats[speedKey] === "number") speedBonus += enhStats[speedKey] * enhMult;
    if (typeof stats.skillingSpeed === "number") speedBonus += stats.skillingSpeed;
    if (typeof enhStats.skillingSpeed === "number") speedBonus += enhStats.skillingSpeed * enhMult;
  }

  // Tea speed (e.g. artisan doesn't give speed, but ultra_speed / skilling tea can)
  const drinks = ctx.gameData.getActionTypeDrinkSlots().get(actionType) || [];
  for (const d of drinks) {
    const buff = itemDetailMap[d?.itemHrid]?.consumableDetail?.buffs;
    if (Array.isArray(buff)) {
      for (const b of buff) {
        if (b?.typeHrid === "/buff_types/action_speed") {
          speedBonus += b.flatBoost || 0;
        }
      }
    }
  }

  const perActionSec = baseSec / Math.max(0.2, 1 + speedBonus);
  const hasMax = action.hasMaxCount && (action.maxCount || 0) > 0;
  const remainingActions = hasMax ? Math.max(0, action.maxCount - (action.currentCount || 0)) : 0;

  let elapsedFraction = 0;
  if (action.startTime) {
    const elapsedSec = Math.max(0, (Date.now() - new Date(action.startTime).getTime()) / 1000);
    elapsedFraction = Math.min(perActionSec * 0.99, elapsedSec % perActionSec);
  }

  const totalSec = hasMax ? Math.max(0, remainingActions * perActionSec - elapsedFraction) : 0;
  return { perActionSec, remainingActions, totalSec, isInfinite: !hasMax };
}

export function createActionTimerModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let unregStyle: (() => void) | null = null;
  let unsubs: Array<() => void> = [];
  let intervalId: number | null = null;

  const updateHeaderBar = () => {
    if (!ctx) return;
    const actionNameEl = document.querySelector<HTMLElement>('div[class*="Header_actionName"]');
    if (!actionNameEl?.parentElement) return;

    let timerEl = document.getElementById(HEADER_TIMER_ID);
    const actions = [...ctx.gameData.getCharacterActions()].sort(
      (a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)
    );
    const current = actions[0];

    if (!current || (actionNameEl.textContent || "").includes("Doing nothing") || (actionNameEl.textContent || "").includes("无")) {
      if (timerEl) timerEl.textContent = "";
      return;
    }

    if (!timerEl) {
      timerEl = document.createElement("span");
      timerEl.id = HEADER_TIMER_ID;
      timerEl.setAttribute("data-mwi-lite", "1");
      actionNameEl.parentElement.insertBefore(timerEl, actionNameEl.nextSibling);
    }

    const curEst = estimateActionSeconds(ctx, current);
    if (curEst.perActionSec <= 0) {
      timerEl.textContent = "";
      return;
    }

    let queueTotal = curEst.totalSec;
    let queueInf = curEst.isInfinite;
    for (let i = 1; i < actions.length; i++) {
      const est = estimateActionSeconds(ctx, actions[i]);
      if (est.isInfinite) queueInf = true;
      queueTotal += est.totalSec;
    }

    const curPart = curEst.isInfinite
      ? `∞ (${curEst.perActionSec.toFixed(1)}s)`
      : `${formatDuration(curEst.totalSec)} → ${formatFinishClock(curEst.totalSec)}`;

    const queuePart =
      actions.length > 1
        ? queueInf
          ? ` | ${ctx.i18n.t("队列", "Q")}: ∞`
          : ` | ${ctx.i18n.t("总计", "Total")}: ${formatDuration(queueTotal)} (${formatFinishClock(queueTotal)})`
        : "";

    const nextText = `⏱ ${curPart}${queuePart}`;
    if (timerEl.textContent !== nextText) {
      timerEl.textContent = nextText;
    }
  };

  const updateQueuePopups = () => {
    const context = ctx;
    if (!context) return;
    const actions = [...context.gameData.getCharacterActions()].sort(
      (a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)
    );
    if (!actions.length) return;

    const actionById = new Map<number, any>();
    for (const a of actions) {
      if (typeof a.id === "number") actionById.set(a.id, a);
    }

    const menu = document.querySelector('[class*="QueuedActions_queuedActionsEditMenu"]');
    if (menu) {
      const firstEst = estimateActionSeconds(context, actions[0]);
      let accSec = firstEst.totalSec;
      let hasInf = firstEst.isInfinite;
      const rows = menu.querySelectorAll('[class*="QueuedActions_action__"][data-action-id]');
      rows.forEach((row) => {
        const id = Number(row.getAttribute("data-action-id"));
        const act = actionById.get(id);
        if (!act) return;
        const est = estimateActionSeconds(context, act);
        accSec += est.totalSec;
        if (est.isInfinite) hasInf = true;

        let tag = row.querySelector<HTMLElement>(`.${QUEUE_TAG_CLASS}`);
        if (!tag) {
          tag = document.createElement("span");
          tag.className = QUEUE_TAG_CLASS;
          tag.setAttribute("data-mwi-lite", "1");
          row.appendChild(tag);
        }
        const txt = est.isInfinite
          ? "∞"
          : `${formatDuration(est.totalSec)}${hasInf ? "" : ` (${formatFinishClock(accSec)})`}`;
        if (tag.textContent !== txt) tag.textContent = txt;
      });
    }
  };

  const syncTimers = () => {
    if (document.hidden) {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      return;
    }
    updateHeaderBar();
    updateQueuePopups();
    if (intervalId === null) {
      intervalId = window.setInterval(() => {
        if (!document.hidden) {
          updateHeaderBar();
        }
      }, 1000);
    }
  };

  return {
    id: "planner-action-timer",
    nameZh: "动作完成时间与倒计时",
    nameEn: "Action Completion Time & Countdown",
    descriptionZh: "在顶部状态栏与队列面板显示当前及队列动作的剩余耗时与精确完成时刻（切后台自动休眠）",
    descriptionEn: "Show remaining countdown and finish wall-clock time on action bar and queue menu",
    category: "planner",
    defaultEnabled: true,

    init(context) {
      ctx = context;
      unregStyle = ctx.addStyle(
        "planner-action-timer",
        `
        #${HEADER_TIMER_ID} {
          margin-left: 8px;
          font-size: 12px;
          color: #93c5fd;
          font-weight: 500;
          white-space: nowrap;
        }
        .${QUEUE_TAG_CLASS} {
          margin-left: 6px;
          font-size: 11px;
          color: #a5b4fc;
          white-space: nowrap;
        }
        `
      );

      unsubs = [
        ctx.gameData.on("character_initialized", syncTimers),
        ctx.gameData.on("actions_updated", syncTimers),
        ctx.gameData.on("action_completed", updateHeaderBar),
      ];
      document.addEventListener("visibilitychange", syncTimers);
      syncTimers();

      return () => {
        document.removeEventListener("visibilitychange", syncTimers);
        unsubs.forEach((u) => u());
        unsubs = [];
        unregStyle?.();
        unregStyle = null;
        if (intervalId !== null) {
          clearInterval(intervalId);
          intervalId = null;
        }
        document.getElementById(HEADER_TIMER_ID)?.remove();
        document.querySelectorAll(`.${QUEUE_TAG_CLASS}`).forEach((el) => el.remove());
      };
    },

    onDom() {
      updateHeaderBar();
      updateQueuePopups();
    },
  };
}
