/** Shared app state + a minimal event bus. */
import { Bridge } from "./bridge";
import { toast } from "./ui";
import type { Info } from "./types";
import type { ViewerScene } from "./viewer";

export type Slot = "a" | "b";

export interface BusEvents {
  /** active file changed (slot a = primary, slot b = comparison target) */
  path: { path: string; slot: Slot };
  /** filesystem tree should be reloaded */
  tree: void;
  /** tabs should refresh from app.info / app.pathA */
  context: void;
}

export class App {
  readonly bridge = new Bridge();
  pathA: string | null = null;
  pathB: string | null = null;
  info: Info | null = null;
  viewer: ViewerScene | null = null;
  private listeners = new Map<string, Set<(detail: unknown) => void>>();

  on<K extends keyof BusEvents>(event: K, cb: (detail: BusEvents[K]) => void): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(cb as (detail: unknown) => void);
    this.listeners.set(event, set);
    return () => set.delete(cb as (detail: unknown) => void);
  }

  emit<K extends keyof BusEvents>(event: K, detail?: BusEvents[K]): void {
    for (const cb of this.listeners.get(event) ?? []) cb(detail);
  }

  toast = toast;

  setPath(path: string, slot: Slot = "a"): void {
    if (slot === "a") this.pathA = path;
    else this.pathB = path;
    this.emit("path", { path, slot });
  }

  setViewer(viewer: ViewerScene | null): void {
    this.viewer = viewer;
  }
}

export const app = new App();
