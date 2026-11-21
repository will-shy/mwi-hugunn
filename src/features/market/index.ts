import type { FeatureModule } from "../../core/types";
import { createNetworthModule, createTooltipEvModule } from "./economy-overlay";
import { createGuildShopRankModule } from "./guild-shop-rank";
import { createMagicSortModule } from "./magic-sort";
import { createMarketQuickOpsModule } from "./market-quick-ops";
import { createMarketShortcutsModule } from "./market-shortcuts";
import { createVolumeDisplayModule } from "./volume-display";

export const marketModules: FeatureModule[] = [
  createMarketShortcutsModule(),
  createMagicSortModule(),
  createVolumeDisplayModule(),
  createMarketQuickOpsModule(),
  createTooltipEvModule(),
  createNetworthModule(),
  createGuildShopRankModule(),
];
