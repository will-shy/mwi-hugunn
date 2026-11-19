import type { FeatureModule, KernelContext } from "../../core/types";

const COUNTER_ID = "mwi-lite-combat-counter";
const LOOT_BAR_ID = "mwi-lite-combat-loot-bar";
const LOADOUT_BADGE_CLASS = "mwi-lite-loadout-enh";
const SCORE_BADGE_CLASS = "mwi-lite-combat-score";

function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2).replace(/\.?0+$/, "")}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.?0+$/, "")}K`;
  return String(Math.round(n));
}

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function createCombatLightTrackerModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let unregStyle: (() => void) | null = null;
  let unsubs: Array<() => void> = [];

  let battleId = 0;
  let currentWave = 0;
  let isDungeon = false;
  let isLabyrinth = false;
  let labyrinthAttempt = 0;
  let sessionStartTs = 0;
  let sessionXpGain = 0;
  let sessionLootValue = 0;
  let lastInventoryCounts = new Map<string, number>();

  const snapshotInventoryCounts = () => {
    const map = new Map<string, number>();
    for (const it of ctx?.gameData.getCharacterItems() || []) {
      if (!it || it.itemLocationHrid !== "/item_locations/inventory") continue;
      const key = `${it.itemHrid}:${it.enhancementLevel || 0}`;
      map.set(key, (map.get(key) || 0) + (it.count || 0));
    }
    return map;
  };

  const renderCounter = () => {
    const nameRow = document.querySelector('[class*="Header_actionName"]');
    if (!nameRow) return;

    const actions = ctx?.gameData.getCharacterActions() || [];
    const activeCombat = actions.some(
      (a) => !a?.isDone && (a?.actionHrid?.startsWith("/actions/combat/") || a?.actionHrid === "/actions/labyrinth/explore")
    );

    if (!activeCombat || (battleId === 0 && labyrinthAttempt === 0)) {
      document.getElementById(COUNTER_ID)?.remove();
      document.getElementById(LOOT_BAR_ID)?.remove();
      return;
    }

    let el = document.getElementById(COUNTER_ID);
    if (!el) {
      el = document.createElement("span");
      el.id = COUNTER_ID;
      el.setAttribute("data-mwi-lite", "1");
      nameRow.appendChild(el);
    }

    if (isLabyrinth) {
      el.textContent = ` · #${labyrinthAttempt}`;
    } else if (isDungeon) {
      el.textContent = ` · W${currentWave} · #${battleId}`;
    } else {
      el.textContent = ` · #${battleId}`;
    }

    // Light session summary inside Battle/Combat panel header if present
    const combatPanel =
      document.querySelector('[class*="BattlePanel_"]') || document.querySelector('[class*="CombatPanel_"]');
    if (combatPanel && sessionStartTs > 0) {
      let summary = document.getElementById(LOOT_BAR_ID);
      if (!summary) {
        summary = document.createElement("div");
        summary.id = LOOT_BAR_ID;
        summary.setAttribute("data-mwi-lite", "1");
        combatPanel.insertBefore(summary, combatPanel.firstChild);
      }
      const hours = Math.max(1 / 3600, (Date.now() - sessionStartTs) / 3600_000);
      const xpPerHr = sessionXpGain / hours;
      const lootPerHr = sessionLootValue / hours;
      summary.textContent = `⚔ ${formatElapsed(Date.now() - sessionStartTs)} · XP/h ${formatCompact(xpPerHr)} · ${ctx?.i18n.t("掉落/h", "Loot/h")} ${formatCompact(lootPerHr)} (${ctx?.i18n.t("累计", "Total")} ${formatCompact(sessionLootValue)})`;
    }
  };

  return {
    id: "combat-light-tracker",
    nameZh: "战斗波次与轻量收益统计",
    nameEn: "Light Combat & Loot Tracker",
    descriptionZh: "在行动栏显示当前波次/场次，在战斗面板顶部展示耗时、XP/h 与掉落估值（无 Chart.js）",
    descriptionEn: "Show battle/wave counter, runtime, XP/hr and loot value summary without Chart.js",
    category: "combat",
    defaultEnabled: true,

    init(context) {
      ctx = context;
      unregStyle = ctx.addStyle(
        "combat-light-tracker",
        `
        #${COUNTER_ID} { color: rgba(255,255,255,0.72); margin-left: 5px; font-size: 12px; white-space: nowrap; }
        #${LOOT_BAR_ID} {
          padding: 4px 10px;
          margin-bottom: 6px;
          border-radius: 5px;
          background: rgba(30, 41, 59, 0.78);
          border: 1px solid rgba(71, 85, 105, 0.5);
          color: #cbd5e1;
          font-size: 12px;
        }
        `
      );

      lastInventoryCounts = snapshotInventoryCounts();

      unsubs = [
        ctx.wsBus.on("init_character_data", () => {
          sessionStartTs = 0;
          sessionXpGain = 0;
          sessionLootValue = 0;
          battleId = 0;
          currentWave = 0;
          lastInventoryCounts = snapshotInventoryCounts();
        }),
        ctx.wsBus.on("new_battle", (data) => {
          const actions = ctx?.gameData.getCharacterActions() || [];
          const combatAct = actions.find((a) => !a?.isDone && a?.actionHrid?.startsWith("/actions/combat/"));
          if (!combatAct) return;

          if (!sessionStartTs) {
            sessionStartTs = Date.now();
            sessionXpGain = 0;
            sessionLootValue = 0;
            lastInventoryCounts = snapshotInventoryCounts();
          }

          isLabyrinth = false;
          labyrinthAttempt = 0;
          battleId = data?.battleId || battleId + 1;
          const zoneInfo = ctx?.gameData.getClientData()?.actionDetailMap?.[combatAct.actionHrid]?.combatZoneInfo;
          isDungeon = zoneInfo?.isDungeon === true;
          currentWave = isDungeon ? (data?.wave ?? 0) : 0;
          renderCounter();
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
              renderCounter();
            }
          } catch {
            // Ignore
          }
        }),
        ctx.wsBus.on("action_completed", (data) => {
          if (!sessionStartTs) return;
          const curCounts = snapshotInventoryCounts();
          for (const [k, curVal] of curCounts) {
            const prevVal = lastInventoryCounts.get(k) || 0;
            if (curVal > prevVal) {
              const [hrid, enhStr] = k.split(":");
              const diff = curVal - prevVal;
              if (hrid === "/items/coin") {
                sessionLootValue += diff;
              } else {
                const p = ctx?.marketStore.getPrice(hrid, Number(enhStr) || 0);
                const unit = p?.bid ?? p?.ask ?? 0;
                sessionLootValue += unit * diff;
              }
            }
          }
          lastInventoryCounts = curCounts;
          if (typeof data?.experienceGain === "number") {
            sessionXpGain += data.experienceGain;
          }
          renderCounter();
        }),
        ctx.wsBus.on("actions_updated", () => {
          const hasCombat = (ctx?.gameData.getCharacterActions() || []).some(
            (a) => !a?.isDone && (a?.actionHrid?.startsWith("/actions/combat/") || a?.actionHrid === "/actions/labyrinth/explore")
          );
          if (!hasCombat) {
            battleId = 0;
            currentWave = 0;
            isLabyrinth = false;
            labyrinthAttempt = 0;
            renderCounter();
          }
        }),
      ];

      return () => {
        unsubs.forEach((u) => u());
        unsubs = [];
        unregStyle?.();
        unregStyle = null;
        document.getElementById(COUNTER_ID)?.remove();
        document.getElementById(LOOT_BAR_ID)?.remove();
      };
    },

    onDom() {
      renderCounter();
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
