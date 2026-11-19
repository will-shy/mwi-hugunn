import { decompressFromUTF16 } from "../../core/lz-utf16";
import type { FeatureModule, KernelContext, PanelRoute } from "../../core/types";
import { createLabyrinthEngine, type LabyrinthEngineController } from "./labyrinth-engine";

const IDLE_TERMINATE_MS = 60_000;

let activeEngine: LabyrinthEngineController | null = null;

export function isLabyrinthWorkerActive(): boolean {
  return activeEngine?.isWorkerActive() ?? false;
}

export function createLabyrinthRateModule(): FeatureModule {
  let ctx: KernelContext | null = null;
  let unregWs: (() => void) | null = null;
  let unregRoute: (() => void) | null = null;
  let idleTimer: number | null = null;
  let unloadHandler: (() => void) | null = null;

  const clearIdleTimer = () => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const scheduleWorkerTermination = () => {
    if (idleTimer !== null || !activeEngine?.isWorkerActive()) return;
    idleTimer = window.setTimeout(() => {
      idleTimer = null;
      activeEngine?.terminateWorker("Left Labyrinth for 60s");
    }, IDLE_TERMINATE_MS);
  };

  return {
    id: "combat-labyrinth-rate",
    nameZh: "迷宫胜率与耗时模拟（按需 Worker）",
    nameEn: "Labyrinth Monte-Carlo Rate (Lazy Worker)",
    descriptionZh: "保留真实蒙特卡洛战斗模拟与生活房清房计算；仅进迷宫后按需启动 1 个 Worker，离开 60 秒自动销毁",
    descriptionEn: "Authentic Monte-Carlo combat & skilling clear rate; spawns 1 LazyWorker only inside Labyrinth and terminates 60s after leaving",
    category: "combat",
    defaultEnabled: true,
    routes: ["labyrinth"],

    init(context) {
      ctx = context;

      activeEngine = createLabyrinthEngine({
        decompressFromUTF16,
        getClientData: () => ctx?.gameData.getClientData() ?? null,
      });

      unregWs = ctx.wsBus.on("labyrinth_room_progress", (msg) => {
        activeEngine?.onWsMessage(msg);
      });

      unregRoute = ctx.domScheduler.onRouteChange((nextRoute: PanelRoute) => {
        if (nextRoute === "labyrinth") {
          clearIdleTimer();
          activeEngine?.start();
          activeEngine?.refresh();
        } else {
          scheduleWorkerTermination();
        }
      });

      unloadHandler = () => {
        activeEngine?.terminateWorker("Page unload");
      };
      window.addEventListener("beforeunload", unloadHandler);

      if (ctx.domScheduler.getActiveRoute() === "labyrinth") {
        activeEngine.start();
      }

      return () => {
        clearIdleTimer();
        unregWs?.();
        unregWs = null;
        unregRoute?.();
        unregRoute = null;
        if (unloadHandler) {
          window.removeEventListener("beforeunload", unloadHandler);
          unloadHandler = null;
        }
        activeEngine?.dispose();
        activeEngine = null;
      };
    },

    onDom(_doc, route) {
      if (route !== "labyrinth" || !activeEngine) return;
      clearIdleTimer();
      activeEngine.start();
      activeEngine.refresh();
    },
  };
}
