export type PanelRoute =
  | "market"
  | "labyrinth"
  | "combat"
  | "production"
  | "tasks"
  | "house"
  | "calculator"
  | "other";

export type FeatureCategory = "market" | "planner" | "combat";

export type WsHandler = (payload: any, rawType: string) => void;

export interface WsBus {
  install(): void;
  on(messageType: string, handler: WsHandler): () => void;
  onAny(handler: WsHandler): () => void;
  isInstalled(): boolean;
  getMessageCount(): number;
}

export interface StorageAPI {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
  del(key: string): void;
}

export interface MarketPriceEntry {
  ask: number | null;
  bid: number | null;
}

export interface MarketVolumeWindowStats {
  volume: number;
  avgPrice: number;
  medianPrice: number;
  buyVolume: number;
  sellVolume: number;
  minPrice: number;
  maxPrice: number;
}

export interface MarketVolumeStats {
  itemHrid: string;
  enhancementLevel: number;
  updatedAt: number;
  d1: MarketVolumeWindowStats;
  d3: MarketVolumeWindowStats;
  d5: MarketVolumeWindowStats;
  minPrice: number;
  maxPrice: number;
}

export interface MarketStore {
  init(): void;
  ensurePricesLoaded(force?: boolean): Promise<boolean>;
  isPricesLoaded(): boolean;
  getPrice(itemHrid: string, enhancementLevel?: number): MarketPriceEntry | null;
  getOrderBook(itemHrid: string, enhancementLevel?: number): { asks: any[]; bids: any[] } | null;
  getVolumeStats(itemHrid: string, enhancementLevel?: number): Promise<MarketVolumeStats | null>;
  stepLegalPrice(price: number, deltaSteps: number): number;
  roundLegalPrice(price: number, direction: "up" | "down"): number;
  onPriceUpdate(cb: () => void): () => void;
}

export interface I18nAPI {
  isZh(): boolean;
  getLang(): "zh" | "en";
  t(zh: string, en: string): string;
  getName(hrid: string, category: string): string;
  getItemName(itemHrid: string): string;
  getActionName(actionHrid: string): string;
  getSkillName(skillHrid: string): string;
  getMonsterName(monsterHrid: string): string;
  getHouseRoomName(roomHrid: string): string;
  getItemHridByName(name: string): string | null;
}

export interface GameDataAPI {
  init(): void;
  getClientData(): any | null;
  getCharacterData(): any | null;
  getCharacterId(): number | string | null;
  getCharacterName(): string | null;
  getCharacterItems(): any[];
  getCharacterActions(): any[];
  getCharacterSkills(): any[];
  getCharacterQuests(): any[];
  getMarketListings(): any[];
  getHouseRooms(): Map<string, any>;
  getCharacterAbilities(): any[];
  getAbilityCombatTriggers(): Record<string, any>;
  getActionTypeDrinkSlots(): Map<string, any[]>;
  getPersonalBuffs(): Record<string, any>;
  getGuildActionBuffs(): Record<string, any[]>;
  getLabyrinthData(): any | null;
  getBattleData(): any | null;
  getReactGameCore(forceRefresh?: boolean): any | null;
  on(event: string, handler: (data?: any) => void): () => void;
}

export interface DomScheduler {
  start(): void;
  getActiveRoute(): PanelRoute;
  registerDomHandler(
    id: string,
    routes: PanelRoute[] | undefined,
    cb: (doc: Document, route: PanelRoute) => void
  ): () => void;
  onRouteChange(cb: (route: PanelRoute, prevRoute: PanelRoute) => void): () => void;
  scheduleRun(immediate?: boolean): void;
}

export interface KernelContext {
  pageWindow: Window & typeof globalThis;
  wsBus: WsBus;
  gameData: GameDataAPI;
  marketStore: MarketStore;
  domScheduler: DomScheduler;
  storage: StorageAPI;
  i18n: I18nAPI;
  addStyle(id: string, css: string): () => void;
  isFeatureEnabled(id: string): boolean;
}

export interface FeatureModule {
  id: string;
  nameZh: string;
  nameEn: string;
  descriptionZh: string;
  descriptionEn: string;
  category: FeatureCategory;
  defaultEnabled: boolean;
  routes?: PanelRoute[];
  init(ctx: KernelContext): void | (() => void);
  onDom?(doc: Document, route: PanelRoute): void;
}
