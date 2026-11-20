import type { FeatureModule, KernelContext } from "../../core/types";
import {
  AURA_ABILITY_SUFFIXES,
  CombatLuckEngine,
  formatBattleDuration,
  formatChatSummary,
  type BattlePlayerSnapshot,
  type CombatPriceMode,
  type CountedLootItem,
  type PlayerBattleAnalysis,
} from "./combat-luck-engine";
import {
  escapeHtml,
  getCombatPixelStyles,
  PIXEL_BAR_ICON_SVG,
  PIXEL_SWORD_SVG,
  renderLootBarState,
  renderModalDetailsHtml,
  renderModalHistoryHtml,
  renderModalOverviewHtml,
  type CombatHistoryViewEntry,
} from "./combat-pixel-ui";

const COUNTER_ID = "mwi-lite-combat-counter";
const LOOT_BAR_ID = "mwi-lite-combat-loot-bar";
const MODAL_ID = "mwi-lite-combat-modal";
const HISTORY_STORAGE_KEY = "combat_luck_history_v1";
const PRICE_MODE_STORAGE_KEY = "combat_luck_price_mode_v1";
const MAX_HISTORY_ENTRIES = 30;
const LOADOUT_BADGE_CLASS = "mwi-lite-loadout-enh";
const SCORE_BADGE_CLASS = "mwi-lite-combat-score";

type CombatHistoryEntry = CombatHistoryViewEntry;

interface ActiveBattleSession {
  startTimeSec: number;
  lastUpdatedTs: number;
  runCount: number;
  wave: number;
  players: BattlePlayerSnapshot[];
  fromNewBattle: boolean;
}

function parsePlayerFromNewBattle(rawPlayer: any, currentCharId: number | string | null): BattlePlayerSnapshot | null {
  if (!rawPlayer) return null;
  const charId = rawPlayer?.character?.id ?? 0;
  const name = rawPlayer?.character?.name || `Player#${charId}`;

  const loot: CountedLootItem[] = [];
  if (rawPlayer.totalLootMap && typeof rawPlayer.totalLootMap === "object") {
    for (const entry of Object.values<any>(rawPlayer.totalLootMap)) {
      const hrid = entry?.itemHrid;
      const count = Number(entry?.count) || 0;
      if (hrid && count > 0) {
        loot.push({
          itemHrid: hrid,
          count,
          enhancementLevel: Number(entry?.enhancementLevel) || 0,
        });
      }
    }
  }

  const skillExp: Record<string, number> = {};
  if (rawPlayer.totalSkillExperienceMap && typeof rawPlayer.totalSkillExperienceMap === "object") {
    for (const [k, v] of Object.entries(rawPlayer.totalSkillExperienceMap)) {
      const num = Number(v) || 0;
      if (num > 0) skillExp[k] = num;
    }
  }

  const consumables: Array<{ itemHrid: string; count: number }> = [];
  if (Array.isArray(rawPlayer.combatConsumables)) {
    for (const c of rawPlayer.combatConsumables) {
      if (c?.itemHrid) {
        consumables.push({
          itemHrid: c.itemHrid,
          count: Number(c.count) || 0,
        });
      }
    }
  }

  let aura: string | null = null;
  if (Array.isArray(rawPlayer.combatAbilities)) {
    for (const ab of rawPlayer.combatAbilities) {
      const abHrid: string = ab?.abilityHrid || "";
      if (AURA_ABILITY_SUFFIXES.some((s) => abHrid.endsWith(s))) {
        aura = abHrid;
        break;
      }
    }
  }

  const stats = rawPlayer?.combatDetails?.combatStats || {};
  return {
    characterId: charId,
    name,
    isCurrentPlayer: currentCharId !== null && String(charId) === String(currentCharId),
    loot,
    skillExp,
    consumables,
    combatDropQuantity: Number(stats.combatDropQuantity) || 0,
    combatDropRate: Number(stats.combatDropRate) || 0,
    combatRareFind: Number(stats.combatRareFind) || 0,
    drinkConcentration: Number(stats.drinkConcentration) || 0,
    deathCount: Number(rawPlayer.deathCount) || 0,
    aura,
  };
}

export function createCombatLightTrackerModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let engine: CombatLuckEngine | null = null;
  let unregStyle: (() => void) | null = null;
  let unregPrice: (() => void) | null = null;
  let unsubs: Array<() => void> = [];
  let keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  let session: ActiveBattleSession | null = null;
  let trackedCombatHrid: string | null = null;
  let trackedDifficultyTier = 0;
  let isLabyrinth = false;
  let labyrinthAttempt = 0;

  let priceMode: CombatPriceMode = "bid_net";
  let marketEpoch = "0";
  let priceBump = 0;
  let lastBarSignature = "";

  let modalTab: "overview" | "details" | "history" = "overview";
  let selectedPlayerKey: string | null = null;
  let lastHistorySaveTs = 0;

  const loadPriceMode = (): CombatPriceMode => {
    const saved = ctx?.storage.get<string>(PRICE_MODE_STORAGE_KEY, "bid_net");
    return saved === "ask" ? "ask" : "bid_net";
  };

  const loadHistory = (): CombatHistoryEntry[] => {
    const list = ctx?.storage.get<CombatHistoryEntry[]>(HISTORY_STORAGE_KEY, []);
    return Array.isArray(list) ? list : [];
  };

  const saveHistoryList = (list: CombatHistoryEntry[]): void => {
    ctx?.storage.set(HISTORY_STORAGE_KEY, list.slice(0, MAX_HISTORY_ENTRIES));
  };

  const resolveActiveCombatContext = (): {
    activeCombat: boolean;
    mapHrid: string | null;
    difficultyTier: number;
    isDungeon: boolean;
  } => {
    const actions = ctx?.gameData.getCharacterActions() || [];
    const activeAction = actions.find(
      (a) => !a?.isDone && (a?.actionHrid?.startsWith("/actions/combat/") || a?.actionHrid === "/actions/labyrinth/explore")
    );
    const combatAct = actions.find((a) => !a?.isDone && a?.actionHrid?.startsWith("/actions/combat/"));

    let mapHrid: string | null = combatAct?.actionHrid || null;
    let tier =
      combatAct != null
        ? Number(combatAct.difficultyTier ?? (combatAct.actionHrid?.includes("_elite") ? 1 : 0)) || 0
        : 0;

    if (!mapHrid) {
      const party = ctx?.gameData.getCharacterData()?.partyInfo?.party;
      if (party?.actionHrid?.startsWith("/actions/combat/")) {
        mapHrid = party.actionHrid;
        tier = Number(party.difficultyTier ?? (party.actionHrid.includes("_elite") ? 1 : 0)) || 0;
      }
    }

    if (!mapHrid && trackedCombatHrid) {
      mapHrid = trackedCombatHrid;
      tier = trackedDifficultyTier;
    }

    const clientData = ctx?.gameData.getClientData();
    const isDungeon = Boolean(mapHrid && clientData?.actionDetailMap?.[mapHrid]?.combatZoneInfo?.isDungeon);
    return {
      activeCombat: Boolean(activeAction) || Boolean(session),
      mapHrid,
      difficultyTier: tier,
      isDungeon,
    };
  };

  const computeSessionAnalyses = (): {
    analyses: PlayerBattleAnalysis[];
    primary: PlayerBattleAnalysis | null;
    mapHrid: string | null;
    mapName: string;
    difficultyTier: number;
    isDungeon: boolean;
  } => {
    const { mapHrid, difficultyTier, isDungeon } = resolveActiveCombatContext();
    const clientData = ctx?.gameData.getClientData() ?? null;
    const mapName = mapHrid
      ? ctx?.i18n.getActionName(mapHrid) || mapHrid.replace("/actions/combat/", "")
      : ctx?.i18n.t("战斗统计", "Combat") || "Combat";

    if (!session || !engine || session.players.length === 0) {
      return { analyses: [], primary: null, mapHrid, mapName, difficultyTier, isDungeon };
    }

    const durationSec = session.startTimeSec > 0 ? Math.max(1, Date.now() / 1000 - session.startTimeSec) : 1;
    const playerCount = Math.max(1, session.players.length);

    const analyses = session.players.map((player) =>
      engine!.analyzePlayer({
        clientData,
        mapHrid,
        difficultyTier,
        durationSec,
        runCount: session!.runCount,
        playerCount,
        player,
        priceMode,
        marketEpoch,
      })
    );

    const currentCharId = ctx?.gameData.getCharacterId();
    const currentName = ctx?.gameData.getCharacterName();
    const primary =
      analyses.find((a) => currentCharId != null && String(a.characterId) === String(currentCharId)) ||
      analyses.find((a) => currentName && a.name === currentName) ||
      analyses[0] ||
      null;

    return { analyses, primary, mapHrid, mapName, difficultyTier, isDungeon };
  };

  const maybeRecordHistory = (force = false): void => {
    if (!ctx || !session || session.runCount <= 1) return;
    const { primary, mapHrid, mapName, difficultyTier } = computeSessionAnalyses();
    if (!primary || !mapHrid) return;

    const clientData = ctx.gameData.getClientData();
    const mapEntry = engine?.getMapRegistry().getMapEntry(clientData, mapHrid);
    const bossWave = mapEntry?.spawnInfo.bossWave || 0;
    const isBossBoundary = bossWave > 0 && (session.runCount - 1) % bossWave === 0;
    const now = Date.now();
    if (!force && !isBossBoundary && now - lastHistorySaveTs < 30000) return;

    lastHistorySaveTs = now;
    const startTsRounded = Math.round(session.startTimeSec || now / 1000);
    const key = `${primary.characterId}:${mapHrid}:T${difficultyTier}:${startTsRounded}`;

    const entry: CombatHistoryEntry = {
      key,
      characterId: primary.characterId,
      playerName: primary.name,
      mapHrid,
      mapName,
      difficultyTier,
      startTime: startTsRounded,
      durationSec: primary.durationSec,
      runCount: primary.runCount,
      eph: primary.eph,
      income: primary.currentIncome,
      dailyIncome: primary.dailyIncome,
      dailyProfit: primary.dailyProfit,
      luck: primary.luck,
      priceMode: primary.priceMode,
    };

    const existing = loadHistory().filter((h) => h.key !== key);
    existing.unshift(entry);
    saveHistoryList(existing);
  };

  const applyNewBattle = (data: any): void => {
    if (!data) return;
    const currentCharId = ctx?.gameData.getCharacterId() ?? null;
    const rawPlayers = Array.isArray(data.players) ? data.players : [];
    const players = rawPlayers
      .map((p: any) => parsePlayerFromNewBattle(p, currentCharId))
      .filter((p: BattlePlayerSnapshot | null): p is BattlePlayerSnapshot => p !== null);

    if (players.length === 0) return;

    isLabyrinth = false;
    labyrinthAttempt = 0;

    const startTimeMs = data.combatStartTime ? new Date(data.combatStartTime).getTime() : 0;
    const startTimeSec = Number.isFinite(startTimeMs) && startTimeMs > 0 ? startTimeMs / 1000 : Date.now() / 1000;
    const runCount = Math.max(1, Number(data.battleId) || 1);
    const wave = Number(data.wave ?? 0) || 0;

    session = {
      startTimeSec,
      lastUpdatedTs: Date.now(),
      runCount,
      wave,
      players,
      fromNewBattle: true,
    };

    maybeRecordHistory(false);
    renderAll();
    if (document.getElementById(MODAL_ID)?.classList.contains("open")) {
      renderModalContent();
    }
  };

  const applyBattleUnitFallback = (data: any): void => {
    if (session?.fromNewBattle) return;
    const unit = data?.unit;
    if (!unit) return;

    const fallbackPlayer: BattlePlayerSnapshot = {
      characterId: unit.characterId ?? ctx?.gameData.getCharacterId() ?? 0,
      name: unit.character?.name || ctx?.gameData.getCharacterName() || ctx?.i18n.t("当前角色", "Current") || "Current",
      isCurrentPlayer: true,
      loot: Object.values<any>(unit.totalLootMap || {})
        .filter((l) => l?.itemHrid && (Number(l.count) || 0) > 0)
        .map((l) => ({
          itemHrid: l.itemHrid,
          count: Number(l.count) || 0,
          enhancementLevel: Number(l.enhancementLevel) || 0,
        })),
      skillExp: unit.totalSkillExperienceMap ? { ...unit.totalSkillExperienceMap } : {},
      consumables: [],
      combatDropQuantity: 0,
      combatDropRate: 0,
      combatRareFind: 0,
      drinkConcentration: 0,
      deathCount: Number(unit.deathCount) || 0,
      aura: null,
    };

    session = {
      startTimeSec: session?.startTimeSec || Date.now() / 1000,
      lastUpdatedTs: Date.now(),
      runCount: session?.runCount || 1,
      wave: session?.wave || 0,
      players: [fallbackPlayer],
      fromNewBattle: false,
    };
    renderAll();
    if (document.getElementById(MODAL_ID)?.classList.contains("open")) {
      renderModalContent();
    }
  };

  const togglePriceMode = (): void => {
    priceMode = priceMode === "bid_net" ? "ask" : "bid_net";
    ctx?.storage.set(PRICE_MODE_STORAGE_KEY, priceMode);
    lastBarSignature = "";
    renderAll();
    if (document.getElementById(MODAL_ID)?.classList.contains("open")) {
      renderModalContent();
    }
  };

  const ensureModal = (): HTMLElement => {
    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.setAttribute("data-mwi-lite", "1");
    modal.innerHTML = `
      <div class="mwi-combat-card">
        <div class="mwi-combat-modal-header">
          <div class="mwi-combat-title-wrap"></div>
          <div class="mwi-combat-header-actions">
            <button type="button" class="mwi-combat-hbtn" data-action="toggle-price"></button>
            <button type="button" class="mwi-combat-hbtn" data-action="copy"></button>
            <button type="button" class="mwi-combat-close" data-action="close">×</button>
          </div>
        </div>
        <div class="mwi-combat-tabs"></div>
        <div class="mwi-combat-body"></div>
      </div>
    `;

    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        closeModal();
        return;
      }
      const btn = (e.target as HTMLElement | null)?.closest("[data-action], [data-tab], [data-player], [data-history-action]") as HTMLElement | null;
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      if (action === "close") {
        closeModal();
      } else if (action === "toggle-price") {
        togglePriceMode();
      } else if (action === "copy") {
        const { primary, mapName, difficultyTier } = computeSessionAnalyses();
        if (primary) {
          const txt = formatChatSummary(primary, mapName, difficultyTier, ctx?.i18n.isZh() ?? true);
          navigator.clipboard?.writeText(txt).catch(() => {});
          const orig = btn.textContent || "";
          btn.textContent = ctx?.i18n.t("✓ 已复制", "✓ Copied") || "✓ Copied";
          setTimeout(() => {
            if (btn.isConnected) btn.textContent = orig;
          }, 1400);
        }
      }

      const tab = btn.getAttribute("data-tab") as "overview" | "details" | "history" | null;
      if (tab) {
        modalTab = tab;
        if (tab === "history") maybeRecordHistory(true);
        renderModalContent();
      }

      const pKey = btn.getAttribute("data-player");
      if (pKey) {
        selectedPlayerKey = pKey;
        renderModalContent();
      }

      if (btn.getAttribute("data-history-action") === "clear") {
        saveHistoryList([]);
        renderModalContent();
      }
    });

    document.body.appendChild(modal);
    return modal;
  };

  const openModal = (initialTab?: "overview" | "details" | "history"): void => {
    if (initialTab) modalTab = initialTab;
    else if (!session) modalTab = "history";
    const modal = ensureModal();
    modal.classList.add("open");
    renderModalContent();
  };

  const closeModal = (): void => {
    document.getElementById(MODAL_ID)?.classList.remove("open");
  };

  const renderModalContent = (): void => {
    const modal = document.getElementById(MODAL_ID);
    if (!modal || !ctx) return;

    const isZh = ctx.i18n.isZh();
    const { analyses, primary, mapName, difficultyTier } = computeSessionAnalyses();
    const cardEl = modal.querySelector(".mwi-combat-card");
    const titleWrap = modal.querySelector(".mwi-combat-title-wrap");
    const priceBtn = modal.querySelector('[data-action="toggle-price"]');
    const copyBtn = modal.querySelector('[data-action="copy"]');
    const tabsEl = modal.querySelector(".mwi-combat-tabs");
    const bodyEl = modal.querySelector(".mwi-combat-body");
    if (!titleWrap || !tabsEl || !bodyEl) return;

    if (cardEl) {
      cardEl.classList.toggle("is-solo", modalTab === "overview" && analyses.length === 1);
      cardEl.classList.toggle("is-party", modalTab === "overview" && analyses.length > 1);
    }

    const durStr = primary ? formatBattleDuration(primary.durationSec) : "--";
    const ephStr = primary && primary.completedRuns > 0 ? `${primary.eph.toFixed(1)} EPH` : `#${session?.runCount || 0}`;
    const tierBadge = `<span class="mwi-combat-badge">T${difficultyTier}</span>`;

    titleWrap.innerHTML =
      session && primary
        ? `${PIXEL_SWORD_SVG}<span class="mwi-combat-map-name">${escapeHtml(mapName)}</span> ${tierBadge} <span class="mwi-combat-meta">${escapeHtml(ephStr)} · ${escapeHtml(durStr)} · #${primary.runCount}</span>`
        : `${PIXEL_SWORD_SVG}<span class="mwi-combat-map-name">${escapeHtml(isZh ? "康康战斗统计" : "Combat Luck Stats")}</span>`;

    if (priceBtn) {
      priceBtn.textContent =
        priceMode === "bid_net"
          ? isZh ? "估值: Bid净值" : "Price: Bid Net"
          : isZh ? "估值: Ask" : "Price: Ask";
    }
    if (copyBtn) {
      (copyBtn as HTMLElement).style.display = primary ? "" : "none";
      copyBtn.textContent = isZh ? "复制战报" : "Copy";
    }

    const tabs: Array<{ id: "overview" | "details" | "history"; label: string }> = [
      { id: "overview", label: isZh ? "总览" : "Overview" },
      { id: "details", label: isZh ? "掉落明细与消耗" : "Drops & Costs" },
      { id: "history", label: isZh ? "历史记录" : "History" },
    ];
    tabsEl.innerHTML = tabs
      .map(
        (t) =>
          `<button type="button" class="mwi-combat-tab ${modalTab === t.id ? "active" : ""}" data-tab="${t.id}">${escapeHtml(t.label)}</button>`
      )
      .join("");

    if (modalTab === "overview") {
      bodyEl.innerHTML = renderModalOverviewHtml({ analyses, primary, i18n: ctx.i18n });
      return;
    }

    if (modalTab === "details") {
      const activeStat =
        analyses.find((a) => String(a.characterId) === selectedPlayerKey) || primary || analyses[0] || null;
      if (activeStat) selectedPlayerKey = String(activeStat.characterId);
      bodyEl.innerHTML = renderModalDetailsHtml({
        analyses,
        activeStat,
        selectedPlayerKey,
        i18n: ctx.i18n,
      });
      return;
    }

    bodyEl.innerHTML = renderModalHistoryHtml({ history: loadHistory(), i18n: ctx.i18n });
  };

  const renderAll = (): void => {
    if (!ctx) return;
    const isZh = ctx.i18n.isZh();
    const { activeCombat, isDungeon } = resolveActiveCombatContext();

    // 1) Header Battle Counter (#mwi-lite-combat-counter)
    const nameRow = document.querySelector('[class*="Header_actionName"]');
    if (nameRow) {
      const hasCount = isLabyrinth ? labyrinthAttempt > 0 : Boolean(session && session.runCount > 0);
      if (!activeCombat || !hasCount) {
        document.getElementById(COUNTER_ID)?.remove();
      } else {
        let counterEl = document.getElementById(COUNTER_ID);
        if (!counterEl) {
          counterEl = document.createElement("span");
          counterEl.id = COUNTER_ID;
          counterEl.setAttribute("data-mwi-lite", "1");
          nameRow.appendChild(counterEl);
        }
        const text = isLabyrinth
          ? ` · #${labyrinthAttempt}`
          : isDungeon
            ? ` · W${session?.wave ?? 0} · #${session?.runCount ?? 0}`
            : ` · #${session?.runCount ?? 0}`;
        if (counterEl.textContent !== text) counterEl.textContent = text;
      }
    }

    // 2) BattlePanel Summary Bar (#mwi-lite-combat-loot-bar)
    const combatPanel =
      document.querySelector('[class*="BattlePanel_"]') || document.querySelector('[class*="CombatPanel_"]');
    if (!combatPanel) {
      document.getElementById(LOOT_BAR_ID)?.remove();
      lastBarSignature = "";
      return;
    }

    const { primary } = computeSessionAnalyses();
    const historyCount = loadHistory().length;

    if (!activeCombat || !session || !primary) {
      if (historyCount === 0) {
        document.getElementById(LOOT_BAR_ID)?.remove();
        lastBarSignature = "";
        return;
      }
    }

    let summary = document.getElementById(LOOT_BAR_ID);
    if (!summary) {
      summary = document.createElement("div");
      summary.id = LOOT_BAR_ID;
      summary.setAttribute("data-mwi-lite", "1");
      summary.innerHTML = `
        <span class="mwi-combat-bar-metrics"></span>
        <span class="mwi-combat-bar-actions">
          <button type="button" class="mwi-combat-bar-btn" data-bar-action="price"></button>
          <button type="button" class="mwi-combat-bar-btn" data-bar-action="details"></button>
        </span>
      `;
      summary.addEventListener("click", (e) => {
        const btn = (e.target as HTMLElement | null)?.closest("[data-bar-action]");
        if (!btn) return;
        const act = btn.getAttribute("data-bar-action");
        if (act === "price") togglePriceMode();
        else if (act === "details") openModal(session && primary ? "overview" : "history");
      });

      const gainedExp = combatPanel.querySelector('[class*="BattlePanel_gainedExp"]');
      if (gainedExp?.parentElement) {
        gainedExp.insertAdjacentElement("afterend", summary);
      } else {
        combatPanel.insertBefore(summary, combatPanel.firstChild);
      }
      lastBarSignature = "";
    }

    const metricsEl = summary.querySelector(".mwi-combat-bar-metrics") as HTMLElement | null;
    const priceBtnEl = summary.querySelector('[data-bar-action="price"]') as HTMLButtonElement | null;
    const detailsBtnEl = summary.querySelector('[data-bar-action="details"]') as HTMLButtonElement | null;
    if (!metricsEl || !priceBtnEl || !detailsBtnEl) return;

    if (!activeCombat || !session || !primary) {
      const sig = `hist:${historyCount}:${isZh}`;
      if (sig !== lastBarSignature) {
        lastBarSignature = sig;
        metricsEl.innerHTML = "";
        priceBtnEl.style.display = "none";
        detailsBtnEl.innerHTML = `${PIXEL_BAR_ICON_SVG}<span>${escapeHtml(
          isZh ? `战斗历史 (${historyCount})` : `History (${historyCount})`
        )}</span>`;
      }
      return;
    }

    priceBtnEl.style.display = "";
    const barState = renderLootBarState({ primary, priceMode, i18n: ctx.i18n });
    if (barState.signature !== lastBarSignature) {
      lastBarSignature = barState.signature;
      metricsEl.innerHTML = barState.metricsHtml;
      priceBtnEl.textContent = barState.priceLabel;
      detailsBtnEl.innerHTML = `${PIXEL_BAR_ICON_SVG}<span>${escapeHtml(barState.detailsLabel)}</span>`;
    }
  };

  return {
    id: "combat-light-tracker",
    nameZh: "康康战斗掉落与运气统计",
    nameEn: "Kangkang Combat & Luck Tracker",
    descriptionZh: "采用康康运气统计路线：16-bit 像素风 HUD 状态栏与紧凑战报弹窗，提供运气%、日均净利与明细统计",
    descriptionEn: "Kangkang Luck route with 16-bit pixel HUD & compact modal: FFT luck %, daily net profit and breakdown",
    category: "combat",
    defaultEnabled: true,

    init(context) {
      ctx = context;
      engine = new CombatLuckEngine(ctx.marketStore);
      priceMode = loadPriceMode();
      marketEpoch = ctx.marketStore.isPricesLoaded() ? `loaded:${++priceBump}` : `init:${++priceBump}`;

      unregStyle = ctx.addStyle(
        "combat-light-tracker",
        getCombatPixelStyles({ counterId: COUNTER_ID, lootBarId: LOOT_BAR_ID, modalId: MODAL_ID })
      );

      unregPrice = ctx.marketStore.onPriceUpdate(() => {
        marketEpoch = `upd:${++priceBump}`;
        lastBarSignature = "";
        renderAll();
        if (document.getElementById(MODAL_ID)?.classList.contains("open")) {
          renderModalContent();
        }
      });

      keydownHandler = (e: KeyboardEvent) => {
        if (e.key === "Escape") closeModal();
      };
      document.addEventListener("keydown", keydownHandler);

      unsubs = [
        ctx.wsBus.on("init_client_data", () => {
          engine?.clearCache();
          renderAll();
        }),
        ctx.wsBus.on("init_character_data", (data) => {
          session = null;
          trackedCombatHrid = null;
          trackedDifficultyTier = 0;
          isLabyrinth = false;
          labyrinthAttempt = 0;
          lastBarSignature = "";
          const firstCombat = Array.isArray(data?.characterActions)
            ? data.characterActions.find((a: any) => !a?.isDone && a?.actionHrid?.startsWith("/actions/combat/"))
            : null;
          if (firstCombat) {
            trackedCombatHrid = firstCombat.actionHrid;
            trackedDifficultyTier = Number(firstCombat.difficultyTier ?? (firstCombat.actionHrid.includes("_elite") ? 1 : 0)) || 0;
          } else if (data?.partyInfo?.party?.actionHrid?.startsWith("/actions/combat/")) {
            trackedCombatHrid = data.partyInfo.party.actionHrid;
            trackedDifficultyTier = Number(data.partyInfo.party.difficultyTier ?? 0) || 0;
          }
          renderAll();
        }),
        ctx.wsBus.on("new_battle", (data) => {
          applyNewBattle(data);
        }),
        ctx.wsBus.on("battle_unit_fetched", (data) => {
          applyBattleUnitFallback(data);
        }),
        ctx.wsBus.on("labyrinth_updated", (data) => {
          const lab = data?.labyrinth;
          if (!lab?.isActive) return;
          const activeLab = (ctx?.gameData.getCharacterActions() || []).some(
            (a) => !a?.isDone && a?.actionHrid === "/actions/labyrinth/explore"
          );
          if (!activeLab) return;
          try {
            const path = JSON.parse(lab.pathData || "[]");
            const active = path[path.length - 1];
            const room = lab.roomData?.[active?.y]?.[active?.x];
            if (room?.roomType === "/labyrinth_room_types/combat" && (room.entryCount || 0) > 0) {
              isLabyrinth = true;
              labyrinthAttempt = room.entryCount;
              renderAll();
            }
          } catch {
            // Ignore
          }
        }),
        ctx.wsBus.on("action_completed", (data) => {
          const act = data?.endCharacterAction;
          if (act?.actionHrid?.startsWith("/actions/combat/") && !act.isDone) {
            trackedCombatHrid = act.actionHrid;
            trackedDifficultyTier = Number(act.difficultyTier ?? (act.actionHrid.includes("_elite") ? 1 : 0)) || 0;
          }
          // Non-combat action_completed does not pollute battleLoot; only refresh bar if needed
          if (session) renderAll();
        }),
        ctx.wsBus.on("actions_updated", (data) => {
          const actions = ctx?.gameData.getCharacterActions() || [];
          const activeCombat = actions.find((a) => !a?.isDone && a?.actionHrid?.startsWith("/actions/combat/"));
          if (activeCombat) {
            trackedCombatHrid = activeCombat.actionHrid;
            trackedDifficultyTier = Number(activeCombat.difficultyTier ?? (activeCombat.actionHrid.includes("_elite") ? 1 : 0)) || 0;
          }
          const hasAnyCombat = actions.some(
            (a) => !a?.isDone && (a?.actionHrid?.startsWith("/actions/combat/") || a?.actionHrid === "/actions/labyrinth/explore")
          );
          const endedCombat = Array.isArray(data?.endCharacterActions)
            ? data.endCharacterActions.some((a: any) => a?.isDone && a?.actionHrid?.startsWith("/actions/combat/"))
            : false;

          if (!hasAnyCombat && (endedCombat || actions.length > 0)) {
            maybeRecordHistory(true);
            session = null;
            trackedCombatHrid = null;
            trackedDifficultyTier = 0;
            isLabyrinth = false;
            labyrinthAttempt = 0;
            lastBarSignature = "";
            renderAll();
          }
        }),
        ctx.wsBus.on("party_updated", (data) => {
          const party = data?.partyInfo?.party;
          if (party?.actionHrid?.startsWith("/actions/combat/")) {
            trackedCombatHrid = party.actionHrid;
            trackedDifficultyTier = Number(party.difficultyTier ?? 0) || 0;
          }
        }),
      ];

      // Cold-start catchup if game already received new_battle before module init
      const cachedBattle = ctx.gameData.getBattleData();
      if (cachedBattle?.players?.length) {
        applyNewBattle(cachedBattle);
      }

      return () => {
        unsubs.forEach((u) => u());
        unsubs = [];
        unregPrice?.();
        unregPrice = null;
        unregStyle?.();
        unregStyle = null;
        if (keydownHandler) {
          document.removeEventListener("keydown", keydownHandler);
          keydownHandler = null;
        }
        document.getElementById(COUNTER_ID)?.remove();
        document.getElementById(LOOT_BAR_ID)?.remove();
        document.getElementById(MODAL_ID)?.remove();
      };
    },

    onDom() {
      renderAll();
    },
  };
}

export function createLoadoutBadgeModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let unregStyle: (() => void) | null = null;

  const renderBadges = () => {
    if (!ctx) return;
    const selectedLoadout = document.querySelector('[class*="LoadoutsPanel_selectedLoadout"]');
    if (!selectedLoadout) return;
    const equipDiv = selectedLoadout.querySelector('[class*="LoadoutsPanel_equipment"]');
    if (!equipDiv) return;

    const enhMap = new Map<string, number>();
    for (const item of ctx.gameData.getCharacterItems()) {
      if (!item?.itemHrid) continue;
      const lvl = item.enhancementLevel || 0;
      const prev = enhMap.get(item.itemHrid) || 0;
      if (lvl > prev) enhMap.set(item.itemHrid, lvl);
    }

    equipDiv.querySelectorAll(`.${LOADOUT_BADGE_CLASS}`).forEach((el) => el.remove());

    for (const useEl of equipDiv.querySelectorAll("use")) {
      const href = useEl.getAttribute("href") || useEl.getAttribute("xlink:href") || "";
      if (!href.includes("items_sprite")) continue;
      const slug = href.split("#")[1];
      if (!slug) continue;
      const enh = enhMap.get(`/items/${slug}`) || 0;
      if (enh <= 0) continue;

      const slot = useEl.closest('[class*="LoadoutsPanel_equipmentSlot"], [class*="Item_itemContainer"]') || useEl.parentElement?.parentElement;
      if (!slot) continue;
      if (getComputedStyle(slot).position === "static") {
        (slot as HTMLElement).style.position = "relative";
      }
      const badge = document.createElement("span");
      badge.className = LOADOUT_BADGE_CLASS;
      badge.setAttribute("data-mwi-lite", "1");
      badge.textContent = `+${enh}`;
      slot.appendChild(badge);
    }
  };

  return {
    id: "combat-loadout-badge",
    nameZh: "配装强化等级角标",
    nameEn: "Loadout Enhancement Badges",
    descriptionZh: "在配装面板装备图标上直接显示仓库最高 +N 强化等级",
    descriptionEn: "Overlay +N enhancement level badges on equipment icons in Loadouts panel",
    category: "combat",
    defaultEnabled: true,

    init(context) {
      ctx = context;
      unregStyle = ctx.addStyle(
        "combat-loadout-badge",
        `
        .${LOADOUT_BADGE_CLASS} {
          position: absolute;
          top: 1px;
          left: 2px;
          z-index: 5;
          font-size: 10px;
          font-weight: 700;
          color: #fde047;
          background: rgba(15, 23, 42, 0.85);
          padding: 0 3px;
          border-radius: 3px;
          pointer-events: none;
          line-height: 1.2;
        }
        `
      );
      return () => {
        unregStyle?.();
        unregStyle = null;
        document.querySelectorAll(`.${LOADOUT_BADGE_CLASS}`).forEach((el) => el.remove());
      };
    },

    onDom() {
      renderBadges();
    },
  };
}

export function createCombatScoreModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let unregStyle: (() => void) | null = null;
  let unregWs: (() => void) | null = null;
  let lastProfile: any | null = null;

  const computeProfileCombatScore = (profileWrapper: any): { total: number; house: number; ability: number; gear: number } => {
    const profile = profileWrapper?.profile || profileWrapper || {};
    const clientData = ctx?.gameData.getClientData();
    if (!clientData) return { total: 0, house: 0, ability: 0, gear: 0 };

    // 1) House combat rooms cost
    let houseCost = 0;
    const combatHouses = ["archery_range", "armory", "dining_room", "library", "observatory", "gym", "alchemy_lab"];
    const houseMap = profile.characterHouseRoomMap || {};
    for (const [roomHrid, info] of Object.entries<any>(houseMap)) {
      if (!combatHouses.some((k) => roomHrid.includes(k))) continue;
      const lv = info?.level || 0;
      const costsMap = clientData.houseRoomDetailMap?.[roomHrid]?.upgradeCostsMap;
      if (!costsMap) continue;
      for (let i = 1; i <= lv; i++) {
        for (const c of costsMap[i] || []) {
          if (c.itemHrid === "/items/coin") houseCost += c.count || 0;
          else {
            const p = ctx?.marketStore.getPrice(c.itemHrid, 0);
            houseCost += (p?.ask ?? p?.bid ?? 0) * (c.count || 0);
          }
        }
      }
    }

    // 2) Equipped abilities book cost
    let abilityCost = 0;
    const bookExpTable = clientData.abilityExperienceThresholdTable || clientData.levelExperienceTable || [];
    for (const ab of profile.equippedAbilities || []) {
      if (!ab?.abilityHrid || !ab.level) continue;
      const bookSlug = ab.abilityHrid.replace("/abilities/", "");
      const bookHrid = `/items/${bookSlug}`;
      const p = ctx?.marketStore.getPrice(bookHrid, 0);
      const bookPrice = p?.ask ?? p?.bid ?? 0;
      if (bookPrice > 0) {
        const xpNeeded = bookExpTable[ab.level] || ab.level * 50;
        abilityCost += Math.ceil(xpNeeded / 50) * bookPrice;
      }
    }

    // 3) Equipped gear market value
    let gearCost = 0;
    const wearableMap = profile.wearableItemMap || {};
    for (const item of Object.values<any>(wearableMap)) {
      if (!item?.itemHrid) continue;
      const enh = item.enhancementLevel || 0;
      const p = ctx?.marketStore.getPrice(item.itemHrid, enh);
      if (p?.ask || p?.bid) {
        gearCost += p.ask ?? p.bid ?? 0;
      } else {
        const base = ctx?.marketStore.getPrice(item.itemHrid, 0);
        gearCost += (base?.ask ?? base?.bid ?? 0) * Math.pow(1.35, Math.min(enh, 12));
      }
    }

    const house = houseCost / 1e6;
    const ability = abilityCost / 1e6;
    const gear = gearCost / 1e6;
    return { total: house + ability + gear, house, ability, gear };
  };

  const injectScoreOnProfilePanel = () => {
    if (!ctx) return;
    const profilePanels = document.querySelectorAll('[class*="Profile_profile"]');
    if (!profilePanels.length) return;

    profilePanels.forEach((panel) => {
      if (panel.querySelector(`.${SCORE_BADGE_CLASS}`)) return;
      const charData = ctx!.gameData.getCharacterData();
      const sourceData = lastProfile || (charData ? { profile: { characterHouseRoomMap: Object.fromEntries(ctx!.gameData.getHouseRooms()), wearableItemMap: Object.fromEntries(ctx!.gameData.getCharacterItems().filter((i) => i.itemLocationHrid !== "/item_locations/inventory").map((i) => [i.itemLocationHrid, i])) } } : null);
      if (!sourceData) return;

      const score = computeProfileCombatScore(sourceData);
      if (score.total <= 0) return;

      const badge = document.createElement("div");
      badge.className = SCORE_BADGE_CLASS;
      badge.setAttribute("data-mwi-lite", "1");
      badge.textContent = `🛡 ${ctx!.i18n.t("战斗评分", "Combat Score")}: ${score.total.toFixed(1)}M (${ctx!.i18n.t("房", "H")} ${score.house.toFixed(1)} + ${ctx!.i18n.t("技", "A")} ${score.ability.toFixed(1)} + ${ctx!.i18n.t("装", "G")} ${score.gear.toFixed(1)})`;

      const header = panel.querySelector('[class*="Profile_characterName"], [class*="Profile_header"]') || panel.firstElementChild;
      header?.parentElement?.insertBefore(badge, header.nextSibling);
    });
  };

  return {
    id: "combat-score",
    nameZh: "角色战斗评分",
    nameEn: "Combat Score",
    descriptionZh: "在角色资料面板展示综合战力估值（战斗房屋 + 已装备技能书 + 装备价值）",
    descriptionEn: "Show Combat Score breakdown (houses + equipped abilities + gear) on Profile panel",
    category: "combat",
    defaultEnabled: true,

    init(context) {
      ctx = context;
      unregStyle = ctx.addStyle(
        "combat-score",
        `
        .${SCORE_BADGE_CLASS} {
          display: inline-block;
          margin: 4px 0;
          padding: 3px 9px;
          border-radius: 5px;
          background: rgba(59, 130, 246, 0.16);
          border: 1px solid rgba(96, 165, 250, 0.35);
          color: #93c5fd;
          font-size: 12px;
          font-weight: 600;
        }
        `
      );
      unregWs = ctx.wsBus.on("profile_shared", (data) => {
        lastProfile = data;
        document.querySelectorAll(`.${SCORE_BADGE_CLASS}`).forEach((el) => el.remove());
        ctx?.domScheduler.scheduleRun(false);
      });

      return () => {
        unregWs?.();
        unregWs = null;
        unregStyle?.();
        unregStyle = null;
        document.querySelectorAll(`.${SCORE_BADGE_CLASS}`).forEach((el) => el.remove());
      };
    },

    onDom() {
      injectScoreOnProfilePanel();
    },
  };
}
