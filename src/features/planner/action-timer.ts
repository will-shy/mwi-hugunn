import type { FeatureModule, KernelContext } from "../../core/types";
import { estimateActionTiming, type ActionTimingEstimate } from "./action-time-math";

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

function formatTimingTooltip(ctx: KernelContext, est: ActionTimingEstimate): string {
  const parts = [
    `${ctx.i18n.t("单次", "Attempt")}: ${est.perAttemptSec.toFixed(2)}s`,
    `${ctx.i18n.t("加速", "Speed")}: +${(est.actionSpeed * 100).toFixed(1)}%`,
  ];
  if (est.taskActionSpeed > 0) {
    parts.push(`${ctx.i18n.t("任务加速", "Task Spd")}: +${(est.taskActionSpeed * 100).toFixed(1)}%`);
  }
  if (est.efficiency > 0) {
    parts.push(`${ctx.i18n.t("效率", "Efficiency")}: +${(est.efficiency * 100).toFixed(1)}%`);
    parts.push(`${ctx.i18n.t("等效", "Eff")}: ${est.effectiveSecPerCount.toFixed(2)}s/${ctx.i18n.t("次", "act")}`);
  }
  return parts.join(" · ");
}

function buildActionEstimator(ctx: KernelContext, actions: readonly any[]) {
  const clientData = ctx.gameData.getClientData();
  const buffSources = ctx.gameData.getActionTypeBuffSources();
  const characterSkills = ctx.gameData.getCharacterSkills();
  const characterItems = ctx.gameData.getCharacterItems();
  const characterQuests = ctx.gameData.getCharacterQuests();
  const characterLoadouts = ctx.gameData.getCharacterLoadouts();
  const drinkSlotsMap = ctx.gameData.getActionTypeDrinkSlots();
  const currentActionLoadoutId = actions[0]?.characterLoadoutID ?? null;
  const nowMs = Date.now();

  return (action: any, index: number): ActionTimingEstimate =>
    estimateActionTiming({
      action,
      actionIndex: index,
      currentActionLoadoutId,
      clientData,
      buffSources,
      characterSkills,
      characterItems,
      characterQuests,
      characterLoadouts,
      drinkSlotsMap,
      nowMs,
    });
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

    const estimateAt = buildActionEstimator(ctx, actions);
    const curEst = estimateAt(current, 0);
    if (curEst.perAttemptSec <= 0) {
      timerEl.textContent = "";
      timerEl.title = "";
      return;
    }

    let queueTotal = curEst.totalSec;
    let queueInf = curEst.isInfinite;
    for (let i = 1; i < actions.length; i++) {
      const est = estimateAt(actions[i], i);
      if (est.isInfinite) queueInf = true;
      queueTotal += est.totalSec;
    }

    const curPart = curEst.isInfinite
      ? `∞ (${curEst.perAttemptSec.toFixed(2)}s)`
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
    const nextTitle = formatTimingTooltip(ctx, curEst);
    if (timerEl.title !== nextTitle) {
      timerEl.title = nextTitle;
    }
  };

  const updateQueuePopups = () => {
    const context = ctx;
    if (!context) return;
    const actions = [...context.gameData.getCharacterActions()].sort(
      (a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)
    );
    if (!actions.length) return;

    const actionIndexById = new Map<number, number>();
    actions.forEach((a, idx) => {
      if (typeof a.id === "number") actionIndexById.set(a.id, idx);
    });

    const menu = document.querySelector('[class*="QueuedActions_queuedActionsEditMenu"]');
    if (menu) {
      const estimateAt = buildActionEstimator(context, actions);
      const firstEst = estimateAt(actions[0], 0);
      let accSec = firstEst.totalSec;
      let hasInf = firstEst.isInfinite;
      const rows = menu.querySelectorAll('[class*="QueuedActions_action__"][data-action-id]');
      rows.forEach((row) => {
        const id = Number(row.getAttribute("data-action-id"));
        const idx = actionIndexById.get(id);
        if (idx === undefined) return;
        const est = estimateAt(actions[idx], idx);
        if (idx > 0) {
          accSec += est.totalSec;
          if (est.isInfinite) hasInf = true;
        }

        let tag = row.querySelector<HTMLElement>(`.${QUEUE_TAG_CLASS}`);
        if (!tag) {
          tag = document.createElement("span");
          tag.className = QUEUE_TAG_CLASS;
          tag.setAttribute("data-mwi-lite", "1");
          row.appendChild(tag);
        }
        const txt = est.isInfinite
          ? `∞ (${est.perAttemptSec.toFixed(2)}s)`
          : `${formatDuration(est.totalSec)}${hasInf ? "" : ` (${formatFinishClock(idx === 0 ? firstEst.totalSec : accSec)})`}`;
        if (tag.textContent !== txt) tag.textContent = txt;
        const tip = formatTimingTooltip(context, est);
        if (tag.title !== tip) tag.title = tip;
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
          display: inline-flex;
          align-items: center;
          margin-left: 8px;
          padding: 1px 7px;
          border-radius: 0;
          border: 1px solid var(--mwi-px-border-inner, #4f6fc4);
          background: var(--mwi-px-card-bg, linear-gradient(180deg, #17244d 0%, #0e1634 100%));
          box-shadow: 0 0 0 1px #070b16, inset 1px 1px 0 #293e7a;
          font-size: 11.5px;
          font-family: var(--mwi-px-mono, monospace);
          font-variant-numeric: tabular-nums;
          color: var(--mwi-px-accent, #93c5fd);
          font-weight: 700;
          white-space: nowrap;
        }
        .${QUEUE_TAG_CLASS} {
          margin-left: 6px;
          padding: 0 4px;
          border-radius: 0;
          border: 1px solid #354c8c;
          background: #101938;
          font-size: 10.5px;
          font-family: var(--mwi-px-mono, monospace);
          font-variant-numeric: tabular-nums;
          color: #bfdbfe;
          white-space: nowrap;
        }
        `
      );

      unsubs = [
        ctx.gameData.on("character_initialized", syncTimers),
        ctx.gameData.on("actions_updated", syncTimers),
        ctx.gameData.on("action_completed", updateHeaderBar),
        ctx.gameData.on("buffs_updated", syncTimers),
        ctx.gameData.on("skills_updated", syncTimers),
        ctx.gameData.on("house_rooms_updated", syncTimers),
        ctx.gameData.on("consumables_updated", syncTimers),
        ctx.gameData.on("personal_buffs_updated", syncTimers),
        ctx.gameData.on("quests_updated", syncTimers),
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
