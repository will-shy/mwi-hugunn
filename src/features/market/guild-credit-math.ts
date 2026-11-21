import type { MarketStore } from "../../core/types";

export interface GuildCreditMeta {
  readonly hrid: string;
  readonly iconId: string;
  readonly shortZh: string;
  readonly shortEn: string;
  readonly color: string;
}

export const GUILD_CREDIT_ORDER: readonly GuildCreditMeta[] = [
  { hrid: "/items/green_guild_credit", iconId: "green_guild_credit", shortZh: "绿", shortEn: "Green", color: "#4ade80" },
  { hrid: "/items/brown_guild_credit", iconId: "brown_guild_credit", shortZh: "棕", shortEn: "Brown", color: "#d97706" },
  { hrid: "/items/white_guild_credit", iconId: "white_guild_credit", shortZh: "白", shortEn: "White", color: "#e2e8f0" },
  { hrid: "/items/blue_guild_credit", iconId: "blue_guild_credit", shortZh: "蓝", shortEn: "Blue", color: "#60a5fa" },
  { hrid: "/items/purple_guild_credit", iconId: "purple_guild_credit", shortZh: "紫", shortEn: "Purple", color: "#c084fc" },
  { hrid: "/items/red_guild_credit", iconId: "red_guild_credit", shortZh: "红", shortEn: "Red", color: "#f87171" },
  { hrid: "/items/silver_guild_credit", iconId: "silver_guild_credit", shortZh: "银", shortEn: "Silver", color: "#cbd5e1" },
  { hrid: "/items/gold_guild_credit", iconId: "gold_guild_credit", shortZh: "金", shortEn: "Gold", color: "#facc15" },
] as const;

export const GUILD_CREDIT_META_MAP = new Map<string, GuildCreditMeta>(
  GUILD_CREDIT_ORDER.map((m) => [m.hrid, m])
);

export interface GuildCreditConversionSpec {
  readonly creditItemHrid: string;
  readonly itemHrid: string;
  readonly itemCount: number;
  readonly creditCount: number;
  readonly creditsPerItem: number;
  readonly isTradable: boolean;
  readonly fallbackName: string;
  readonly sortIndex: number;
}

export type GuildCreditCatalog = Map<string, GuildCreditConversionSpec[]>;

export type CreditSortKey = "askPerCredit" | "bidPerCredit" | "askPrice" | "bidPrice" | "rate" | "owned";
export type SortDirection = "asc" | "desc";

export interface RankedCreditItem {
  readonly itemHrid: string;
  readonly creditItemHrid: string;
  readonly itemCount: number;
  readonly creditCount: number;
  readonly creditsPerItem: number;
  readonly isTradable: boolean;
  readonly askPrice: number | null;
  readonly bidPrice: number | null;
  readonly askPerCredit: number | null;
  readonly bidPerCredit: number | null;
  readonly owned: number;
  readonly sortIndex: number;
}

export interface CreditRankQuery {
  readonly creditItemHrid: string;
  readonly sortBy: CreditSortKey;
  readonly sortDir: SortDirection;
  readonly tradableOnly?: boolean;
  readonly ownedOnly?: boolean;
  readonly searchText?: string;
  readonly resolveName?: (itemHrid: string) => string;
  readonly limit?: number;
}

export interface CreditNeedSpec {
  readonly creditItemHrid: string;
  readonly owned: number;
  readonly required: number;
}

export interface BuffUpgradeOptionRow {
  readonly itemHrid: string;
  readonly itemCount: number;
  readonly creditCount: number;
  readonly neededItems: number;
  readonly askPrice: number | null;
  readonly bidPrice: number | null;
  readonly askPerCredit: number | null;
  readonly bidPerCredit: number | null;
  readonly askCost: number | null;
  readonly bidCost: number | null;
  readonly owned: number;
}

export interface BuffCreditUpgradeSummary {
  readonly creditItemHrid: string;
  readonly owned: number;
  readonly required: number;
  readonly deficit: number;
  readonly bestAskCost: number | null;
  readonly bestBidCost: number | null;
  readonly topOptions: BuffUpgradeOptionRow[];
}

const catalogCache = new WeakMap<object, GuildCreditCatalog>();

/** Parse MWI compact numbers like "30K", "1.5M", "2.3B", "5,072". */
export function parseCompactNumber(raw: string | null | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/,/g, "").replace(/[^\d.KMB]/gi, "").toUpperCase();
  if (!cleaned) return 0;
  const mult = cleaned.endsWith("B") ? 1e9 : cleaned.endsWith("M") ? 1e6 : cleaned.endsWith("K") ? 1e3 : 1;
  const num = parseFloat(cleaned.replace(/[KMB]/g, ""));
  return Number.isFinite(num) ? Math.round(num * mult) : 0;
}

/** Format coin values compactly for tables and badges. */
export function formatCompactCoins(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val) || val <= 0) return "-";
  if (val >= 1e9) return `${(val / 1e9).toFixed(val >= 1e11 ? 0 : 2)}B`;
  if (val >= 1e6) return `${(val / 1e6).toFixed(val >= 1e8 ? 0 : 1)}M`;
  if (val >= 1e3) return `${(val / 1e3).toFixed(val >= 1e5 ? 0 : 1)}K`;
  if (val >= 100) return `${Math.round(val)}`;
  if (val >= 10) return val.toFixed(1);
  return val.toFixed(2);
}

/** Build and memoize guild credit conversion catalog from static init_client_data. */
export function buildGuildCreditCatalog(clientData: any): GuildCreditCatalog {
  if (!clientData || typeof clientData !== "object") {
    return new Map();
  }
  const cached = catalogCache.get(clientData);
  if (cached) return cached;

  const catalog: GuildCreditCatalog = new Map();
  for (const meta of GUILD_CREDIT_ORDER) {
    catalog.set(meta.hrid, []);
  }

  const itemMap = clientData.itemDetailMap;
  if (itemMap && typeof itemMap === "object") {
    for (const [itemHrid, detail] of Object.entries<any>(itemMap)) {
      const conversions = detail?.guildCreditConversions;
      if (!Array.isArray(conversions) || conversions.length === 0) continue;

      for (const conv of conversions) {
        const creditItemHrid = conv?.creditItemHrid;
        const itemCount = Number(conv?.itemCount);
        const creditCount = Number(conv?.creditCount);
        if (
          typeof creditItemHrid !== "string" ||
          !creditItemHrid ||
          !Number.isFinite(itemCount) ||
          itemCount <= 0 ||
          !Number.isFinite(creditCount) ||
          creditCount <= 0
        ) {
          continue;
        }

        let bucket = catalog.get(creditItemHrid);
        if (!bucket) {
          bucket = [];
          catalog.set(creditItemHrid, bucket);
        }
        bucket.push({
          creditItemHrid,
          itemHrid,
          itemCount,
          creditCount,
          creditsPerItem: creditCount / itemCount,
          isTradable: detail?.isTradable !== false,
          fallbackName: typeof detail?.name === "string" ? detail.name : itemHrid,
          sortIndex: typeof detail?.sortIndex === "number" ? detail.sortIndex : 999999,
        });
      }
    }
  }

  catalogCache.set(clientData, catalog);
  return catalog;
}

/** Build inventory item counts (location = inventory) keyed by itemHrid. */
export function buildInventoryCountMap(characterItems: readonly any[]): Map<string, number> {
  const counts = new Map<string, number>();
  if (!Array.isArray(characterItems)) return counts;
  for (let i = 0; i < characterItems.length; i++) {
    const it = characterItems[i];
    if (!it || it.count <= 0 || it.itemLocationHrid !== "/item_locations/inventory") continue;
    counts.set(it.itemHrid, (counts.get(it.itemHrid) || 0) + Number(it.count));
  }
  return counts;
}

function getSortableMetric(row: RankedCreditItem, key: CreditSortKey): number | null {
  switch (key) {
    case "askPerCredit":
      return row.askPerCredit;
    case "bidPerCredit":
      return row.bidPerCredit;
    case "askPrice":
      return row.askPrice;
    case "bidPrice":
      return row.bidPrice;
    case "rate":
      return row.creditsPerItem;
    case "owned":
      return row.owned;
  }
}

/** Compute and sort credit conversion items by unit credit cost or inventory metrics. */
export function rankGuildCreditItems(
  catalog: GuildCreditCatalog,
  marketStore: Pick<MarketStore, "getPrice">,
  inventoryCounts: ReadonlyMap<string, number>,
  query: CreditRankQuery
): RankedCreditItem[] {
  const specs = catalog.get(query.creditItemHrid);
  if (!specs || specs.length === 0) return [];

  const q = query.searchText?.trim().toLowerCase() || "";
  const tradableOnly = query.tradableOnly ?? true;
  const ownedOnly = query.ownedOnly ?? false;
  const out: RankedCreditItem[] = [];

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    if (tradableOnly && !spec.isTradable) continue;
    const owned = inventoryCounts.get(spec.itemHrid) || 0;
    if (ownedOnly && owned <= 0) continue;

    if (q) {
      const displayName = (query.resolveName ? query.resolveName(spec.itemHrid) : spec.fallbackName).toLowerCase();
      if (!displayName.includes(q) && !spec.itemHrid.toLowerCase().includes(q)) {
        continue;
      }
    }

    const price = marketStore.getPrice(spec.itemHrid, 0);
    const askPrice = price?.ask && price.ask > 0 ? price.ask : null;
    const bidPrice = price?.bid && price.bid > 0 ? price.bid : null;

    out.push({
      itemHrid: spec.itemHrid,
      creditItemHrid: spec.creditItemHrid,
      itemCount: spec.itemCount,
      creditCount: spec.creditCount,
      creditsPerItem: spec.creditsPerItem,
      isTradable: spec.isTradable,
      askPrice,
      bidPrice,
      askPerCredit: askPrice !== null ? (askPrice * spec.itemCount) / spec.creditCount : null,
      bidPerCredit: bidPrice !== null ? (bidPrice * spec.itemCount) / spec.creditCount : null,
      owned,
      sortIndex: spec.sortIndex,
    });
  }

  const dir = query.sortDir === "desc" ? -1 : 1;
  out.sort((a, b) => {
    const va = getSortableMetric(a, query.sortBy);
    const vb = getSortableMetric(b, query.sortBy);
    if (va === null && vb === null) return a.sortIndex - b.sortIndex;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (va !== vb) return (va - vb) * dir;
    // Tie-break by secondary market price, then sortIndex
    const secA = query.sortBy === "bidPerCredit" ? a.askPerCredit : a.bidPerCredit;
    const secB = query.sortBy === "bidPerCredit" ? b.askPerCredit : b.bidPerCredit;
    if (secA !== null && secB !== null && secA !== secB) return secA - secB;
    return a.sortIndex - b.sortIndex;
  });

  if (query.limit && query.limit > 0 && out.length > query.limit) {
    return out.slice(0, query.limit);
  }
  return out;
}

/** Evaluate credit deficit & cheapest exchange items for a Guild Shrine Buff upgrade. */
export function evaluateGuildBuffUpgrade(
  needs: readonly CreditNeedSpec[],
  catalog: GuildCreditCatalog,
  marketStore: Pick<MarketStore, "getPrice">,
  inventoryCounts: ReadonlyMap<string, number>,
  sortMode: "ask" | "bid" = "ask",
  topN = 3
): { rows: BuffCreditUpgradeSummary[]; totalAsk: number; totalBid: number } {
  const sortBy: CreditSortKey = sortMode === "bid" ? "bidPerCredit" : "askPerCredit";
  const rows: BuffCreditUpgradeSummary[] = [];
  let totalAsk = 0;
  let totalBid = 0;

  for (const need of needs) {
    const deficit = Math.max(0, need.required - need.owned);
    const ranked = rankGuildCreditItems(catalog, marketStore, inventoryCounts, {
      creditItemHrid: need.creditItemHrid,
      sortBy,
      sortDir: "asc",
      tradableOnly: true,
      limit: topN,
    });

    const topOptions: BuffUpgradeOptionRow[] = ranked.map((r) => {
      const batches = deficit > 0 ? Math.ceil(deficit / r.creditCount) : 0;
      const neededItems = batches * r.itemCount;
      const askCost = r.askPrice !== null && neededItems > 0 ? neededItems * r.askPrice : null;
      const bidCost = r.bidPrice !== null && neededItems > 0 ? neededItems * r.bidPrice : null;
      return {
        itemHrid: r.itemHrid,
        itemCount: r.itemCount,
        creditCount: r.creditCount,
        neededItems,
        askPrice: r.askPrice,
        bidPrice: r.bidPrice,
        askPerCredit: r.askPerCredit,
        bidPerCredit: r.bidPerCredit,
        askCost,
        bidCost,
        owned: r.owned,
      };
    });

    const bestAskCost = topOptions[0]?.askCost ?? null;
    const bestBidCost = topOptions[0]?.bidCost ?? null;
    if (bestAskCost !== null && bestAskCost > 0) totalAsk += bestAskCost;
    if (bestBidCost !== null && bestBidCost > 0) totalBid += bestBidCost;

    rows.push({
      creditItemHrid: need.creditItemHrid,
      owned: need.owned,
      required: need.required,
      deficit,
      bestAskCost,
      bestBidCost,
      topOptions,
    });
  }

  return { rows, totalAsk, totalBid };
}
