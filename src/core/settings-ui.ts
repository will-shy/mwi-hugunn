import { domScheduler } from "./dom-scheduler";
import { i18n } from "./i18n";
import { registry } from "./registry";
import { addStyle } from "./storage";
import type { FeatureCategory } from "./types";

declare const GM_registerMenuCommand: ((name: string, fn: () => void) => void) | undefined;

const SETTINGS_BTN_ID = "mwi-lite-settings-btn";
const SETTINGS_MODAL_ID = "mwi-lite-settings-modal";

const CATEGORY_LABELS: Record<FeatureCategory, [string, string]> = {
  market: ["市场与经济", "Market & Economy"],
  planner: ["规划与队列", "Planner & Queue"],
  combat: ["战斗与迷宫", "Combat & Labyrinth"],
};

export function mountSettingsUI(isWorkerActiveFn: () => boolean): void {
  addStyle(
    "settings-ui",
    `
    #${SETTINGS_BTN_ID} {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: 8px;
      padding: 3px 9px;
      border-radius: 6px;
      border: 1px solid rgba(114, 179, 255, 0.35);
      background: rgba(24, 34, 56, 0.9);
      color: #a8d4ff;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
      line-height: 1.4;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    #${SETTINGS_BTN_ID}:hover {
      background: rgba(38, 56, 92, 0.95);
      border-color: rgba(114, 179, 255, 0.7);
    }
    #${SETTINGS_BTN_ID}.mwi-lite-floating {
      position: fixed;
      right: 14px;
      bottom: 14px;
      z-index: 9500;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
    }
    #${SETTINGS_MODAL_ID} {
      position: fixed;
      inset: 0;
      z-index: 9900;
      background: rgba(7, 10, 18, 0.72);
      display: none;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, sans-serif;
    }
    #${SETTINGS_MODAL_ID}.open {
      display: flex;
    }
    #${SETTINGS_MODAL_ID} .mwi-lite-card {
      width: min(640px, 92vw);
      max-height: 82vh;
      display: flex;
      flex-direction: column;
      background: #131826;
      color: #e6ecf7;
      border: 1px solid #2b3856;
      border-radius: 12px;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.65);
      overflow: hidden;
    }
    #${SETTINGS_MODAL_ID} .mwi-lite-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px;
      border-bottom: 1px solid #232d45;
      background: #171e30;
    }
    #${SETTINGS_MODAL_ID} .mwi-lite-title {
      font-size: 16px;
      font-weight: 700;
      color: #ffffff;
    }
    #${SETTINGS_MODAL_ID} .mwi-lite-status {
      font-size: 12px;
      color: #93a7cb;
      margin-top: 2px;
    }
    #${SETTINGS_MODAL_ID} .mwi-lite-close {
      background: transparent;
      border: 1px solid #334263;
      color: #c2cee5;
      border-radius: 6px;
      padding: 4px 10px;
      cursor: pointer;
      font-size: 13px;
    }
    #${SETTINGS_MODAL_ID} .mwi-lite-body {
      padding: 14px 18px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    #${SETTINGS_MODAL_ID} .mwi-lite-group-title {
      font-size: 13px;
      font-weight: 700;
      color: #7cc0ff;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    #${SETTINGS_MODAL_ID} .mwi-lite-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 9px 12px;
      border-radius: 8px;
      background: #1a2235;
      border: 1px solid #25304a;
      margin-bottom: 6px;
    }
    #${SETTINGS_MODAL_ID} .mwi-lite-row-name {
      font-size: 13px;
      font-weight: 600;
      color: #eef3fc;
    }
    #${SETTINGS_MODAL_ID} .mwi-lite-row-desc {
      font-size: 11.5px;
      color: #93a5c7;
      margin-top: 2px;
    }
    #${SETTINGS_MODAL_ID} input[type="checkbox"] {
      width: 17px;
      height: 17px;
      accent-color: #4f9cff;
      cursor: pointer;
      flex-shrink: 0;
    }
    `
  );

  const renderModal = (): HTMLElement => {
    let modal = document.getElementById(SETTINGS_MODAL_ID);
    if (!modal) {
      modal = document.createElement("div");
      modal.id = SETTINGS_MODAL_ID;
      modal.setAttribute("data-mwi-lite", "1");
      modal.addEventListener("click", (ev) => {
        if (ev.target === modal) modal?.classList.remove("open");
      });
      document.body.appendChild(modal);
    }

    const items = registry.list();
    const enabledCount = items.filter((i) => i.enabled).length;
    const workerTxt = isWorkerActiveFn()
      ? i18n.t("迷宫 Worker 运行中 (1 线程)", "Labyrinth Worker Active (1 thread)")
      : i18n.t("迷宫 Worker 休眠 (0 线程)", "Labyrinth Worker Idle (0 threads)");

    const groups: FeatureCategory[] = ["market", "planner", "combat"];
    const groupsHtml = groups
      .map((cat) => {
        const list = items.filter((x) => x.module.category === cat);
        if (!list.length) return "";
        const [zhCat, enCat] = CATEGORY_LABELS[cat];
        const rowsHtml = list
          .map(({ module, enabled }) => {
            const name = i18n.t(module.nameZh, module.nameEn);
            const desc = i18n.t(module.descriptionZh, module.descriptionEn);
            return `
              <label class="mwi-lite-row">
                <div>
                  <div class="mwi-lite-row-name">${name}</div>
                  <div class="mwi-lite-row-desc">${desc}</div>
                </div>
                <input type="checkbox" data-mwi-lite-toggle="${module.id}" ${enabled ? "checked" : ""} />
              </label>
            `;
          })
          .join("");
        return `<div><div class="mwi-lite-group-title">${i18n.t(zhCat, enCat)}</div>${rowsHtml}</div>`;
      })
      .join("");

    modal.innerHTML = `
      <div class="mwi-lite-card">
        <div class="mwi-lite-header">
          <div>
            <div class="mwi-lite-title">🪶 MWI · Hugunn v1.1.0</div>
            <div class="mwi-lite-status">
              ${i18n.t(`已启用 ${enabledCount}/${items.length} 模块`, `${enabledCount}/${items.length} modules enabled`)}
              · ${i18n.t("当前路由", "Route")}: <b>${domScheduler.getActiveRoute()}</b>
              · ${workerTxt}
            </div>
          </div>
          <button type="button" class="mwi-lite-close">${i18n.t("关闭", "Close")}</button>
        </div>
        <div class="mwi-lite-body">${groupsHtml}</div>
      </div>
    `;

    modal.querySelector(".mwi-lite-close")?.addEventListener("click", () => {
      modal?.classList.remove("open");
    });

    modal.querySelectorAll<HTMLInputElement>("input[data-mwi-lite-toggle]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const id = cb.getAttribute("data-mwi-lite-toggle");
        if (id) {
          registry.setEnabled(id, cb.checked);
          renderModal();
        }
      });
    });

    return modal;
  };

  const openSettings = () => {
    const modal = renderModal();
    modal.classList.add("open");
  };

  if (typeof GM_registerMenuCommand === "function") {
    try {
      GM_registerMenuCommand("🪶 MWI · Hugunn 设置 / Settings", openSettings);
    } catch {
      // Ignore
    }
  }

  const ensureButton = () => {
    if (!document.body) return;
    let btn = document.getElementById(SETTINGS_BTN_ID) as HTMLButtonElement | null;
    const headerTarget =
      document.querySelector('[class*="Header_totalLevel"]') ||
      document.querySelector('[class*="Header_info"]') ||
      document.querySelector('[class*="Header_header"]');

    if (!btn) {
      btn = document.createElement("button");
      btn.id = SETTINGS_BTN_ID;
      btn.type = "button";
      btn.setAttribute("data-mwi-lite", "1");
      btn.textContent = "🪶 Hugunn";
      btn.title = i18n.t("打开 MWI · Hugunn 设置", "Open MWI · Hugunn Settings");
      btn.addEventListener("click", openSettings);
    }

    if (headerTarget && headerTarget.parentElement) {
      btn.classList.remove("mwi-lite-floating");
      if (btn.parentElement !== headerTarget.parentElement) {
        headerTarget.parentElement.insertBefore(btn, headerTarget.nextSibling);
      }
    } else if (!btn.isConnected) {
      btn.classList.add("mwi-lite-floating");
      document.body.appendChild(btn);
    }
  };

  domScheduler.registerDomHandler("core-settings-btn", undefined, () => {
    ensureButton();
  });
}
