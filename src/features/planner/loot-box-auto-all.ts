// Credit: Auto-click "All" when opening loot boxes / using ability books inspired by Toolasha (Celasha, CC-BY-NC-SA-4.0).
//
// When the item action menu of an openable container (crate / chest / cache) or an ability book pops up,
// click the game's own "All" button so the quantity is pre-filled with the full stack. It only fills the
// quantity field — the player still presses "Open" / "Use" (0 server actions, no isTrusted spoofing).
// "Scroll of ..." items (`/items/seal_of_*`, Labyrinth) are skipped.
import type { FeatureModule, KernelContext } from "../../core/types";

const SCROLL_HRID_PREFIX = "/items/seal_of_";
const ABILITY_BOOK_CATEGORY = "/item_categories/ability_book";
// Item action menus render inside MUI poppers / tooltips (same containers Toolasha watches).
const POPPER_SELECTOR = '[class*="MuiPopper"], [class*="MuiTooltip-popper"]';
const ALL_BUTTON_LABELS = new Set(["All", "全部"]);
/** DOM batches to wait for the "All" button to render before giving up on a popper. */
const MAX_ATTEMPTS = 20;

interface PopperState {
  name: string;
  done: boolean;
  attempts: number;
}

export function createLootBoxAutoAllModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let popperState = new WeakMap<Element, PopperState>();
  const hridByName = new Map<string, string | null>();

  const resolveHrid = (context: KernelContext, name: string): string | null => {
    if (hridByName.has(name)) return hridByName.get(name) ?? null;
    const hrid = context.i18n.getItemHridByName(name);
    // Only cache hits; a miss may just mean client data / translations aren't loaded yet.
    if (hrid) hridByName.set(name, hrid);
    return hrid;
  };

  const findAllButton = (popper: Element): HTMLButtonElement | null => {
    const buttons = popper.querySelectorAll<HTMLButtonElement>("button");
    for (const btn of buttons) {
      if (!btn.disabled && ALL_BUTTON_LABELS.has((btn.textContent || "").trim())) return btn;
    }
    return null;
  };

  const scan = () => {
    const context = ctx;
    if (!context) return;
    const poppers = document.querySelectorAll(POPPER_SELECTOR);
    if (poppers.length === 0) return;
    const itemDetailMap = context.gameData.getClientData()?.itemDetailMap;
    if (!itemDetailMap) return;

    for (const popper of poppers) {
      const name = (popper.querySelector('[class*="Item_name"]')?.textContent || "").trim();
      if (!name) continue;

      let state = popperState.get(popper);
      if (!state || state.name !== name) {
        // New popper, or MUI reused the node for another item.
        state = { name, done: false, attempts: 0 };
        popperState.set(popper, state);
      }
      if (state.done) continue;

      const hrid = resolveHrid(context, name);
      const detail = hrid ? itemDetailMap[hrid] : null;
      const eligible = Boolean(detail?.isOpenable) || detail?.categoryHrid === ABILITY_BOOK_CATEGORY;
      if (!hrid || !eligible || hrid.startsWith(SCROLL_HRID_PREFIX)) {
        state.done = true;
        continue;
      }

      const btn = findAllButton(popper);
      if (btn) {
        state.done = true;
        btn.click();
      } else if (++state.attempts >= MAX_ATTEMPTS) {
        state.done = true;
      }
    }
  };

  return {
    id: "planner-loot-box-auto-all",
    nameZh: "开箱/技能书自动全部",
    nameEn: "Loot Box & Skill Book Auto \"All\"",
    descriptionZh: "开启战利品箱或使用技能书时自动点击“全部”按钮预填数量（跳过“卷轴”类物品）",
    descriptionEn:
      "Auto-click the \"All\" button when opening loot boxes or using skill books to pre-fill the quantity (skips \"Scroll of...\" items)",
    category: "planner",
    defaultEnabled: true,

    init(context) {
      ctx = context;
      popperState = new WeakMap();
      return () => {
        ctx = null;
        popperState = new WeakMap();
        hridByName.clear();
      };
    },

    onDom() {
      scan();
    },
  };
}
