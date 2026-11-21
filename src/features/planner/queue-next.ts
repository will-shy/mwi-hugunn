import type { FeatureModule, KernelContext } from "../../core/types";

const MENU_SEL = '[class*="QueuedActions_queuedActionsEditMenu"]';
const ROW_SEL = '[class*="QueuedActions_action__"][data-action-id]';
const NEXT_ATTR = "data-mwi-lite-queue-next";
const SVG_NS = "http://www.w3.org/2000/svg";

function createNextIcon(doc: Document, refSvg: SVGElement): SVGElement {
  const icon = refSvg.cloneNode(false) as SVGElement;
  icon.setAttribute("aria-label", "next");
  icon.setAttribute("viewBox", "0 0 20 20");
  icon.removeAttribute("fill");

  const line1 = doc.createElementNS(SVG_NS, "path");
  line1.setAttribute("d", "M0 1.5h20");
  line1.setAttribute("stroke", "#FEFEFE");
  line1.setAttribute("stroke-width", "3");

  const line2 = doc.createElementNS(SVG_NS, "path");
  line2.setAttribute("d", "M0 5.5h20");
  line2.setAttribute("stroke", "#FEFEFE");
  line2.setAttribute("stroke-width", "3");

  const arrow = doc.createElementNS(SVG_NS, "path");
  arrow.setAttribute("d", "M10 9 0 19h20L10 9Z");
  arrow.setAttribute("fill", "#FEFEFE");

  icon.replaceChildren(line1, line2, arrow);
  return icon;
}

function findQueueOwnerInstance(menuEl: Element): any | null {
  const fiberKey = Reflect.ownKeys(menuEl).find(
    (k) => typeof k === "string" && (k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"))
  );
  let fiber: any = fiberKey ? (menuEl as any)[fiberKey] : null;
  for (let depth = 0; fiber && depth < 48; depth++, fiber = fiber.return) {
    const inst = fiber.stateNode;
    const props = inst?.props;
    if (
      inst &&
      props &&
      Array.isArray(props.characterActions) &&
      typeof props.moveCharacterActionHandler === "function"
    ) {
      return inst;
    }
  }
  return null;
}

function readVerifiedQueueState(menuEl: Element): {
  owner: any;
  currentId: number;
  pendingIds: number[];
} | null {
  const owner = findQueueOwnerInstance(menuEl);
  if (!owner) return null;
  const actions: any[] = owner.props.characterActions;
  if (!Array.isArray(actions) || actions.length < 2) return null;

  const currentId = Number(actions[0]?.id);
  if (!Number.isSafeInteger(currentId) || currentId <= 0) return null;

  const pendingIds = actions
    .slice(1)
    .filter((a) => !a?.partyID)
    .map((a) => Number(a?.id));
  if (pendingIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) return null;

  const rows = Array.from(menuEl.querySelectorAll(ROW_SEL)).filter((r) => r.closest(MENU_SEL) === menuEl);
  const rowIds = rows.map((r) => Number(r.getAttribute("data-action-id")));
  if (rowIds.length !== pendingIds.length || rowIds.some((id, i) => id !== pendingIds[i])) {
    return null;
  }

  return { owner, currentId, pendingIds };
}

export function createQueueNextModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let unregStyle: (() => void) | null = null;
  let unregWs: (() => void) | null = null;
  let pendingLock: {
    targetId: number;
    baselinePending: number[];
    timer: number;
  } | null = null;

  const clearLock = () => {
    if (pendingLock) {
      clearTimeout(pendingLock.timer);
      pendingLock = null;
    }
  };

  const syncMenu = () => {
    if (!ctx) return;
    const menu = document.querySelector(MENU_SEL);
    if (!menu) {
      clearLock();
      return;
    }

    const snapshot = readVerifiedQueueState(menu);
    if (!snapshot) return;

    if (pendingLock) {
      if (
        snapshot.currentId === pendingLock.targetId ||
        !snapshot.pendingIds.includes(pendingLock.targetId) ||
        snapshot.pendingIds[0] === pendingLock.targetId
      ) {
        clearLock();
      }
    }

    const rows = Array.from(menu.querySelectorAll(ROW_SEL)).filter((r) => r.closest(MENU_SEL) === menu);
    rows.forEach((row, index) => {
      const actionId = snapshot.pendingIds[index];
      const topBtn = Array.from(row.querySelectorAll("button")).find(
        (b) => !b.hasAttribute(NEXT_ATTR) && b.querySelector('svg[aria-label="top"]') !== null
      );
      const topIcon = topBtn?.querySelector<SVGElement>('svg[aria-label="top"]');
      if (!topBtn || !topIcon) return;

      let nextBtn = row.querySelector<HTMLButtonElement>(`button[${NEXT_ATTR}]`);
      if (!nextBtn) {
        nextBtn = document.createElement("button");
        nextBtn.type = "button";
        nextBtn.className = topBtn.className;
        nextBtn.setAttribute("data-mwi-lite", "1");
        nextBtn.appendChild(createNextIcon(document, topIcon));
        nextBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (!ev.isTrusted || pendingLock) return;

          const latest = readVerifiedQueueState(menu);
          if (!latest) return;
          const targetIdx = latest.pendingIds.indexOf(actionId);
          if (targetIdx <= 0) return;

          pendingLock = {
            targetId: actionId,
            baselinePending: [...latest.pendingIds],
            timer: window.setTimeout(() => {
              clearLock();
              syncMenu();
            }, 3000),
          };
          syncMenu();

          try {
            Reflect.apply(latest.owner.props.moveCharacterActionHandler, latest.owner, [actionId, 0]);
          } catch {
            clearLock();
            syncMenu();
          }
        });
        topBtn.parentNode?.insertBefore(nextBtn, topBtn.nextSibling);
      }

      nextBtn.setAttribute(NEXT_ATTR, String(actionId));
      const isAlreadyNext = index === 0;
      nextBtn.disabled = isAlreadyNext || pendingLock !== null;
      const tip = isAlreadyNext
        ? ctx!.i18n.t("当前已是下一项动作", "Already next in queue")
        : ctx!.i18n.t("设为下一项（排在当前动作之后）", "Set as Next action");
      nextBtn.title = tip;
      nextBtn.setAttribute("aria-label", tip);
    });
  };

  return {
    id: "planner-queue-next",
    nameZh: "队列设为下一步",
    nameEn: "Queue: Set as Next",
    descriptionZh: "在排队编辑菜单注入「设为下一项」按钮，1:1 安全触发原生移动逻辑不打断当前动作",
    descriptionEn: "Add a 'Set as Next' button in queue edit menu (1:1 human click -> native queue move)",
    category: "planner",
    defaultEnabled: true,

    init(context) {
      ctx = context;
      unregStyle = ctx.addStyle(
        "planner-queue-next",
        `
        [${NEXT_ATTR}] {
          position: relative;
          min-width: 26px;
          border-radius: 0 !important;
          border: 1px solid var(--mwi-px-border, #8eb1ff) !important;
          background: var(--mwi-px-btn-bg, linear-gradient(180deg, #324a8f 0%, #22356b 100%)) !important;
          box-shadow: var(--mwi-px-shadow-btn, 0 0 0 1px #080d1a) !important;
          color: #f8fafc !important;
          font-family: var(--mwi-px-mono, monospace) !important;
          font-weight: 700 !important;
        }
        [${NEXT_ATTR}]:disabled {
          cursor: default;
          opacity: 0.4;
          filter: saturate(0.35);
        }
        `
      );

      unregWs = ctx.wsBus.on("actions_updated", () => syncMenu());

      return () => {
        clearLock();
        unregWs?.();
        unregWs = null;
        unregStyle?.();
        unregStyle = null;
        document.querySelectorAll(`button[${NEXT_ATTR}]`).forEach((b) => b.remove());
      };
    },

    onDom() {
      syncMenu();
    },
  };
}
