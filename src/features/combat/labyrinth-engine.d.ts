export interface LabyrinthEngineAdapters {
  decompressFromUTF16: (raw: string) => string | null;
  getClientData: () => any | null;
}

export interface LabyrinthEngineController {
  start(): void;
  refresh(): void;
  onWsMessage(msg: any): void;
  isWorkerActive(): boolean;
  terminateWorker(reason?: string): void;
  dispose(): void;
}

export function createLabyrinthEngine(adapters: LabyrinthEngineAdapters): LabyrinthEngineController;
