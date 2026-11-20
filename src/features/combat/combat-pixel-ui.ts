import type { I18nAPI } from "../../core/types";
import {
  formatBattleDuration,
  formatCombatPrice,
  formatLuckPercent,
  getLuckColor,
  getRarityColor,
  type CombatPriceMode,
  type PlayerBattleAnalysis,
} from "./combat-luck-engine";

export interface CombatHistoryViewEntry {
  key: string;
  characterId: number | string;
  playerName: string;
  mapHrid: string;
  mapName: string;
  difficultyTier: number;
  startTime: number;
  durationSec: number;
  runCount: number;
  eph: number;
  income: number;
  dailyIncome: number;
  dailyProfit: number;
  luck: number | null;
  priceMode: CombatPriceMode;
}

export const PIXEL_SWORD_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true" style="vertical-align:-3px;flex-shrink:0"><rect x="11" y="1" width="3" height="2" fill="#e2e8f0"/><rect x="9" y="3" width="3" height="2" fill="#cbd5e1"/><rect x="7" y="5" width="3" height="2" fill="#cbd5e1"/><rect x="5" y="7" width="3" height="2" fill="#94a3b8"/><rect x="3" y="8" width="2" height="2" fill="#facc15"/><rect x="5" y="10" width="2" height="2" fill="#facc15"/><rect x="2" y="11" width="2" height="2" fill="#a16207"/><rect x="1" y="12" width="2" height="2" fill="#78350f"/><rect x="2" y="1" width="3" height="2" fill="#cbd5e1"/><rect x="4" y="3" width="3" height="2" fill="#94a3b8"/><rect x="9" y="9" width="2" height="2" fill="#facc15"/><rect x="11" y="11" width="2" height="2" fill="#a16207"/><rect x="12" y="12" width="2" height="2" fill="#78350f"/></svg>`;

export const PIXEL_BAR_ICON_SVG = `<svg width="12" height="12" viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true" style="vertical-align:-1px"><rect x="1" y="6" width="2" height="5" fill="#60a5fa"/><rect x="5" y="3" width="2" height="8" fill="#4ade80"/><rect x="9" y="1" width="2" height="10" fill="#facc15"/></svg>`;

const PIXEL_SKULL_SVG = `<svg width="14" height="14" viewBox="0 0 14 14" shape-rendering="crispEdges" aria-hidden="true" style="vertical-align:-2px"><rect x="4" y="1" width="6" height="2" fill="#f8fafc"/><rect x="2" y="3" width="10" height="5" fill="#f8fafc"/><rect x="4" y="5" width="2" height="2" fill="#0f172a"/><rect x="8" y="5" width="2" height="2" fill="#0f172a"/><rect x="3" y="8" width="8" height="2" fill="#cbd5e1"/><rect x="4" y="10" width="2" height="2" fill="#f8fafc"/><rect x="8" y="10" width="2" height="2" fill="#f8fafc"/></svg>`;

const PIXEL_CHEST_SVG = `<svg width="24" height="24" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true" style="flex-shrink:0"><rect x="1" y="3" width="14" height="10" fill="#1e120a"/><rect x="2" y="4" width="12" height="3" fill="#b45309"/><rect x="2" y="4" width="12" height="1" fill="#fbbf24"/><rect x="2" y="7" width="12" height="1" fill="#f59e0b"/><rect x="2" y="8" width="12" height="4" fill="#92400e"/><rect x="2" y="4" width="2" height="8" fill="#f59e0b"/><rect x="12" y="4" width="2" height="8" fill="#f59e0b"/><rect x="7" y="6" width="2" height="3" fill="#fef08a"/><rect x="7" y="8" width="2" height="1" fill="#ca8a04"/></svg>`;

function pixelGemSvg(color: string): string {
  return `<svg width="20" height="20" viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true" style="flex-shrink:0"><rect x="4" y="1" width="4" height="2" fill="#ffffff" fill-opacity="0.45"/><rect x="2" y="3" width="8" height="6" fill="${color}"/><rect x="3" y="3" width="2" height="2" fill="#ffffff" fill-opacity="0.6"/><rect x="4" y="9" width="4" height="2" fill="${color}"/></svg>`;
}

export function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function getCombatPixelStyles(ids: {
  counterId: string;
  lootBarId: string;
  modalId: string;
}): string {
  const { counterId, lootBarId, modalId } = ids;
  return `
    #${counterId} {
      color: #dbeafe;
      margin-left: 6px;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: nowrap;
    }

    /* Option A: 16-bit SNES Starlight Pixel HUD Bar */
    #${lootBarId} {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 6px 10px;
      padding: 6px 10px;
      margin: 5px 2px 7px;
      border-radius: 0;
      background: linear-gradient(180deg, #17244d 0%, #0e1634 100%);
      border: 2px solid #9dbbff;
      box-shadow:
        0 0 0 2px #070b16,
        inset 0 0 0 2px #293e7a,
        inset 0 1px 0 2px #5273c7;
      color: #e2e8f0;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      line-height: 1.4;
      font-variant-numeric: tabular-nums;
    }
    #${lootBarId} .mwi-combat-bar-metrics {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 3px 5px;
    }
    #${lootBarId} .mwi-combat-dot { color: #5b72b4; font-weight: 700; }
    #${lootBarId} .mwi-combat-bar-actions { display: inline-flex; align-items: center; gap: 6px; }
    #${lootBarId} .mwi-combat-bar-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 0;
      border: 1px solid #8eb1ff;
      background: linear-gradient(180deg, #324a8f 0%, #22356b 100%);
      box-shadow:
        0 0 0 1px #080d1a,
        inset 1px 1px 0 #7096ee,
        inset -1px -1px 0 #152147;
      color: #f8fafc;
      font-size: 11px;
      font-weight: 700;
      font-family: inherit;
      cursor: pointer;
      line-height: 1.2;
    }
    #${lootBarId} .mwi-combat-bar-btn:hover {
      background: linear-gradient(180deg, #405eb3 0%, #2b4385 100%);
      color: #ffffff;
    }
    #${lootBarId} .mwi-combat-bar-btn:active {
      transform: translateY(1px);
    }

    /* Option A: 16-bit SNES Starlight RPG Modal */
    #${modalId} {
      position: fixed;
      inset: 0;
      z-index: 9910;
      background: rgba(5, 8, 18, 0.78);
      display: none;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    #${modalId}.open { display: flex; }
    #${modalId} * { box-sizing: border-box; }
    #${modalId} .mwi-combat-card {
      width: min(760px, 94vw);
      max-height: 86vh;
      display: flex;
      flex-direction: column;
      border-radius: 0;
      background: linear-gradient(180deg, #121c3b 0%, #0c1228 100%);
      color: #edf2ff;
      border: 2px solid #d5e5ff;
      box-shadow:
        0 0 0 2px #060913,
        0 18px 44px rgba(0, 0, 0, 0.78),
        inset 0 0 0 2px #1c2b59,
        inset 0 0 0 4px #4f6fc4;
      overflow: hidden;
      font-variant-numeric: tabular-nums;
    }
    #${modalId} .mwi-combat-card.is-solo { width: min(740px, 94vw); }
    #${modalId} .mwi-combat-card.is-party { width: min(940px, 95vw); }

    #${modalId} .mwi-combat-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 14px;
      background: linear-gradient(180deg, #1d2c5e 0%, #141f46 100%);
      border-bottom: 2px solid #4f6fc4;
    }
    #${modalId} .mwi-combat-title-wrap {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 800;
    }
    #${modalId} .mwi-combat-map-name {
      color: #ffffff;
      text-shadow: 2px 2px 0 #090e1f;
      letter-spacing: 0.3px;
    }
    #${modalId} .mwi-combat-badge {
      padding: 1px 6px;
      border-radius: 0;
      background: #1b2852;
      border: 1px solid #facc15;
      box-shadow: 0 0 0 1px #080c18;
      color: #fde047;
      font-size: 11px;
      font-weight: 800;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    #${modalId} .mwi-combat-meta {
      font-weight: 600;
      font-size: 12px;
      color: #7dd3fc;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    #${modalId} .mwi-combat-header-actions {
      display: flex;
      align-items: center;
      gap: 7px;
      flex-shrink: 0;
    }
    #${modalId} .mwi-combat-hbtn {
      padding: 4px 10px;
      border-radius: 0;
      border: 1px solid #8eb1ff;
      background: linear-gradient(180deg, #324a8f 0%, #22356b 100%);
      box-shadow:
        0 0 0 1px #070b16,
        inset 1px 1px 0 #7397ec,
        inset -1px -1px 0 #162247;
      color: #f8fafc;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    #${modalId} .mwi-combat-hbtn:hover {
      background: linear-gradient(180deg, #4260b8 0%, #2d4487 100%);
    }
    #${modalId} .mwi-combat-hbtn:active,
    #${modalId} .mwi-combat-close:active {
      transform: translateY(1px);
    }
    #${modalId} .mwi-combat-close {
      width: 26px;
      height: 26px;
      border-radius: 0;
      border: 1px solid #fca5a5;
      background: linear-gradient(180deg, #c23b3b 0%, #8f2222 100%);
      box-shadow:
        0 0 0 1px #070b16,
        inset 1px 1px 0 #f87171,
        inset -1px -1px 0 #5b1212;
      color: #ffffff;
      font-size: 15px;
      font-weight: 800;
      line-height: 1;
      cursor: pointer;
    }
    #${modalId} .mwi-combat-close:hover {
      background: linear-gradient(180deg, #dc4c4c 0%, #a52929 100%);
    }

    /* Pixel Folder Tabs */
    #${modalId} .mwi-combat-tabs {
      display: flex;
      gap: 6px;
      padding: 8px 14px 0;
      background: #0d142c;
      border-bottom: 2px solid #5878cc;
    }
    #${modalId} .mwi-combat-tab {
      padding: 6px 14px;
      border-radius: 0;
      clip-path: polygon(0 4px, 4px 0, calc(100% - 4px) 0, 100% 4px, 100% 100%, 0 100%);
      border: 1px solid #3c528f;
      border-bottom: none;
      background: linear-gradient(180deg, #25335e 0%, #1a2444 100%);
      color: #9fb4e8;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    #${modalId} .mwi-combat-tab:hover { color: #ffffff; }
    #${modalId} .mwi-combat-tab.active {
      background: linear-gradient(180deg, #5273d1 0%, #3854a8 100%);
      border-color: #c2d6ff;
      color: #ffffff;
      text-shadow: 1px 1px 0 #16244f;
      box-shadow: inset 0 2px 0 #9fc0ff;
    }

    #${modalId} .mwi-combat-body {
      padding: 14px;
      overflow-y: auto;
      font-size: 12px;
    }

    /* Solo 2-Column Layout (Option A Hero + Side Cards) */
    #${modalId} .mwi-pixel-solo-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.44fr) minmax(0, 1fr);
      gap: 12px;
      align-items: start;
    }
    @media (max-width: 600px) {
      #${modalId} .mwi-pixel-solo-grid { grid-template-columns: 1fr; }
    }
    #${modalId} .mwi-pixel-box {
      background: linear-gradient(180deg, #141f42 0%, #0f1733 100%);
      border: 2px solid #b9d1ff;
      box-shadow:
        0 0 0 2px #070b16,
        inset 0 0 0 2px #2c417d;
      padding: 10px 12px;
    }
    #${modalId} .mwi-pixel-gold-card {
      background: linear-gradient(180deg, #6b480e 0%, #422b07 100%);
      border: 2px solid #fbbf24;
      box-shadow:
        0 0 0 2px #070b16,
        inset 0 0 0 2px #926111;
      padding: 8px 11px;
    }
    #${modalId} .mwi-pixel-side-col {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    #${modalId} .mwi-combat-player-title {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding-bottom: 7px;
      margin-bottom: 8px;
      border-bottom: 2px solid #2b3f77;
      font-size: 14px;
      font-weight: 800;
      color: #ffffff;
    }
    #${modalId} .mwi-combat-player-left {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    #${modalId} .mwi-combat-aura {
      font-size: 11px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 0;
      background: #5b21b6;
      border: 1px solid #c4b5fd;
      box-shadow: 0 0 0 1px #070b16;
      color: #f3e8ff;
    }
    #${modalId} .mwi-combat-death {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 13px;
      font-weight: 800;
      color: #f8fafc;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    /* Emerald Diagonal-Stripe Pixel Luck Gauge */
    #${modalId} .mwi-pixel-luck-box { margin-bottom: 9px; }
    #${modalId} .mwi-pixel-luck-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 5px;
      font-size: 13px;
      font-weight: 800;
    }
    #${modalId} .mwi-pixel-luck-track {
      height: 17px;
      width: 100%;
      background: #0a1022;
      border: 2px solid #050811;
      box-shadow: inset 0 0 0 1px #39508c;
      padding: 2px;
      overflow: hidden;
    }
    #${modalId} .mwi-pixel-luck-fill {
      height: 100%;
      transition: width 0.2s steps(12, end);
      box-shadow:
        inset 0 2px 0 rgba(255, 255, 255, 0.35),
        inset 0 -2px 0 rgba(0, 0, 0, 0.25);
    }

    /* Solo Financial Stat Rows */
    #${modalId} .mwi-pixel-stat-rows {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    #${modalId} .mwi-pixel-stat-row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 3px 6px;
      padding: 6px 8px;
      background: #101937;
      border: 1px solid #2e437f;
      box-shadow: inset 0 1px 0 #1d2d5e;
      font-size: 11.5px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    #${modalId} .mwi-pixel-stat-main {
      display: inline-flex;
      align-items: baseline;
      gap: 6px;
      font-weight: 800;
    }
    #${modalId} .mwi-pixel-stat-lbl { color: #cbd5e1; font-weight: 700; }
    #${modalId} .mwi-pixel-stat-sub { font-size: 11px; color: #94a3b8; }

    /* Gold XP Box Rows */
    #${modalId} .mwi-pixel-gold-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 5px 0;
      font-size: 12px;
      font-weight: 700;
      color: #fef3c7;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    #${modalId} .mwi-pixel-gold-row + .mwi-pixel-gold-row {
      border-top: 1px solid rgba(251, 191, 36, 0.3);
    }
    #${modalId} .mwi-pixel-gold-val {
      color: #fde047;
      font-weight: 800;
      text-shadow: 1px 1px 0 #2b1a04;
    }

    /* Loot Box Rows */
    #${modalId} .mwi-pixel-loot-featured {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 8px;
      background: #0f1733;
      border: 1px solid #354c8f;
    }
    #${modalId} .mwi-pixel-loot-featured + .mwi-pixel-loot-featured { margin-top: 6px; }
    #${modalId} .mwi-pixel-loot-fmeta {
      flex: 1;
      min-width: 0;
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    /* Party Multi-Card Grid */
    #${modalId} .mwi-combat-cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 12px;
    }
    #${modalId} .mwi-combat-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    #${modalId} .mwi-combat-table td { padding: 2px 0; }
    #${modalId} .mwi-combat-table td:last-child { text-align: right; }
    #${modalId} .mwi-combat-row-gap td { height: 4px; }
    #${modalId} .mwi-combat-sep { height: 2px; background: #2b3f77; margin: 6px 0; }
    #${modalId} .mwi-combat-drops-list {
      margin-top: 8px;
      padding-top: 6px;
      border-top: 2px solid #2b3f77;
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    #${modalId} .mwi-combat-drop-row { display: flex; justify-content: space-between; gap: 6px; font-size: 12px; }
    #${modalId} .mwi-combat-drop-cnt { color: #e2e8f0; min-width: 34px; font-weight: 700; }
    #${modalId} .mwi-combat-drop-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #${modalId} .mwi-combat-drop-val { color: #cbd5e1; font-weight: 700; }

    /* Details & History Pixel Tables */
    #${modalId} .mwi-combat-player-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    #${modalId} .mwi-combat-pill {
      padding: 4px 10px;
      border-radius: 0;
      border: 1px solid #6b8ee0;
      background: #1b2852;
      box-shadow: 0 0 0 1px #070b16;
      color: #cbd5e1;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    #${modalId} .mwi-combat-pill.active {
      background: linear-gradient(180deg, #4b6fd1 0%, #3450a3 100%);
      border-color: #d5e5ff;
      color: #ffffff;
    }
    #${modalId} .mwi-combat-section-title {
      font-size: 13px;
      font-weight: 800;
      margin: 10px 0 6px;
      color: #dbeafe;
      text-shadow: 1px 1px 0 #070b16;
    }
    #${modalId} .mwi-combat-table-wrap {
      overflow-x: auto;
      border: 2px solid #6f90e0;
      box-shadow: 0 0 0 2px #070b16;
      background: #0f1733;
    }
    #${modalId} .mwi-combat-detail-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    #${modalId} .mwi-combat-detail-table th,
    #${modalId} .mwi-combat-detail-table td {
      padding: 6px 9px;
      border-bottom: 1px solid #223160;
      text-align: left;
      white-space: nowrap;
    }
    #${modalId} .mwi-combat-detail-table th {
      background: #1a2752;
      color: #bae6fd;
      font-weight: 800;
      border-bottom: 2px solid #4865b8;
    }
    #${modalId} .mwi-combat-detail-table tbody tr:hover {
      background: rgba(82, 115, 209, 0.14);
    }
    #${modalId} .mwi-combat-history-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      color: #cbd5e1;
      font-weight: 600;
    }
    #${modalId} .mwi-combat-empty,
    #${modalId} .mwi-combat-empty-sm {
      color: #94a3b8;
      text-align: center;
      padding: 16px 8px;
    }
    #${modalId} .mwi-combat-empty-sm { padding: 6px 0; }
  `;
}

export function renderLootBarState(params: {
  primary: PlayerBattleAnalysis;
  priceMode: CombatPriceMode;
  i18n: I18nAPI;
}): { signature: string; metricsHtml: string; priceLabel: string; detailsLabel: string } {
  const { primary, priceMode, i18n } = params;
  const isZh = i18n.isZh();
  const priceLabel = priceMode === "bid_net" ? (isZh ? "Bid净" : "Bid Net") : "Ask";
  const detailsLabel = isZh ? "详情" : "Details";

  const dur = formatBattleDuration(primary.durationSec);
  const ephText =
    primary.completedRuns > 0
      ? `${primary.eph.toFixed(1)} ${isZh ? "场/h" : "EPH"} (${dur})`
      : `#${primary.runCount} (${dur})`;
  const incLabel = isZh ? "收益" : "Loot";
  const incVal = `${formatCombatPrice(primary.currentIncome)} (${formatCombatPrice(primary.dailyIncome)}/d)`;
  const expText =
    primary.hasMapModel && primary.completedRuns > 0
      ? `${isZh ? "期望" : "Exp"} ${formatCombatPrice(primary.dailyExpectation)}/d`
      : "";
  const profitText = `${isZh ? "净利" : "Profit"} ≥${formatCombatPrice(primary.dailyProfit)}/d`;
  const luckText = primary.luck !== null ? `${isZh ? "运气" : "Luck"} ${formatLuckPercent(primary.luck)}` : "";
  const topSkillName = primary.topSkillHrid ? i18n.getSkillName(primary.topSkillHrid) : isZh ? "经验" : "XP";
  const xpText = `${topSkillName} ${formatCombatPrice(primary.topSkillXpPerHour)}/h`;
  const xpTooltip = primary.skillExpEntries
    .map((e) => `${i18n.getSkillName(e.skillHrid)}: ${formatCombatPrice(e.xp)} (${formatCombatPrice(e.xpPerHour)}/h)`)
    .join("\n");

  const signature = [ephText, incVal, expText, profitText, luckText, xpText, priceLabel, isZh].join("|");

  const parts: string[] = [
    `<span style="display:inline-flex;align-items:center;gap:5px">${PIXEL_SWORD_SVG}<strong style="color:#f8fafc">${escapeHtml(ephText)}</strong></span>`,
    `<span>${escapeHtml(incLabel)} <strong style="color:#facc15">${escapeHtml(incVal)}</strong></span>`,
  ];
  if (expText) {
    parts.push(`<span style="color:#7dd3fc">${escapeHtml(expText)}</span>`);
  }
  parts.push(`<span style="color:#4ade80">${escapeHtml(profitText)}</span>`);
  if (luckText) {
    parts.push(`<strong style="color:${primary.luckColor}">${escapeHtml(luckText)}</strong>`);
  }
  parts.push(`<strong title="${escapeHtml(xpTooltip)}" style="color:#fbbf24">${escapeHtml(xpText)}</strong>`);

  return {
    signature,
    metricsHtml: parts.join(`<span class="mwi-combat-dot">·</span>`),
    priceLabel,
    detailsLabel,
  };
}

function luckFillStyle(pct: number, color: string): string {
  return `width:${pct.toFixed(1)}%;background:${color};background-image:repeating-linear-gradient(-45deg,rgba(255,255,255,0.24) 0 6px,rgba(0,0,0,0.12) 6px 12px);`;
}

function renderSoloOverview(params: {
  stat: PlayerBattleAnalysis;
  i18n: I18nAPI;
}): string {
  const { stat, i18n } = params;
  const isZh = i18n.isZh();
  const luckStr = formatLuckPercent(stat.luck);
  const luckPct = stat.luck !== null ? Math.min(100, Math.max(0, stat.luck * 100)) : 0;
  const skillName = stat.topSkillHrid ? i18n.getSkillName(stat.topSkillHrid) : isZh ? "战斗" : "Combat";
  const auraBadge = stat.aura
    ? `<span class="mwi-combat-aura">${escapeHtml(i18n.getName(stat.aura, "abilityNames") || stat.aura.replace("/abilities/", ""))}</span>`
    : "";
  const xpTooltip = stat.skillExpEntries
    .map((e) => `${i18n.getSkillName(e.skillHrid)}: ${formatCombatPrice(e.xp)} (${formatCombatPrice(e.xpPerHour)}/h)`)
    .join("\n");

  const avgZ = stat.stddev > 0 ? (stat.currentIncome - stat.expectation) / stat.stddev : 0;
  const subColor = stat.hasMapModel ? (avgZ >= 0 ? "#a7f3d0" : "#fecaca") : "#94a3b8";

  const topDrops = [...stat.lootItems]
    .sort((a, b) => b.unitPrice - a.unitPrice || b.totalPrice - a.totalPrice)
    .slice(0, 10);

  let dropsBody = "";
  if (topDrops.length === 0) {
    dropsBody = `<div class="mwi-combat-empty-sm">${escapeHtml(isZh ? "尚无掉落" : "No loot yet")}</div>`;
  } else if (topDrops.length <= 3) {
    dropsBody = topDrops
      .map((d) => {
        const name = i18n.getItemName(d.itemHrid) + (d.enhancementLevel > 0 ? ` +${d.enhancementLevel}` : "");
        const color = getRarityColor(d.rarity);
        const icon = d.itemHrid.includes("_chest") ? PIXEL_CHEST_SVG : pixelGemSvg(color);
        return `
          <div class="mwi-pixel-loot-featured">
            ${icon}
            <div class="mwi-pixel-loot-fmeta">
              <span style="color:${color};font-weight:700">${escapeHtml(formatCombatPrice(d.count))} ${escapeHtml(name)}</span>
              <strong style="color:#f8fafc">${escapeHtml(formatCombatPrice(d.totalPrice))}</strong>
            </div>
          </div>
        `;
      })
      .join("");
  } else {
    dropsBody = `<div class="mwi-combat-drops-list" style="margin-top:0;padding-top:0;border-top:none">${topDrops
      .map((d) => {
        const name = i18n.getItemName(d.itemHrid) + (d.enhancementLevel > 0 ? ` +${d.enhancementLevel}` : "");
        return `
          <div class="mwi-combat-drop-row">
            <span class="mwi-combat-drop-cnt">${escapeHtml(formatCombatPrice(d.count))}</span>
            <span class="mwi-combat-drop-name" style="color:${getRarityColor(d.rarity)}">${escapeHtml(name)}</span>
            <span class="mwi-combat-drop-val">${escapeHtml(formatCombatPrice(d.totalPrice))}</span>
          </div>
        `;
      })
      .join("")}</div>`;
  }

  return `
    <div class="mwi-pixel-solo-grid">
      <div class="mwi-pixel-box">
        <div class="mwi-combat-player-title">
          <span class="mwi-combat-player-left">
            <span>${escapeHtml(stat.name)}</span>
            ${auraBadge}
          </span>
          ${stat.deathCount > 0 ? `<span class="mwi-combat-death">${PIXEL_SKULL_SVG}${stat.deathCount}</span>` : ""}
        </div>

        <div class="mwi-pixel-luck-box">
          <div class="mwi-pixel-luck-header">
            <span>${escapeHtml(isZh ? "当前运气" : "Luck")}</span>
            <span style="color:${stat.luckColor}">${escapeHtml(luckStr)}</span>
          </div>
          <div class="mwi-pixel-luck-track">
            <div class="mwi-pixel-luck-fill" style="${luckFillStyle(luckPct, stat.luckColor)}"></div>
          </div>
        </div>

        <div class="mwi-pixel-stat-rows">
          <div class="mwi-pixel-stat-row">
            <span class="mwi-pixel-stat-main">
              <span class="mwi-pixel-stat-lbl">${escapeHtml(isZh ? "当前收入:" : "Income:")}</span>
              <strong style="color:${stat.luckColor}">${escapeHtml(formatCombatPrice(stat.currentIncome))}</strong>
            </span>
            <span class="mwi-pixel-stat-sub" style="color:${subColor}">(${escapeHtml(isZh ? "期望" : "Mean")} ${escapeHtml(
              stat.hasMapModel ? formatCombatPrice(stat.expectation) : "--"
            )} / ${escapeHtml(isZh ? "标准差" : "σ")} ${escapeHtml(stat.hasMapModel ? formatCombatPrice(stat.stddev) : "--")})</span>
          </div>

          <div class="mwi-pixel-stat-row">
            <span class="mwi-pixel-stat-main">
              <span class="mwi-pixel-stat-lbl">${escapeHtml(isZh ? "每日收入:" : "Daily:")}</span>
              <strong style="color:${stat.luckColor}">${escapeHtml(formatCombatPrice(stat.dailyIncome))}/d</strong>
            </span>
            <span class="mwi-pixel-stat-sub" style="color:${subColor}">(${escapeHtml(isZh ? "期望" : "Mean")} ${escapeHtml(
              stat.hasMapModel ? `${formatCombatPrice(stat.dailyExpectation)}/d` : "--"
            )} / ${escapeHtml(isZh ? "标准差" : "σ")} ${escapeHtml(
              stat.hasMapModel ? `${formatCombatPrice(stat.dailyStddev)}/d` : "--"
            )})</span>
          </div>

          <div class="mwi-pixel-stat-row">
            <span class="mwi-pixel-stat-main">
              <span class="mwi-pixel-stat-lbl">${escapeHtml(isZh ? "每日净利:" : "Profit:")}</span>
              <strong style="color:${stat.luckColor}">≥${escapeHtml(formatCombatPrice(stat.dailyProfit))}/d</strong>
            </span>
            <span class="mwi-pixel-stat-sub" style="color:${subColor}">(${escapeHtml(isZh ? "期望" : "Mean")} ${escapeHtml(
              stat.hasMapModel ? `≥${formatCombatPrice(stat.dailyProfitExpectation)}/d` : "--"
            )})</span>
          </div>
        </div>
      </div>

      <div class="mwi-pixel-side-col">
        <div class="mwi-pixel-gold-card" title="${escapeHtml(xpTooltip)}">
          <div class="mwi-pixel-gold-row">
            <span>${escapeHtml(skillName + (isZh ? "经验" : " XP"))}</span>
            <span class="mwi-pixel-gold-val">${escapeHtml(formatCombatPrice(stat.topSkillXpPerHour))}/h</span>
          </div>
          <div class="mwi-pixel-gold-row">
            <span>${escapeHtml(isZh ? "总经验 / 时" : "Total XP/h")}</span>
            <span class="mwi-pixel-gold-val">${escapeHtml(formatCombatPrice(stat.totalXpPerHour))}/h</span>
          </div>
          <div class="mwi-pixel-gold-row">
            <span>${escapeHtml(isZh ? "日均消耗估" : "Daily Cost")}</span>
            <span class="mwi-pixel-gold-val">${escapeHtml(formatCombatPrice(stat.foodDailyCost))}/d</span>
          </div>
        </div>

        <div class="mwi-pixel-box">
          ${dropsBody}
        </div>
      </div>
    </div>
  `;
}

export function renderModalOverviewHtml(params: {
  analyses: PlayerBattleAnalysis[];
  primary: PlayerBattleAnalysis | null;
  i18n: I18nAPI;
}): string {
  const { analyses, primary, i18n } = params;
  const isZh = i18n.isZh();
  if (analyses.length === 0) {
    return `<div class="mwi-combat-empty">${escapeHtml(
      isZh ? "暂无进行中的战斗数据，请切换至“历史记录”查看过往场次。" : "No active battle data yet. Switch to History tab to view saved runs."
    )}</div>`;
  }

  if (analyses.length === 1) {
    return renderSoloOverview({ stat: analyses[0], i18n });
  }

  const ordered = [...analyses].sort((a, b) => {
    if (primary && a.characterId === primary.characterId) return -1;
    if (primary && b.characterId === primary.characterId) return 1;
    return 0;
  });

  const cardsHtml = ordered
    .map((stat) => {
      const avgZ = stat.stddev > 0 ? (stat.currentIncome - stat.expectation) / stat.stddev : 0;
      const luckStr = formatLuckPercent(stat.luck);
      const luckPct = stat.luck !== null ? Math.min(100, Math.max(0, stat.luck * 100)) : 0;
      const avgColor = stat.hasMapModel ? (avgZ >= 0 ? "#86efac" : "#fca5a5") : "#94a3b8";
      const skillName = stat.topSkillHrid ? i18n.getSkillName(stat.topSkillHrid) : isZh ? "战斗" : "Combat";
      const auraBadge = stat.aura
        ? `<span class="mwi-combat-aura">${escapeHtml(i18n.getName(stat.aura, "abilityNames") || stat.aura.replace("/abilities/", ""))}</span>`
        : "";

      const topDrops = [...stat.lootItems]
        .sort((a, b) => b.unitPrice - a.unitPrice || b.totalPrice - a.totalPrice)
        .slice(0, 8);

      const dropsHtml =
        topDrops.length > 0
          ? topDrops
              .map((d) => {
                const name = i18n.getItemName(d.itemHrid) + (d.enhancementLevel > 0 ? ` +${d.enhancementLevel}` : "");
                return `
                  <div class="mwi-combat-drop-row">
                    <span class="mwi-combat-drop-cnt">${escapeHtml(formatCombatPrice(d.count))}</span>
                    <span class="mwi-combat-drop-name" style="color:${getRarityColor(d.rarity)}">${escapeHtml(name)}</span>
                    <span class="mwi-combat-drop-val">${escapeHtml(formatCombatPrice(d.totalPrice))}</span>
                  </div>
                `;
              })
              .join("")
          : `<div class="mwi-combat-empty-sm">${escapeHtml(isZh ? "尚无掉落" : "No loot yet")}</div>`;

      return `
        <div class="mwi-pixel-box">
          <div class="mwi-combat-player-title">
            <span class="mwi-combat-player-left"><span>${escapeHtml(stat.name)}</span>${auraBadge}</span>
            ${stat.deathCount > 0 ? `<span class="mwi-combat-death">${PIXEL_SKULL_SVG}${stat.deathCount}</span>` : ""}
          </div>
          <div class="mwi-pixel-luck-box" style="margin-bottom:7px">
            <div class="mwi-pixel-luck-header" style="font-size:12px">
              <span>${escapeHtml(isZh ? "当前运气" : "Luck")}</span>
              <span style="color:${stat.luckColor}">${escapeHtml(luckStr)}</span>
            </div>
            <div class="mwi-pixel-luck-track" style="height:12px">
              <div class="mwi-pixel-luck-fill" style="${luckFillStyle(luckPct, stat.luckColor)}"></div>
            </div>
          </div>
          <table class="mwi-combat-table">
            <tbody>
              <tr style="color:${stat.luckColor};font-weight:700">
                <td>${escapeHtml(isZh ? "当前收入" : "Income")}</td>
                <td>${escapeHtml(formatCombatPrice(stat.currentIncome))}</td>
              </tr>
              <tr style="color:${avgColor}">
                <td>├ ${escapeHtml(isZh ? "期望" : "Mean")}</td>
                <td>${escapeHtml(stat.hasMapModel ? formatCombatPrice(stat.expectation) : "--")}</td>
              </tr>
              <tr style="color:${avgColor}">
                <td>└ ${escapeHtml(isZh ? "标准差" : "StdDev")}</td>
                <td>${escapeHtml(stat.hasMapModel ? formatCombatPrice(stat.stddev) : "--")}</td>
              </tr>
              <tr class="mwi-combat-row-gap"><td colspan="2"></td></tr>
              <tr style="color:${stat.luckColor};font-weight:700">
                <td>${escapeHtml(isZh ? "每日收入" : "Daily Income")}</td>
                <td>${escapeHtml(formatCombatPrice(stat.dailyIncome))}/d</td>
              </tr>
              <tr style="color:${avgColor}">
                <td>├ ${escapeHtml(isZh ? "期望" : "Mean")}</td>
                <td>${escapeHtml(stat.hasMapModel ? `${formatCombatPrice(stat.dailyExpectation)}/d` : "--")}</td>
              </tr>
              <tr class="mwi-combat-row-gap"><td colspan="2"></td></tr>
              <tr style="color:${stat.luckColor};font-weight:700">
                <td>${escapeHtml(isZh ? "每日净利" : "Daily Profit")}</td>
                <td>≥${escapeHtml(formatCombatPrice(stat.dailyProfit))}/d</td>
              </tr>
              <tr style="color:${avgColor}">
                <td>└ ${escapeHtml(isZh ? "期望" : "Mean")}</td>
                <td>${escapeHtml(stat.hasMapModel ? `≥${formatCombatPrice(stat.dailyProfitExpectation)}/d` : "--")}</td>
              </tr>
              <tr><td colspan="2"><div class="mwi-combat-sep"></div></td></tr>
              <tr style="color:#fbbf24;font-weight:700">
                <td>${escapeHtml(skillName + (isZh ? "经验" : " XP"))}</td>
                <td>${escapeHtml(formatCombatPrice(stat.topSkillXpPerHour))}/h</td>
              </tr>
              <tr style="color:#94a3b8">
                <td>${escapeHtml(isZh ? "日均消耗估" : "Daily Cost")}</td>
                <td>${escapeHtml(formatCombatPrice(stat.foodDailyCost))}/d</td>
              </tr>
            </tbody>
          </table>
          <div class="mwi-combat-drops-list">${dropsHtml}</div>
        </div>
      `;
    })
    .join("");

  return `<div class="mwi-combat-cards-grid">${cardsHtml}</div>`;
}

export function renderModalDetailsHtml(params: {
  analyses: PlayerBattleAnalysis[];
  activeStat: PlayerBattleAnalysis | null;
  selectedPlayerKey: string | null;
  i18n: I18nAPI;
}): string {
  const { analyses, activeStat, selectedPlayerKey, i18n } = params;
  const isZh = i18n.isZh();
  if (!activeStat || analyses.length === 0) {
    return `<div class="mwi-combat-empty">${escapeHtml(isZh ? "暂无战斗明细数据。" : "No battle details available.")}</div>`;
  }

  const playerSwitch =
    analyses.length > 1
      ? `<div class="mwi-combat-player-pills">${analyses
          .map(
            (a) =>
              `<button type="button" class="mwi-combat-pill ${
                String(a.characterId) === selectedPlayerKey ? "active" : ""
              }" data-player="${escapeHtml(String(a.characterId))}">${escapeHtml(a.name)}</button>`
          )
          .join("")}</div>`
      : "";

  const sortedDrops = [...activeStat.lootItems].sort((a, b) => b.totalPrice - a.totalPrice);
  const totalVal = Math.max(1, activeStat.currentIncome);
  const dropRows = sortedDrops
    .map((d) => {
      const itemName = i18n.getItemName(d.itemHrid) + (d.enhancementLevel > 0 ? ` +${d.enhancementLevel}` : "");
      const pct = ((d.totalPrice / totalVal) * 100).toFixed(1);
      return `
        <tr>
          <td style="color:${getRarityColor(d.rarity)};font-weight:700">${escapeHtml(itemName)}</td>
          <td>${escapeHtml(formatCombatPrice(d.count))}</td>
          <td>${escapeHtml(d.expectedCount > 0 ? d.expectedCount.toFixed(1) : "--")}</td>
          <td>${escapeHtml(formatCombatPrice(d.unitPrice))}</td>
          <td>${escapeHtml(formatCombatPrice(d.totalPrice))}</td>
          <td>${pct}%</td>
        </tr>
      `;
    })
    .join("");

  const consRows = activeStat.consumables
    .map((c) => {
      const name = i18n.getItemName(c.itemHrid);
      return `
        <tr>
          <td>${escapeHtml(name)}</td>
          <td>${escapeHtml(String(c.remainingCount))}</td>
          <td>${escapeHtml(formatCombatPrice(c.askPrice))}</td>
          <td>${escapeHtml(c.dailyCount.toFixed(1))}/d</td>
          <td>${escapeHtml(formatCombatPrice(c.dailyCost))}/d</td>
        </tr>
      `;
    })
    .join("");

  return `
    ${playerSwitch}
    <div class="mwi-combat-section-title">${escapeHtml(isZh ? "掉落明细" : "Loot Breakdown")}</div>
    <div class="mwi-combat-table-wrap">
      <table class="mwi-combat-detail-table">
        <thead>
          <tr>
            <th>${escapeHtml(isZh ? "物品" : "Item")}</th>
            <th>${escapeHtml(isZh ? "实得" : "Actual")}</th>
            <th>${escapeHtml(isZh ? "期望" : "Expected")}</th>
            <th>${escapeHtml(isZh ? "单价" : "Unit")}</th>
            <th>${escapeHtml(isZh ? "总价" : "Total")}</th>
            <th>${escapeHtml(isZh ? "占比" : "Share")}</th>
          </tr>
        </thead>
        <tbody>${dropRows || `<tr><td colspan="6">${escapeHtml(isZh ? "暂无掉落" : "No loot")}</td></tr>`}</tbody>
      </table>
    </div>
    <div class="mwi-combat-section-title">${escapeHtml(isZh ? "消耗品估算" : "Consumables Estimate")}</div>
    <div class="mwi-combat-table-wrap">
      <table class="mwi-combat-detail-table">
        <thead>
          <tr>
            <th>${escapeHtml(isZh ? "消耗品" : "Consumable")}</th>
            <th>${escapeHtml(isZh ? "剩余" : "Left")}</th>
            <th>${escapeHtml(isZh ? "Ask单价" : "Ask")}</th>
            <th>${escapeHtml(isZh ? "日耗量" : "Per Day")}</th>
            <th>${escapeHtml(isZh ? "日成本" : "Cost/d")}</th>
          </tr>
        </thead>
        <tbody>${consRows || `<tr><td colspan="5">${escapeHtml(isZh ? "无战斗消耗品" : "No consumables")}</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

export function renderModalHistoryHtml(params: {
  history: CombatHistoryViewEntry[];
  i18n: I18nAPI;
}): string {
  const { history, i18n } = params;
  const isZh = i18n.isZh();
  const rows = history
    .map((h) => {
      const dt = new Date(h.startTime * 1000).toLocaleString();
      const luckCell =
        h.luck !== null
          ? `<span style="color:${getLuckColor(h.luck)};font-weight:700">${escapeHtml(formatLuckPercent(h.luck))}</span>`
          : "--";
      return `
        <tr>
          <td>${escapeHtml(dt)}</td>
          <td>${escapeHtml(h.mapName)} T${h.difficultyTier}</td>
          <td>${escapeHtml(formatBattleDuration(h.durationSec))}</td>
          <td>#${h.runCount} (${h.eph.toFixed(1)}/h)</td>
          <td>${escapeHtml(formatCombatPrice(h.income))}</td>
          <td>${escapeHtml(formatCombatPrice(h.dailyProfit))}/d</td>
          <td>${luckCell}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="mwi-combat-history-toolbar">
      <span>${escapeHtml(isZh ? `共保存 ${history.length} 条记录` : `${history.length} saved runs`)}</span>
      <button type="button" class="mwi-combat-hbtn" data-history-action="clear">${escapeHtml(isZh ? "清空历史" : "Clear History")}</button>
    </div>
    <div class="mwi-combat-table-wrap">
      <table class="mwi-combat-detail-table">
        <thead>
          <tr>
            <th>${escapeHtml(isZh ? "开始时间" : "Start Time")}</th>
            <th>${escapeHtml(isZh ? "地图" : "Zone")}</th>
            <th>${escapeHtml(isZh ? "时长" : "Duration")}</th>
            <th>${escapeHtml(isZh ? "场次 / EPH" : "Runs / EPH")}</th>
            <th>${escapeHtml(isZh ? "总收入" : "Income")}</th>
            <th>${escapeHtml(isZh ? "日净利" : "Profit/d")}</th>
            <th>${escapeHtml(isZh ? "运气" : "Luck")}</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="7">${escapeHtml(isZh ? "暂无历史记录" : "No history yet")}</td></tr>`}</tbody>
      </table>
    </div>
  `;
}
