import type { GameDataAPI, MarketStore } from "../../core/types";

export const BASE_SUCCESS_RATES = [
  50, 45, 45, 40, 40, 40, 35, 35, 35, 35, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
];

export const ENHANCEMENT_BONUSES: Record<number, number> = {
  1: 0.02, 2: 0.042, 3: 0.066, 4: 0.092, 5: 0.12,
  6: 0.15, 7: 0.182, 8: 0.216, 9: 0.252, 10: 0.29,
  11: 0.334, 12: 0.384, 13: 0.44, 14: 0.502, 15: 0.57,
  16: 0.644, 17: 0.724, 18: 0.81, 19: 0.902, 20: 1.0,
};

export const ENHANCEMENT_MULTIPLIERS: Record<string, number> = {
  "/equipment_types/neck": 5,
  "/equipment_types/ring": 5,
  "/equipment_types/earring": 5,
  "/equipment_types/back": 5,
  "/equipment_types/trinket": 5,
  "/equipment_types/charm": 5,
};

export const MIN_ENHANCING_ACTION_TIME = 3;
export const BASE_ENHANCING_ACTION_TIME = 12;

export function getEnhancementStatMultiplier(itemDetails: any, enhancementLevel: number): number {
  if (!enhancementLevel || enhancementLevel <= 0) return 1;
  const equipmentType = itemDetails?.equipmentDetail?.type;
  const slotMult = ENHANCEMENT_MULTIPLIERS[equipmentType] || 1;
  const bonus = ENHANCEMENT_BONUSES[enhancementLevel] || 0;
  return 1 + bonus * slotMult;
}

/** Pure-TS Gaussian elimination inversion for small transient matrix (I - Q)^-1. */
export function invertMatrix(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  const aug: number[][] = Array.from({ length: n }, (_, i) => {
    const row = new Array<number>(2 * n).fill(0);
    for (let j = 0; j < n; j++) row[j] = matrix[i][j];
    row[n + i] = 1;
    return row;
  });

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(aug[col][col]);
    for (let r = col + 1; r < n; r++) {
      const abs = Math.abs(aug[r][col]);
      if (abs > maxAbs) {
        maxAbs = abs;
        pivotRow = r;
      }
    }
    if (maxAbs < 1e-12) return null;
    if (pivotRow !== col) {
      const tmp = aug[col];
      aug[col] = aug[pivotRow];
      aug[pivotRow] = tmp;
    }

    const pivot = aug[col][col];
    for (let j = col; j < 2 * n; j++) {
      aug[col][j] /= pivot;
    }

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      if (factor === 0) continue;
      for (let j = col; j < 2 * n; j++) {
        aug[r][j] -= factor * aug[col][j];
      }
    }
  }

  return aug.map((row) => row.slice(n));
}

interface MarkovResult {
  readonly attempts: number;
  readonly protectionCount: number;
}

const MARKOV_CACHE_LIMIT = 4096;
const markovCache = new Map<string, MarkovResult | null>();

/** Pure Markov expected attempts/protections, memoized across market price invalidations. */
export function solveEnhancementMarkov(
  enhancingLevel: number,
  toolBonus: number,
  itemLevel: number,
  targetLevel: number,
  protectFrom: number,
  blessedTea: boolean,
  guzzlingBonus: number
): MarkovResult | null {
  const cacheKey = `${enhancingLevel}|${toolBonus}|${itemLevel}|${targetLevel}|${protectFrom}|${blessedTea ? 1 : 0}|${guzzlingBonus}`;
  if (markovCache.has(cacheKey)) {
    return markovCache.get(cacheKey)!;
  }

  const totalBonus =
    enhancingLevel >= itemLevel
      ? 1 + (toolBonus + 0.05 * (enhancingLevel - itemLevel)) / 100
      : 1 - 0.5 * (1 - enhancingLevel / itemLevel) + toolBonus / 100;

  const Q: number[][] = Array.from({ length: targetLevel }, () => new Array<number>(targetLevel).fill(0));
  const iMinusQ: number[][] = Array.from({ length: targetLevel }, () => new Array<number>(targetLevel).fill(0));

  for (let i = 0; i < targetLevel; i++) {
    const baseRate = (BASE_SUCCESS_RATES[i] ?? 30) / 100;
    const pSuccess = Math.max(0, Math.min(1, baseRate * totalBonus));
    const failDest = protectFrom > 0 && i >= protectFrom ? i - 1 : 0;

    if (blessedTea) {
      const skipRatio = Math.max(0, Math.min(1, 0.01 * guzzlingBonus));
      const pSkip = pSuccess * skipRatio;
      const pNormal = pSuccess - pSkip;
      if (i + 1 < targetLevel) Q[i][i + 1] += pNormal;
      if (i + 2 < targetLevel) Q[i][i + 2] += pSkip;
      if (failDest < targetLevel) Q[i][failDest] += 1 - pSuccess;
    } else {
      if (i + 1 < targetLevel) Q[i][i + 1] += pSuccess;
      if (failDest < targetLevel) Q[i][failDest] += 1 - pSuccess;
    }

    for (let j = 0; j < targetLevel; j++) {
      iMinusQ[i][j] = (i === j ? 1 : 0) - Q[i][j];
    }
  }

  const M = invertMatrix(iMinusQ);
  if (!M) {
    if (markovCache.size >= MARKOV_CACHE_LIMIT) markovCache.clear();
    markovCache.set(cacheKey, null);
    return null;
  }

  let attempts = 0;
  for (let i = 0; i < targetLevel; i++) {
    attempts += M[0][i];
  }

  let protectionCount = 0;
  if (protectFrom > 0 && protectFrom < targetLevel) {
    for (let i = protectFrom; i < targetLevel; i++) {
      const failChance = Q[i][i - 1] ?? 0;
      protectionCount += M[0][i] * failChance;
    }
  }

  const res: MarkovResult = { attempts, protectionCount };
  if (markovCache.size >= MARKOV_CACHE_LIMIT) markovCache.clear();
  markovCache.set(cacheKey, res);
  return res;
}

export function calculateEnhancingActionTime(
  enhancingLevel: number,
  itemLevel: number,
  speedBonus: number
): number {
  const speedMultiplier =
    enhancingLevel > itemLevel
      ? 1 + (enhancingLevel - itemLevel + speedBonus) / 100
      : 1 + speedBonus / 100;
  return Math.max(MIN_ENHANCING_ACTION_TIME, BASE_ENHANCING_ACTION_TIME / Math.max(0.1, speedMultiplier));
}

export interface CharacterEnhancingSetup {
  baseEnhancingLevel: number;
  effectiveEnhancingLevel: number;
  houseLevel: number;
  toolBonus: number;
  speedBonus: number;
  drinkConcentration: number;
  guzzlingBonus: number;
  blessedTea: boolean;
  activeTeaHrids: string[];
  equippedLabels: string[];
}

/** Auto-detects enhancing setup from the character's currently equipped gear, skills, house & drink slots. */
export function detectCharacterEnhancingSetup(gameData: GameDataAPI): CharacterEnhancingSetup {
  const clientData = gameData.getClientData();
  const itemMap = clientData?.itemDetailMap || {};
  const skills = gameData.getCharacterSkills();
  const enhSkill = skills.find((s) => s?.skillHrid === "/skills/enhancing");
  const baseEnhancingLevel = enhSkill?.level || 1;

  const houseRooms = gameData.getHouseRooms();
  const observatory = houseRooms.get("/house_rooms/observatory");
  const houseLevel = observatory?.level || 0;

  const equipped = gameData
    .getCharacterItems()
    .filter((i) => i && i.itemLocationHrid !== "/item_locations/inventory");

  let equipSuccessBonus = 0;
  let equipSpeedBonus = 0;
  let drinkConcentration = 0;
  const equippedLabels: string[] = [];

  for (const eq of equipped) {
    const details = itemMap[eq.itemHrid];
    const stats = details?.equipmentDetail?.noncombatStats;
    if (!stats) continue;

    const enhLv = eq.enhancementLevel || 0;
    const mult = getEnhancementStatMultiplier(details, enhLv);

    const succ = (stats.enhancingSuccess || 0) * 100 * mult;
    const spd = ((stats.enhancingSpeed || 0) + (stats.skillingSpeed || 0)) * 100 * mult;
    const conc = (stats.drinkConcentration || 0) * 100 * mult;

    if (succ > 0 || spd > 0 || conc > 0) {
      equipSuccessBonus += succ;
      equipSpeedBonus += spd;
      if (conc > drinkConcentration) drinkConcentration = conc;
      const baseName = details?.name || eq.itemHrid.replace("/items/", "");
      equippedLabels.push(enhLv > 0 ? `${baseName} +${enhLv}` : baseName);
    }
  }

  const guzzlingBonus = 1 + drinkConcentration / 100;
  const drinkSlots = gameData.getActionTypeDrinkSlots().get("/action_types/enhancing") || [];
  const activeTeaHrids: string[] = [];
  let hasBasic = false;
  let hasSuper = false;
  let hasUltra = false;
  let blessedTea = false;

  for (const slot of drinkSlots) {
    const hrid = slot?.itemHrid;
    if (!hrid) continue;
    activeTeaHrids.push(hrid);
    if (hrid === "/items/enhancing_tea") hasBasic = true;
    else if (hrid === "/items/super_enhancing_tea") hasSuper = true;
    else if (hrid === "/items/ultra_enhancing_tea") hasUltra = true;
    else if (hrid === "/items/blessed_tea") blessedTea = true;
  }

  const baseTeaLv = hasUltra ? 8 : hasSuper ? 6 : hasBasic ? 3 : 0;
  const baseTeaSpd = hasUltra ? 6 : hasSuper ? 4 : hasBasic ? 2 : 0;

  // Community buff for Enhancing Speed (if present)
  const charData = gameData.getCharacterData();
  const communitySpeedLv =
    charData?.communityBuffsMap?.["/community_buff_types/enhancing_speed"]?.level ??
    charData?.communityBuffs?.find?.((b: any) => b.typeHrid === "/community_buff_types/enhancing_speed")?.level ??
    0;
  const communitySpeedBonus = communitySpeedLv > 0 ? 20 + (communitySpeedLv - 1) * 0.5 : 0;

  const effectiveEnhancingLevel = baseEnhancingLevel + baseTeaLv * guzzlingBonus;
  const toolBonus = equipSuccessBonus + houseLevel * 0.05;
  const speedBonus = equipSpeedBonus + houseLevel * 1.0 + baseTeaSpd * guzzlingBonus + communitySpeedBonus;

  return {
    baseEnhancingLevel,
    effectiveEnhancingLevel,
    houseLevel,
    toolBonus,
    speedBonus,
    drinkConcentration,
    guzzlingBonus,
    blessedTea,
    activeTeaHrids,
    equippedLabels,
  };
}

export interface EnhancementCostPlan {
  targetLevel: number;
  basePrice: number;
  baseCount: number;
  perActionMaterialCost: number;
  attempts: number;
  perActionTimeSec: number;
  totalTimeHours: number;
  materialCost: number;
  protectionCount: number;
  protectionCost: number;
  protectFrom: number;
  protectItemHrid: string | null;
  mirrorCount: number;
  mirrorCost: number;
  mirrorStartLevel: number | null;
  teaCostPerHour: number;
  teaCost: number;
  totalCost: number;
}

/** Computes minimum-cost enhancement plan (with Philosopher's Mirror DP optimization). */
export function computeEnhancementPlan(
  itemHrid: string,
  targetLevel: number,
  setup: {
    effectiveEnhancingLevel: number;
    toolBonus: number;
    speedBonus: number;
    blessedTea: boolean;
    guzzlingBonus: number;
    activeTeaHrids: string[];
  },
  clientData: any,
  marketStore: MarketStore,
  getBasePrice: (hrid: string) => number,
  getMaterialAsk: (hrid: string) => number
): EnhancementCostPlan | null {
  const itemDetails = clientData?.itemDetailMap?.[itemHrid];
  if (!itemDetails?.enhancementCosts?.length || targetLevel < 1 || targetLevel > 20) {
    return null;
  }

  const itemLevel = itemDetails.itemLevel || 1;
  const basePrice = getBasePrice(itemHrid);

  let perActionMaterialCost = 0;
  for (const mat of itemDetails.enhancementCosts) {
    perActionMaterialCost += getMaterialAsk(mat.itemHrid) * (mat.count || 0);
  }

  // Cheapest protection item
  const protOptions: string[] = [itemHrid, "/items/mirror_of_protection"];
  if (Array.isArray(itemDetails.protectionItemHrids)) {
    protOptions.push(...itemDetails.protectionItemHrids);
  }
  let protectUnitPrice = Infinity;
  let protectItemHrid: string | null = null;
  for (const hrid of protOptions) {
    const p = getBasePrice(hrid);
    if (p > 0 && p < protectUnitPrice) {
      protectUnitPrice = p;
      protectItemHrid = hrid;
    }
  }
  if (protectUnitPrice === Infinity) protectUnitPrice = 0;

  // Tea cost per hour (1 drink every 300s = 12/hr)
  let teaCostPerDrink = 0;
  for (const teaHrid of setup.activeTeaHrids) {
    const tp = marketStore.getPrice(teaHrid, 0);
    teaCostPerDrink += tp?.ask && tp.ask > 0 ? tp.ask : tp?.bid && tp.bid > 0 ? tp.bid : 0;
  }
  const teaCostPerHour = teaCostPerDrink * 12;

  const perActionTimeSec = calculateEnhancingActionTime(
    setup.effectiveEnhancingLevel,
    itemLevel,
    setup.speedBonus
  );

  // Step 1: Solve traditional enhancement plan for each level 1..targetLevel
  const dp: EnhancementCostPlan[] = new Array(targetLevel + 1);
  dp[0] = {
    targetLevel: 0,
    basePrice,
    baseCount: 1,
    perActionMaterialCost,
    attempts: 0,
    perActionTimeSec,
    totalTimeHours: 0,
    materialCost: 0,
    protectionCount: 0,
    protectionCost: 0,
    protectFrom: 0,
    protectItemHrid,
    mirrorCount: 0,
    mirrorCost: 0,
    mirrorStartLevel: null,
    teaCostPerHour,
    teaCost: 0,
    totalCost: basePrice,
  };

  for (let lvl = 1; lvl <= targetLevel; lvl++) {
    const strategies = [0];
    for (let p = 2; p <= lvl; p++) strategies.push(p);

    let best: EnhancementCostPlan | null = null;
    for (const protectFrom of strategies) {
      const res = solveEnhancementMarkov(
        setup.effectiveEnhancingLevel,
        setup.toolBonus,
        itemLevel,
        lvl,
        protectFrom,
        setup.blessedTea,
        setup.guzzlingBonus
      );
      if (!res) continue;

      const totalTimeHours = (res.attempts * perActionTimeSec) / 3600;
      const materialCost = perActionMaterialCost * res.attempts;
      const protectionCost =
        protectFrom > 0 && res.protectionCount > 0 ? protectUnitPrice * res.protectionCount : 0;
      const teaCost = teaCostPerHour * totalTimeHours;
      const totalCost = basePrice + materialCost + protectionCost + teaCost;

      if (!best || totalCost < best.totalCost) {
        best = {
          targetLevel: lvl,
          basePrice,
          baseCount: 1,
          perActionMaterialCost,
          attempts: res.attempts,
          perActionTimeSec,
          totalTimeHours,
          materialCost,
          protectionCount: res.protectionCount,
          protectionCost,
          protectFrom,
          protectItemHrid,
          mirrorCount: 0,
          mirrorCost: 0,
          mirrorStartLevel: null,
          teaCostPerHour,
          teaCost,
          totalCost,
        };
      }
    }
    dp[lvl] = best ?? { ...dp[0], targetLevel: lvl };
  }

  // Step 2: Philosopher's Mirror DP optimization for levels 3..targetLevel
  const mirrorPrice = getBasePrice("/items/philosophers_mirror");
  if (mirrorPrice > 0) {
    let firstMirrorLevel: number | null = null;
    for (let lvl = 3; lvl <= targetLevel; lvl++) {
      const low = dp[lvl - 2];
      const high = dp[lvl - 1];
      const combinedCost = low.totalCost + high.totalCost + mirrorPrice;
      if (combinedCost < dp[lvl].totalCost) {
        if (firstMirrorLevel === null) firstMirrorLevel = lvl;
        dp[lvl] = {
          targetLevel: lvl,
          basePrice,
          baseCount: low.baseCount + high.baseCount,
          perActionMaterialCost,
          attempts: low.attempts + high.attempts,
          perActionTimeSec,
          totalTimeHours: low.totalTimeHours + high.totalTimeHours,
          materialCost: low.materialCost + high.materialCost,
          protectionCount: low.protectionCount + high.protectionCount,
          protectionCost: low.protectionCost + high.protectionCost,
          protectFrom: high.protectFrom || low.protectFrom,
          protectItemHrid,
          mirrorCount: low.mirrorCount + high.mirrorCount + 1,
          mirrorCost: low.mirrorCost + high.mirrorCost + mirrorPrice,
          mirrorStartLevel: firstMirrorLevel,
          teaCostPerHour,
          teaCost: low.teaCost + high.teaCost,
          totalCost: combinedCost,
        };
      }
    }
  }

  return dp[targetLevel] ?? null;
}

/** Creates market price resolvers that guard against illiquid 1.3x+ ask markups via production cost & bid fallbacks. */
export function createRealisticPriceResolvers(clientData: any, marketStore: MarketStore) {
  const prodCostCache = new Map<string, number>();
  let recipeIndex: Map<string, any> | null = null;

  const getProductionCost = (itemHrid: string, visiting = new Set<string>()): number => {
    if (prodCostCache.has(itemHrid)) return prodCostCache.get(itemHrid)!;
    if (visiting.has(itemHrid)) return 0;

    if (!recipeIndex && clientData?.actionDetailMap) {
      recipeIndex = new Map<string, any>();
      for (const act of Object.values<any>(clientData.actionDetailMap)) {
        const outHrid = act?.outputItems?.[0]?.itemHrid;
        if (outHrid && !recipeIndex.has(outHrid)) {
          recipeIndex.set(outHrid, act);
        }
      }
    }

    const action = recipeIndex?.get(itemHrid);
    if (!action) {
      prodCostCache.set(itemHrid, 0);
      return 0;
    }

    visiting.add(itemHrid);
    let total = 0;
    if (Array.isArray(action.inputItems)) {
      for (const inp of action.inputItems) {
        const p = marketStore.getPrice(inp.itemHrid, 0);
        let unit = p?.ask && p.ask > 0 ? p.ask : p?.bid && p.bid > 0 ? p.bid : 0;
        if (unit <= 0) unit = getProductionCost(inp.itemHrid, visiting);
        total += unit * (inp.count || 0);
      }
    }
    total *= 0.9;
    if (action.upgradeItemHrid) {
      const up = marketStore.getPrice(action.upgradeItemHrid, 0);
      let upgradeUnit = up?.ask && up.ask > 0 ? up.ask : up?.bid && up.bid > 0 ? up.bid : 0;
      if (upgradeUnit <= 0) upgradeUnit = getProductionCost(action.upgradeItemHrid, visiting);
      total += upgradeUnit;
    }

    const outCount = action.outputItems?.[0]?.count || 1;
    const perUnit = outCount > 0 ? total / outCount : 0;
    visiting.delete(itemHrid);
    prodCostCache.set(itemHrid, perUnit);
    return perUnit;
  };

  const getBasePrice = (hrid: string): number => {
    if (hrid === "/items/coin") return 1;
    if (hrid.startsWith("/items/trainee_")) return 250_000;
    const p = marketStore.getPrice(hrid, 0);
    const ask = p?.ask && p.ask > 0 ? p.ask : 0;
    const bid = p?.bid && p.bid > 0 ? p.bid : 0;
    const prod = getProductionCost(hrid);

    if (ask > 0 && bid > 0) return ask / bid > 1.3 ? Math.max(bid, prod) : ask;
    if (ask > 0) return prod > 0 && ask / prod > 1.3 ? prod : Math.max(ask, prod);
    if (bid > 0) return Math.max(bid, prod);
    return prod;
  };

  const getMaterialAsk = (hrid: string): number => {
    if (hrid === "/items/coin") return 1;
    if (hrid.startsWith("/items/trainee_")) return 250_000;
    const p = marketStore.getPrice(hrid, 0);
    const ask = p?.ask && p.ask > 0 ? p.ask : 0;
    const bid = p?.bid && p.bid > 0 ? p.bid : 0;
    if (ask > 0 && bid > 0) return ask / bid > 1.3 ? bid : ask;
    if (ask > 0) return ask;
    if (bid > 0) return bid;
    return getProductionCost(hrid) || clientData?.itemDetailMap?.[hrid]?.sellPrice || 0;
  };

  return { getBasePrice, getMaterialAsk };
}
