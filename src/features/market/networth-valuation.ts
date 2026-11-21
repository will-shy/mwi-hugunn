import type { GameDataAPI, MarketStore } from "../../core/types";
import { getEnhancementStatMultiplier, solveEnhancementMarkov } from "./enhancement-math";

export type NetWorthPricingMode = "ask" | "bid";

export interface NetWorthBreakdown {
  pricingMode: NetWorthPricingMode;
  coins: number;
  inventory: number;
  equipped: number;
  listings: number;
  currentAssets: number;
  houses: number;
  abilities: number;
  abilityBooks: number;
  fixedAssets: number;
  total: number;
}

const MARKET_TAX = 0.02;
const COWBELL_BAG_TAX = 0.18;
const HIGH_ENH_MIN_LEVEL = 13;

const STARTER_ABILITIES = [
  "poke",
  "scratch",
  "smack",
  "quick_shot",
  "water_strike",
  "fireball",
  "entangle",
  "minor_heal",
];

const DUNGEON_CHEST_KEYS: Record<string, string> = {
  "/items/chimerical_chest": "/items/chimerical_chest_key",
  "/items/sinister_chest": "/items/sinister_chest_key",
  "/items/enchanted_chest": "/items/enchanted_chest_key",
  "/items/pirate_chest": "/items/pirate_chest_key",
  "/items/chimerical_refinement_chest": "/items/chimerical_chest_key",
  "/items/sinister_refinement_chest": "/items/sinister_chest_key",
  "/items/enchanted_refinement_chest": "/items/enchanted_chest_key",
  "/items/pirate_refinement_chest": "/items/pirate_chest_key",
};

const DUNGEON_TOKENS = new Set([
  "/items/chimerical_token",
  "/items/sinister_token",
  "/items/enchanted_token",
  "/items/pirate_token",
]);

/** Computes Toolasha-aligned Net Worth breakdown across current & fixed assets. */
export class ToolashaNetworthEvaluator {
  private containerEvCache = new Map<string, number>();
  private prodCostCache = new Map<string, number>();
  private enhancementCostCache = new Map<string, number>();
  private recipeIndex: Map<string, any> | null = null;
  private cachePricingMode: NetWorthPricingMode = "ask";

  invalidate(): void {
    this.containerEvCache.clear();
    this.prodCostCache.clear();
    this.enhancementCostCache.clear();
  }

  private getWeightedMidPrice(marketStore: MarketStore, itemHrid: string): number {
    const p = marketStore.getPrice(itemHrid, 0);
    if (!p) return 0;
    let ask = p.ask ?? -1;
    let bid = p.bid ?? -1;
    if (ask > 0 && bid <= 0) bid = ask;
    if (bid > 0 && ask <= 0) ask = bid;
    if (ask <= 0 && bid <= 0) return 0;
    return (ask + bid) / 2;
  }

  private getProductionCost(
    itemHrid: string,
    clientData: any,
    marketStore: MarketStore,
    visiting = new Set<string>()
  ): number {
    if (this.prodCostCache.has(itemHrid)) return this.prodCostCache.get(itemHrid)!;
    if (visiting.has(itemHrid)) return 0;

    if (!this.recipeIndex && clientData?.actionDetailMap) {
      this.recipeIndex = new Map<string, any>();
      for (const act of Object.values<any>(clientData.actionDetailMap)) {
        const outHrid = act?.outputItems?.[0]?.itemHrid;
        if (outHrid && !this.recipeIndex.has(outHrid)) {
          this.recipeIndex.set(outHrid, act);
        }
      }
    }

    const action = this.recipeIndex?.get(itemHrid);
    if (!action) {
      this.prodCostCache.set(itemHrid, 0);
      return 0;
    }

    visiting.add(itemHrid);
    let total = 0;

    if (Array.isArray(action.inputItems)) {
      for (const inp of action.inputItems) {
        const p = marketStore.getPrice(inp.itemHrid, 0);
        let unit = p?.ask && p.ask > 0 ? p.ask : 0;
        if (unit <= 0) {
          unit = this.getProductionCost(inp.itemHrid, clientData, marketStore, visiting);
        }
        total += unit * (inp.count || 0);
      }
    }

    // Toolasha applies Artisan Tea reduction (0.9x) to input materials
    total *= 0.9;

    if (action.upgradeItemHrid) {
      const up = marketStore.getPrice(action.upgradeItemHrid, 0);
      let upgradeUnit = up?.ask && up.ask > 0 ? up.ask : 0;
      if (upgradeUnit <= 0) {
        upgradeUnit = this.getProductionCost(action.upgradeItemHrid, clientData, marketStore, visiting);
      }
      total += upgradeUnit;
    }

    const outCount = action.outputItems?.[0]?.count || 1;
    const perUnit = outCount > 0 ? total / outCount : 0;
    visiting.delete(itemHrid);
    this.prodCostCache.set(itemHrid, perUnit);
    return perUnit;
  }

  private getRealisticBasePrice(itemHrid: string, clientData: any, marketStore: MarketStore): number {
    if (itemHrid === "/items/coin") return 1;
    if (itemHrid.startsWith("/items/trainee_")) return 250_000;

    const p = marketStore.getPrice(itemHrid, 0);
    const ask = p?.ask && p.ask > 0 ? p.ask : 0;
    const bid = p?.bid && p.bid > 0 ? p.bid : 0;
    const prod = this.getProductionCost(itemHrid, clientData, marketStore);

    if (ask > 0 && bid > 0) {
      return ask / bid > 1.3 ? Math.max(bid, prod) : ask;
    }
    if (ask > 0) {
      return prod > 0 && ask / prod > 1.3 ? prod : Math.max(ask, prod);
    }
    if (bid > 0) {
      return Math.max(bid, prod);
    }
    return prod;
  }

  private getShopCoinCost(itemHrid: string, clientData: any): number {
    const shopMap = clientData?.shopItemDetailMap;
    if (!shopMap) return 0;
    for (const shopItem of Object.values<any>(shopMap)) {
      if (shopItem?.itemHrid !== itemHrid || !Array.isArray(shopItem.costs)) continue;
      const coinCost = shopItem.costs.find((c: any) => c.itemHrid === "/items/coin");
      if (coinCost?.count > 0) return coinCost.count;
    }
    return 0;
  }

  private ensureContainerEvs(clientData: any, marketStore: MarketStore, mode: NetWorthPricingMode): void {
    if (this.containerEvCache.size > 0 && this.cachePricingMode === mode) return;
    this.cachePricingMode = mode;
    this.containerEvCache.clear();

    const dropMap = clientData?.openableLootDropMap;
    if (!dropMap) return;

    for (let pass = 0; pass < 3; pass++) {
      for (const [containerHrid, table] of Object.entries<any[]>(dropMap)) {
        if (!Array.isArray(table)) continue;
        let ev = 0;
        for (const drop of table) {
          const rate = drop.dropRate || 0;
          const avgCnt = ((drop.minCount || 0) + (drop.maxCount || 0)) / 2;
          if (rate <= 0 || avgCnt <= 0) continue;

          let unitVal = 0;
          if (drop.itemHrid === "/items/coin") {
            unitVal = 1;
          } else {
            const p = marketStore.getPrice(drop.itemHrid, 0);
            const marketVal = p?.[mode] && p[mode]! > 0 ? p[mode]! : p?.ask ?? p?.bid ?? 0;
            const raw = marketVal > 0 ? marketVal : this.containerEvCache.get(drop.itemHrid) ?? 0;
            const detail = clientData?.itemDetailMap?.[drop.itemHrid];
            const tradable = detail && detail.isTradable !== false;
            unitVal = tradable ? raw * (1 - MARKET_TAX) : raw;
          }
          ev += rate * avgCnt * unitVal;
        }
        this.containerEvCache.set(containerHrid, ev);
      }
    }
  }

  private getCurrencyValue(
    itemHrid: string,
    clientData: any,
    marketStore: MarketStore,
    mode: NetWorthPricingMode
  ): number | null {
    if (itemHrid === "/items/coin") return 1;

    if (itemHrid === "/items/task_token") {
      this.ensureContainerEvs(clientData, marketStore, mode);
      const taskShopItems = [
        "/items/large_meteorite_cache",
        "/items/large_artisans_crate",
        "/items/large_treasure_chest",
      ];
      let best = 0;
      for (const hrid of taskShopItems) {
        const ev = this.containerEvCache.get(hrid) || 0;
        if (ev > best) best = ev;
      }
      return best > 0 ? best / 30 : 30_000;
    }

    if (DUNGEON_TOKENS.has(itemHrid)) {
      this.ensureContainerEvs(clientData, marketStore, mode);
      const shopMap = clientData?.shopItemDetailMap;
      if (!shopMap) return 0;
      let bestGpt = 0;
      for (const shopItem of Object.values<any>(shopMap)) {
        if (!Array.isArray(shopItem?.costs)) continue;
        const tokCost = shopItem.costs.find((c: any) => c.itemHrid === itemHrid);
        if (!tokCost || !tokCost.count) continue;
        const p = marketStore.getPrice(shopItem.itemHrid, 0);
        const raw = (p?.[mode] && p[mode]! > 0 ? p[mode]! : p?.ask ?? p?.bid ?? 0) * (1 - MARKET_TAX);
        const val = raw > 0 ? raw : this.containerEvCache.get(shopItem.itemHrid) ?? 0;
        const gpt = val / tokCost.count;
        if (gpt > bestGpt) bestGpt = gpt;
      }
      return bestGpt;
    }

    return null;
  }

  private getDefaultEnhancingSetup(clientData: any): {
    enhancingLevel: number;
    toolBonus: number;
    guzzlingBonus: number;
  } {
    // Matches Toolasha's default enhanceSim parameters (house 8, enhancing 140, ultra tea +8, guzzling +10, celestial +13)
    const itemMap = clientData?.itemDetailMap || {};
    const enhancer = itemMap["/items/celestial_enhancer"];
    const enhancerSuccess = enhancer
      ? (enhancer.equipmentDetail?.noncombatStats?.enhancingSuccess || 0) *
        100 *
        getEnhancementStatMultiplier(enhancer, 13)
      : 14.4;
    const guzzling = itemMap["/items/guzzling_pouch"];
    const guzzlingConc = guzzling
      ? (guzzling.equipmentDetail?.noncombatStats?.drinkConcentration || 0) *
        getEnhancementStatMultiplier(guzzling, 10)
      : 0.129;

    const guzzlingBonus = 1 + guzzlingConc;
    const houseLevel = 8;
    const baseEnhancingLevel = 140;
    const teaLevelBonus = 8 * guzzlingBonus;
    const enhancingLevel = baseEnhancingLevel + teaLevelBonus;
    const houseSuccessBonus = houseLevel * 0.05;
    return {
      enhancingLevel,
      toolBonus: enhancerSuccess + houseSuccessBonus,
      guzzlingBonus,
    };
  }

  private getEnhancementCost(
    itemHrid: string,
    targetLevel: number,
    clientData: any,
    marketStore: MarketStore
  ): number | null {
    const cacheKey = `${itemHrid}:${targetLevel}`;
    if (this.enhancementCostCache.has(cacheKey)) {
      return this.enhancementCostCache.get(cacheKey)!;
    }

    const itemDetails = clientData?.itemDetailMap?.[itemHrid];
    if (!itemDetails?.enhancementCosts?.length || targetLevel < 1 || targetLevel > 20) {
      return null;
    }

    const itemLevel = itemDetails.itemLevel || 1;
    const setup = this.getDefaultEnhancingSetup(clientData);

    // Per-attempt material cost
    let perActionCost = 0;
    for (const mat of itemDetails.enhancementCosts) {
      let unitPrice = 0;
      if (mat.itemHrid === "/items/coin") {
        unitPrice = 1;
      } else if (mat.itemHrid.startsWith("/items/trainee_")) {
        unitPrice = 250_000;
      } else {
        const mp = marketStore.getPrice(mat.itemHrid, 0);
        if (mp) {
          let ask = mp.ask ?? -1;
          let bid = mp.bid ?? -1;
          if (ask > 0 && bid < 0) bid = ask;
          if (bid > 0 && ask < 0) ask = bid;
          unitPrice = ask > 0 ? ask : 0;
        }
        if (unitPrice <= 0) {
          unitPrice =
            this.getProductionCost(mat.itemHrid, clientData, marketStore) ||
            itemDetails?.sellPrice ||
            0;
        }
      }
      perActionCost += unitPrice * (mat.count || 0);
    }

    // Cheapest protection item
    const protOptions: string[] = [itemHrid, "/items/mirror_of_protection"];
    if (Array.isArray(itemDetails.protectionItemHrids)) {
      protOptions.push(...itemDetails.protectionItemHrids);
    }
    let cheapestProt = Infinity;
    for (const protHrid of protOptions) {
      const p = this.getRealisticBasePrice(protHrid, clientData, marketStore);
      if (p > 0 && p < cheapestProt) cheapestProt = p;
    }
    const protectPrice = cheapestProt === Infinity ? 0 : cheapestProt;

    const targetCosts = new Array<number>(targetLevel + 1).fill(0);
    targetCosts[0] = this.getRealisticBasePrice(itemHrid, clientData, marketStore);

    for (let lvl = 1; lvl <= targetLevel; lvl++) {
      let bestCost = Infinity;
      const strategies = [0];
      for (let p = 2; p <= lvl; p++) strategies.push(p);

      for (const protectFrom of strategies) {
        const res = solveEnhancementMarkov(
          setup.enhancingLevel,
          setup.toolBonus,
          itemLevel,
          lvl,
          protectFrom,
          true,
          setup.guzzlingBonus
        );
        if (!res) continue;
        const matCost = perActionCost * res.attempts;
        const protCost = protectFrom > 0 && res.protectionCount > 0 ? protectPrice * res.protectionCount : 0;
        const total = targetCosts[0] + matCost + protCost;
        if (total < bestCost) bestCost = total;
      }
      targetCosts[lvl] = bestCost === Infinity ? targetCosts[0] : bestCost;
    }

    // Philosopher's Mirror optimization (level 3+)
    const mirrorPrice = this.getRealisticBasePrice("/items/philosophers_mirror", clientData, marketStore);
    if (mirrorPrice > 0) {
      for (let lvl = 3; lvl <= targetLevel; lvl++) {
        const mirrorCost = targetCosts[lvl - 2] + targetCosts[lvl - 1] + mirrorPrice;
        if (mirrorCost < targetCosts[lvl]) {
          targetCosts[lvl] = mirrorCost;
        }
      }
    }

    for (let lvl = 1; lvl <= targetLevel; lvl++) {
      this.enhancementCostCache.set(`${itemHrid}:${lvl}`, targetCosts[lvl]);
    }
    return targetCosts[targetLevel];
  }

  getUnitValue(
    itemHrid: string,
    enhancementLevel: number,
    clientData: any,
    marketStore: MarketStore,
    mode: NetWorthPricingMode
  ): number {
    const currencyVal = this.getCurrencyValue(itemHrid, clientData, marketStore, mode);
    if (currencyVal !== null) return currencyVal;

    if (enhancementLevel >= 1) {
      if (enhancementLevel >= HIGH_ENH_MIN_LEVEL) {
        const enhCost = this.getEnhancementCost(itemHrid, enhancementLevel, clientData, marketStore);
        if (enhCost !== null && enhCost > 0) return enhCost;
      } else {
        const mp = marketStore.getPrice(itemHrid, enhancementLevel);
        const direct = mp?.[mode];
        if (direct && direct > 0) return direct;

        const enhCost = this.getEnhancementCost(itemHrid, enhancementLevel, clientData, marketStore);
        if (enhCost !== null && enhCost > 0) return enhCost;
      }
      // Fallback to base item price
      return this.getUnitValue(itemHrid, 0, clientData, marketStore, mode);
    }

    const mp = marketStore.getPrice(itemHrid, 0);
    const direct = mp?.[mode];
    if (direct && direct > 0) return direct;

    const itemDetails = clientData?.itemDetailMap?.[itemHrid];
    if (itemDetails?.isOpenable) {
      this.ensureContainerEvs(clientData, marketStore, mode);
      let ev = this.containerEvCache.get(itemHrid) || 0;
      if (ev > 0) {
        const keyHrid = DUNGEON_CHEST_KEYS[itemHrid];
        if (keyHrid) {
          const kp = marketStore.getPrice(keyHrid, 0);
          ev -= kp?.[mode] ?? kp?.ask ?? 0;
        }
        if (ev > 0) return ev;
      }
    }

    const prodCost = this.getProductionCost(itemHrid, clientData, marketStore);
    if (prodCost > 0) return prodCost;

    return this.getShopCoinCost(itemHrid, clientData);
  }

  private computeHousesValue(gameData: GameDataAPI, clientData: any, marketStore: MarketStore): number {
    const houseRoomDetailMap = clientData?.houseRoomDetailMap;
    if (!houseRoomDetailMap) return 0;
    const rooms = gameData.getHouseRooms();
    let total = 0;

    for (const [roomHrid, data] of rooms.entries()) {
      const level = data?.level || 0;
      if (level <= 0) continue;
      const upgradeCostsMap = houseRoomDetailMap[roomHrid]?.upgradeCostsMap;
      if (!upgradeCostsMap) continue;

      for (let lv = 1; lv <= level; lv++) {
        const reqs = upgradeCostsMap[lv];
        if (!Array.isArray(reqs)) continue;
        for (const req of reqs) {
          if (req.itemHrid === "/items/coin") {
            total += req.count || 0;
          } else {
            const unit = this.getWeightedMidPrice(marketStore, req.itemHrid);
            total += (req.count || 0) * unit;
          }
        }
      }
    }
    return total;
  }

  private computeAbilitiesValue(gameData: GameDataAPI, clientData: any, marketStore: MarketStore): number {
    const abilities = gameData.getCharacterAbilities();
    const xpTable = clientData?.levelExperienceTable;
    if (!Array.isArray(abilities) || !xpTable) return 0;

    let total = 0;
    for (const ab of abilities) {
      if (!ab?.abilityHrid || !ab.level || ab.level <= 0) continue;
      const targetXp = xpTable[ab.level] || 0;
      const isStarter = STARTER_ABILITIES.some((s) => ab.abilityHrid.includes(s));
      const xpPerBook = isStarter ? 50 : 500;
      const booksNeeded = targetXp / xpPerBook + 1;
      const bookItemHrid = ab.abilityHrid.replace("/abilities/", "/items/");
      const weightedPrice = this.getWeightedMidPrice(marketStore, bookItemHrid);
      total += booksNeeded * weightedPrice;
    }
    return total;
  }

  compute(
    gameData: GameDataAPI,
    marketStore: MarketStore,
    mode: NetWorthPricingMode
  ): NetWorthBreakdown {
    const clientData = gameData.getClientData();
    const items = gameData.getCharacterItems();
    const listings = gameData.getMarketListings();
    const itemDetailMap = clientData?.itemDetailMap || {};

    let coins = 0;
    let inventory = 0;
    let equipped = 0;
    let abilityBooks = 0;
    let listingsVal = 0;

    for (const item of items) {
      if (!item || !item.count || item.count <= 0) continue;
      if (item.itemHrid === "/items/coin") {
        coins += item.count;
        continue;
      }

      const unitVal = this.getUnitValue(
        item.itemHrid,
        item.enhancementLevel || 0,
        clientData,
        marketStore,
        mode
      );
      const val = unitVal * item.count;

      if (item.itemLocationHrid === "/item_locations/inventory") {
        const categoryHrid = itemDetailMap[item.itemHrid]?.categoryHrid;
        if (categoryHrid === "/item_categories/ability_book") {
          abilityBooks += val;
        } else {
          inventory += val;
        }
      } else {
        equipped += val;
      }
    }

    for (const l of listings) {
      if (!l) continue;
      const remaining = Math.max(0, (l.orderQuantity || 0) - (l.filledQuantity || 0));
      if (l.isSell) {
        const fee = l.itemHrid === "/items/bag_of_10_cowbells" ? COWBELL_BAG_TAX : MARKET_TAX;
        const unitVal = this.getUnitValue(
          l.itemHrid,
          l.enhancementLevel || 0,
          clientData,
          marketStore,
          mode
        );
        listingsVal += remaining * unitVal * (1 - fee) + (l.unclaimedCoinCount || 0);
      } else {
        const unclaimedVal =
          (l.unclaimedItemCount || 0) *
          this.getUnitValue(l.itemHrid, l.enhancementLevel || 0, clientData, marketStore, mode);
        listingsVal += remaining * (l.price || 0) + unclaimedVal;
      }
    }

    const houses = this.computeHousesValue(gameData, clientData, marketStore);
    const abilities = this.computeAbilitiesValue(gameData, clientData, marketStore);

    const currentAssets = coins + inventory + equipped + listingsVal;
    const fixedAssets = houses + abilities + abilityBooks;

    return {
      pricingMode: mode,
      coins,
      inventory,
      equipped,
      listings: listingsVal,
      currentAssets,
      houses,
      abilities,
      abilityBooks,
      fixedAssets,
      total: currentAssets + fixedAssets,
    };
  }
}
