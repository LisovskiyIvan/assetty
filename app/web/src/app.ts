/** Shared app state + a minimal event bus. */
import { Bridge } from "./bridge";
import { toast } from "./ui";
import type { Info } from "./types";
import type { ViewerScene } from "./viewer";

export interface BusEvents {
  /** active model changed */
  path: { path: string };
  /** tabs should refresh from app.info / app.pathA */
  context: void;
}

export class App {
  readonly bridge = new Bridge();
  pathA: string | null = null;
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

  /** Opens the native picker and returns the chosen path (null on cancel/failure). */
  async pickPath(): Promise<string | null> {
    try {
      const res = await this.bridge.openDialog();
      return res.path;
    } catch (err) {
      toast(`open failed: ${(err as Error).message}`, "error");
      return null;
    }
  }

  /** Native picker + the shared "model opened" state update. */
  async pickAndOpen(): Promise<string | null> {
    const path = await this.pickPath();
    if (!path) return null;
    this.setPath(path);
    return path;
  }

  setPath(path: string): void {
    this.pathA = path;
    this.emit("path", { path });
  }

  setViewer(viewer: ViewerScene | null): void {
    this.viewer = viewer;
  }
}

export const app = new App();
