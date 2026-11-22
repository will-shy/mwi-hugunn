import type { FeatureModule } from "../../core/types";
import { createActionTimerModule } from "./action-timer";
import { createItemCalculatorModule } from "./item-calculator";
import { createQueueNextModule } from "./queue-next";
import { createTaskAutoMinusOneModule, createTaskBoardModule } from "./task-board";

export const plannerModules: FeatureModule[] = [
  createActionTimerModule(),
  createQueueNextModule(),
  createItemCalculatorModule(),
  createTaskBoardModule(),
  createTaskAutoMinusOneModule(),
];
