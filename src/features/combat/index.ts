import type { FeatureModule } from "../../core/types";
import {
  createCombatLightTrackerModule,
  createCombatScoreModule,
  createLoadoutBadgeModule,
} from "./combat-light";
import { createLabyrinthRateModule, isLabyrinthWorkerActive as labyrinthWorkerActive } from "./labyrinth-rate";

// Build-time flag from build.mjs (esbuild `define`). Off by default; `npm run build:full` turns it on.
// When false, esbuild drops the Labyrinth module and its engine from the bundle as dead code.
declare const __HUGUNN_LABYRINTH__: boolean;

export const LABYRINTH_INCLUDED: boolean = __HUGUNN_LABYRINTH__;

export const combatModules: FeatureModule[] = [
  ...(__HUGUNN_LABYRINTH__ ? [createLabyrinthRateModule()] : []),
  createCombatLightTrackerModule(),
  createLoadoutBadgeModule(),
  createCombatScoreModule(),
];

export const isLabyrinthWorkerActive: () => boolean = __HUGUNN_LABYRINTH__
  ? labyrinthWorkerActive
  : () => false;
