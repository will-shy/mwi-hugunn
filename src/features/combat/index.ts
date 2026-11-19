import type { FeatureModule } from "../../core/types";
import {
  createCombatLightTrackerModule,
  createCombatScoreModule,
  createLoadoutBadgeModule,
} from "./combat-light";
import { createLabyrinthRateModule, isLabyrinthWorkerActive } from "./labyrinth-rate";

export const combatModules: FeatureModule[] = [
  createLabyrinthRateModule(),
  createCombatLightTrackerModule(),
  createLoadoutBadgeModule(),
  createCombatScoreModule(),
];

export { isLabyrinthWorkerActive };
