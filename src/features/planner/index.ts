import type { FeatureModule } from "../../core/types";
import { createActionTimerModule } from "./action-timer";
import { createItemCalculatorModule } from "./item-calculator";
import { createLootBoxAutoAllModule } from "./loot-box-auto-all";
import { createQueueNextModule } from "./queue-next";
import { createQuickInputsModule } from "./quick-inputs";
import { createSkillStockModule } from "./skill-stock";
import { createTaskAutoMinusOneModule, createTaskBoardModule } from "./task-board";

export const plannerModules: FeatureModule[] = [
  createActionTimerModule(),
  createQueueNextModule(),
  createItemCalculatorModule(),
  createQuickInputsModule(),
  createSkillStockModule(),
  createLootBoxAutoAllModule(),
  createTaskBoardModule(),
  createTaskAutoMinusOneModule(),
];
