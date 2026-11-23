import type { MarketPriceEntry, MarketStore, MarketVolumeStats } from "./types";
import { wsBus } from "./ws-bus";

declare const GM_xmlhttpRequest:
  | ((opts: {
      method?: string;
      url: string;
      timeout?: number;
      onload?: (res: { status: number; responseText: string }) => void;
      onerror?: (err: any) => void;
      ontimeout?: () => void;
    }) => void)
  | undefined;

const MARKET_API_FALLBACK_URLS = [
  "https://www.milkywayidlecn.com/game_data/marketplace.json",
  "https://www.milkywayidle.com/game_data/marketplace.json",
];
const Q7_API_HOST = "https://q7.nainai.eu.org";
const DB_NAME = "MWILiteMarketDB";
const DB_VERSION = 1;
const STORE_PRICES = "prices";
const STORE_VOLUME = "volume";
const PRICES_TTL_MS = 30 * 60 * 1000;
const VOLUME_TTL_MS = 5 * 60 * 1000;

function getMarketApiUrls(): string[] {
  const urls: string[] = [];
  try {
    const { protocol, origin, hostname } = window.location;
    if ((protocol === "https:" || protocol === "http:") && hostname.includes("milkywayidle")) {
      urls.push(`${origin}/game_data/marketplace.json`);
    }
  } catch {
    // Ignore non-browser contexts
  }
  for (const fallback of MARKET_API_FALLBACK_URLS) {
    if (!urls.includes(fallback)) urls.push(fallback);
  }
  return urls;
}

function isValidMarketData(marketData: unknown): marketData is Record<string, Record<string, { a: number; b: number }>> {
  return !!marketData && typeof marketData === "object" && Object.keys(marketData).length > 0;
}

function normalizePrice(val: unknown): number | null {
  return typeof val === "number" && Number.isFinite(val) && val >= 0 ? val : null;
}

async function requestJson(url: string, timeoutMs = 8000): Promise<any> {
  // Prefer GM_xmlhttpRequest for cross-origin endpoints (e.g. q7) when running inside Tampermonkey
  const isCrossOrigin = !url.startsWith(location.origin);
  if (isCrossOrigin && typeof GM_xmlhttpRequest === "function") {
    return await new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        timeout: timeoutMs,
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) {
            try {
              resolve(JSON.parse(res.responseText));
            } catch (err) {
              reject(err);
            }
          } else {
            reject(new Error(`HTTP ${res.status}`));
          }
        },
        onerror: (err) => reject(err || new Error("GM_xmlhttpRequest error")),
        ontimeout: () => reject(new Error("GM_xmlhttpRequest timeout")),
      });
    });
  }

  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class LiteMarketStore implements MarketStore {
  private initialized = false;
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private marketData: Record<string, Record<string, { a: number; b: number }>> | null = null;
  private lastFetchTs = 0;
  private loadingPrices: Promise<boolean> | null = null;
  private livePricePatches = new Map<string, { ask: number | null; bid: number | null; ts: number }>();
  private orderBookCache = new Map<string, { asks: any[]; bids: any[] }>();
  private volumeMemCache = new Map<string, { stats: MarketVolumeStats; ts: number }>();
  private volumePending = new Map<string, Promise<MarketVolumeStats | null>>();
  private listeners = new Set<() => void>();
  private writeCount = 0;

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    wsBus.on("market_item_order_books_updated", (data) => {
      const itemHrid = data?.marketItemOrderBooks?.itemHrid;
      const orderBooks = data?.marketItemOrderBooks?.orderBooks;
      if (!itemHrid || !orderBooks) return;

      const entries: Array<[string, any]> = Array.isArray(orderBooks)
        ? orderBooks.map((ob, idx) => [String(idx), ob])
        : Object.entries(orderBooks);

      const now = Date.now();
      for (const [enhKey, ob] of entries) {
        if (!ob) continue;
        const asks = Array.isArray(ob.asks) ? ob.asks : [];
        const bids = Array.isArray(ob.bids) ? ob.bids : [];
        const key = `${itemHrid}:${enhKey}`;
        this.orderBookCache.set(key, { asks, bids });
        if (this.orderBookCache.size > 400) {
          const oldest = this.orderBookCache.keys().next().value;
          if (oldest) this.orderBookCache.delete(oldest);
        }

        const bestAsk = asks.length > 0 && typeof asks[0]?.price === "number" ? asks[0].price : null;
        const bestBid = bids.length > 0 && typeof bids[0]?.price === "number" ? bids[0].price : null;
        this.livePricePatches.set(key, { ask: bestAsk, bid: bestBid, ts: now });
      }
      this.notify();
    });

    // Warm up prices lazily from IndexedDB / network
    void this.ensurePricesLoaded(false);
  }

  private openDB(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;
    if (typeof indexedDB === "undefined") {
      this.dbPromise = Promise.resolve(null);
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_PRICES)) {
            db.createObjectStore(STORE_PRICES, { keyPath: "key" });
          }
          if (!db.objectStoreNames.contains(STORE_VOLUME)) {
            db.createObjectStore(STORE_VOLUME, { keyPath: "key" });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.dbPromise;
  }

  private async idbGet<T = any>(storeName: string, key: string): Promise<T | null> {
    const db = await this.openDB();
    if (!db) return null;
    return await new Promise((resolve) => {
      try {
        const tx = db.transaction([storeName], "readonly");
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve((req.result as T) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private async idbSet(storeName: string, record: any): Promise<void> {
    const db = await this.openDB();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction([storeName], "readwrite");
        tx.objectStore(storeName).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });

    // Lazy eviction on write every 25 writes (no setInterval)
    if (storeName === STORE_VOLUME && ++this.writeCount % 25 === 0) {
      this.evictExpiredVolume(db);
    }
  }

  private evictExpiredVolume(db: IDBDatabase): void {
    try {
      const tx = db.transaction([STORE_VOLUME], "readwrite");
      const store = tx.objectStore(STORE_VOLUME);
      const req = store.openCursor();
      const cutoff = Date.now() - VOLUME_TTL_MS * 3;
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        if ((cursor.value?.ts || 0) < cutoff) {
          cursor.delete();
        }
        cursor.continue();
      };
    } catch {
      // Ignore
    }
  }

  async ensurePricesLoaded(force = false): Promise<boolean> {
    if (!force && this.marketData && Date.now() - this.lastFetchTs < PRICES_TTL_MS) {
      return true;
    }
    if (this.loadingPrices) return this.loadingPrices;

    this.loadingPrices = (async () => {
      try {
        if (!force) {
          const cached = await this.idbGet<{ key: string; marketData: any; fetchedAt: number }>(
            STORE_PRICES,
            "snapshot"
          );
          if (isValidMarketData(cached?.marketData) && Date.now() - cached.fetchedAt < PRICES_TTL_MS) {
            this.marketData = cached.marketData;
            this.lastFetchTs = cached.fetchedAt;
            this.notify();
            return true;
          }
        }

        for (const url of getMarketApiUrls()) {
          try {
            const data = await requestJson(url, 7000);
            if (isValidMarketData(data?.marketData)) {
              this.marketData = data.marketData;
              this.lastFetchTs = Date.now();
              void this.idbSet(STORE_PRICES, {
                key: "snapshot",
                marketData: data.marketData,
                apiTimestamp: data.timestamp || 0,
                fetchedAt: this.lastFetchTs,
              });
              this.notify();
              return true;
            }
          } catch {
            // Try next candidate URL
          }
        }
      } catch {
        // Fallback below
      } finally {
        if (!this.marketData) {
          const stale = await this.idbGet<{ marketData: any; fetchedAt: number }>(STORE_PRICES, "snapshot");
          if (isValidMarketData(stale?.marketData)) {
            this.marketData = stale.marketData;
            this.lastFetchTs = stale.fetchedAt || 0;
            this.notify();
          }
        }
        this.loadingPrices = null;
      }
      return this.marketData !== null;
    })();

    return this.loadingPrices;
  }

  isPricesLoaded(): boolean {
    return this.marketData !== null;
  }

  getPrice(itemHrid: string, enhancementLevel = 0): MarketPriceEntry | null {
    if (!itemHrid) return null;
    const key = `${itemHrid}:${enhancementLevel}`;
    const patch = this.livePricePatches.get(key);
    if (patch && patch.ts >= this.lastFetchTs) {
      return { ask: patch.ask, bid: patch.bid };
    }

    const entry = this.marketData?.[itemHrid]?.[String(enhancementLevel)];
    if (!entry) return null;
    return {
      ask: normalizePrice(entry.a),
      bid: normalizePrice(entry.b),
    };
  }

  getOrderBook(itemHrid: string, enhancementLevel = 0): { asks: any[]; bids: any[] } | null {
    return this.orderBookCache.get(`${itemHrid}:${enhancementLevel}`) ?? null;
  }

  async getVolumeStats(itemHrid: string, enhancementLevel = 0): Promise<MarketVolumeStats | null> {
    if (!itemHrid || itemHrid === "/items/") return null;
    const key = `${itemHrid}:${enhancementLevel}`;
    const mem = this.volumeMemCache.get(key);
    if (mem && Date.now() - mem.ts < VOLUME_TTL_MS) {
      return mem.stats;
    }

    const inflight = this.volumePending.get(key);
    if (inflight) return inflight;

    const promise = (async (): Promise<MarketVolumeStats | null> => {
      try {
        const cached = await this.idbGet<{ key: string; rows: any[]; ts: number }>(STORE_VOLUME, key);
        let rows: any[] | null = null;
        if (cached && Array.isArray(cached.rows) && Date.now() - cached.ts < VOLUME_TTL_MS) {
          rows = cached.rows;
        } else {
          const url = `${Q7_API_HOST}/api/market/history?item_id=${encodeURIComponent(itemHrid)}&variant=${enhancementLevel}&days=7`;
          const raw = await requestJson(url, 6000);
          if (Array.isArray(raw)) {
            rows = raw;
          } else if (raw && typeof raw === "object") {
            if (Array.isArray(raw[itemHrid])) {
              rows = raw[itemHrid];
            } else {
              const firstArr = Object.values(raw).find((v) => Array.isArray(v));
              rows = Array.isArray(firstArr) ? firstArr : [];
            }
          }
          if (rows && rows.length > 0) {
            void this.idbSet(STORE_VOLUME, { key, rows, ts: Date.now() });
          }
        }

        if (!rows) return null;
        const stats = this.computeVolumeStats(itemHrid, enhancementLevel, rows);
        this.volumeMemCache.set(key, { stats, ts: Date.now() });
        if (this.volumeMemCache.size > 200) {
          const oldest = this.volumeMemCache.keys().next().value;
          if (oldest) this.volumeMemCache.delete(oldest);
        }
        return stats;
      } catch {
        return null;
      } finally {
        this.volumePending.delete(key);
      }
    })();

    this.volumePending.set(key, promise);
    return promise;
  }

  private computeVolumeStats(
    itemHrid: string,
    enhancementLevel: number,
    rows: Array<{ p: number; v: number; a?: number; b?: number; time: number }>
  ): MarketVolumeStats {
    const nowSec = Math.floor(Date.now() / 1000);
    const calcWindow = (days: number) => {
      const cutoff = nowSec - days * 86400;
      const slice = rows.filter((r) => typeof r?.time === "number" && r.time >= cutoff && r.v > 0);
      let volume = 0;
      let pv = 0;
      let buyVolume = 0;
      let sellVolume = 0;

      const hourly = new Map<number, typeof slice>();
      for (const r of slice) {
        volume += r.v;
        pv += r.p * r.v;
        const hr = Math.floor(r.time / 3600);
        const list = hourly.get(hr);
        if (list) list.push(r);
        else hourly.set(hr, [r]);
      }

      const sortedHrs = Array.from(hourly.keys()).sort((a, b) => a - b);
      let prevAsk = 0;
      let prevBid = 0;
      for (const hr of sortedHrs) {
        const hrRows = hourly.get(hr)!;
        const asks = hrRows.map((x) => x.a || 0).filter((a) => a > 0);
        const bids = hrRows.map((x) => x.b || 0).filter((b) => b > 0);
        const avgAsk = asks.length ? asks.reduce((s, x) => s + x, 0) / asks.length : prevAsk;
        const avgBid = bids.length ? bids.reduce((s, x) => s + x, 0) / bids.length : prevBid;

        for (const r of hrRows) {
          if ((avgAsk > 0 && r.p >= avgAsk) || (prevAsk > 0 && r.p >= prevAsk)) {
            buyVolume += r.v;
          } else if ((avgBid > 0 && r.p <= avgBid) || (prevBid > 0 && r.p <= prevBid)) {
            sellVolume += r.v;
          } else if (avgAsk > avgBid && avgBid > 0) {
            const ratio = Math.max(0, Math.min(1, (r.p - avgBid) / (avgAsk - avgBid)));
            buyVolume += r.v * ratio;
            sellVolume += r.v * (1 - ratio);
          } else {
            buyVolume += r.v * 0.5;
            sellVolume += r.v * 0.5;
          }
        }
        if (avgAsk > 0) prevAsk = avgAsk;
        if (avgBid > 0) prevBid = avgBid;
      }

      // Volume-weighted median & min/max within this window
      const priceList: Array<{ price: number; volume: number }> = [];
      for (const r of slice) {
        if (r.v > 0 && r.p > 0) {
          priceList.push({ price: r.p, volume: r.v });
        }
      }
      priceList.sort((a, b) => a.price - b.price);
      let medianPrice = 0;
      const midVol = volume / 2;
      let accum = 0;
      for (const entry of priceList) {
        accum += entry.volume;
        if (accum >= midVol) {
          medianPrice = entry.price;
          break;
        }
      }
      const winMin = priceList.length ? this.roundLegalPrice(priceList[0].price, "down") : 0;
      const winMax = priceList.length ? this.roundLegalPrice(priceList[priceList.length - 1].price, "up") : 0;

      return {
        volume,
        avgPrice: volume > 0 ? pv / volume : 0,
        medianPrice,
        buyVolume: Math.round(buyVolume),
        sellVolume: Math.round(sellVolume),
        minPrice: winMin,
        maxPrice: winMax,
      };
    };

    const validPrices = rows.map((r) => r.p).filter((p) => typeof p === "number" && p > 0);
    return {
      itemHrid,
      enhancementLevel,
      updatedAt: Date.now(),
      d1: calcWindow(1),
      d3: calcWindow(3),
      d5: calcWindow(5),
      minPrice: validPrices.length ? this.roundLegalPrice(Math.min(...validPrices), "down") : 0,
      maxPrice: validPrices.length ? this.roundLegalPrice(Math.max(...validPrices), "up") : 0,
    };
  }

  private getPriceStepAt(price: number): number {
    const p = Math.trunc(price);
    if (p < 100) return 1;
    const text = String(p);
    const digits = text.length;
    const lead = text[0];
    if (lead === "1" || lead === "2") {
      return digits >= 4 ? 5 * Math.pow(10, digits - 4) : 1;
    }
    if (lead === "3" || lead === "4") {
      return digits >= 3 ? Math.pow(10, digits - 3) : 1;
    }
    return digits >= 3 ? 2 * Math.pow(10, digits - 3) : 1;
  }

  roundLegalPrice(price: number, direction: "up" | "down"): number {
    if (!Number.isFinite(price) || price <= 0) return 0;
    const p = Math.trunc(price);
    if (p <= 1) return 1;
    const step = this.getPriceStepAt(p);
    const lower = p - (p % step);
    return direction === "up" && p > lower ? lower + step : Math.max(1, lower);
  }

  stepLegalPrice(price: number, deltaSteps: number): number {
    if (!Number.isFinite(price) || price <= 0) return 1;
    let cur = this.roundLegalPrice(price, deltaSteps >= 0 ? "up" : "down");
    const steps = Math.abs(Math.trunc(deltaSteps));
    const dir = deltaSteps >= 0 ? 1 : -1;

    for (let i = 0; i < steps; i++) {
      if (dir > 0) {
        cur += this.getPriceStepAt(cur);
      } else {
        if (cur <= 1) {
          cur = 1;
          break;
        }
        const downCandidate = cur - 1;
        const step = this.getPriceStepAt(downCandidate);
        cur = Math.max(1, downCandidate - (downCandidate % step));
      }
    }
    return Math.max(1, cur);
  }

  onPriceUpdate(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const cb of this.listeners) {
      try {
        cb();
      } catch (err) {
        console.error("[MWI Lite marketStore] listener error:", err);
      }
    }
  }
}

export const marketStore: MarketStore = new LiteMarketStore();
