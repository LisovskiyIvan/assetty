/** Shared app state + a minimal event bus. */
import { Bridge } from "./bridge";
import { t } from "./i18n";
import { toast } from "./ui";
import { getRecentDirs, recordRecentDirFor } from "./settings";
import type { Info } from "./types";
import type { ViewerScene } from "./viewer";

export interface BusEvents {
  /** legacy: optimize source changed (same payload as "source") */
  path: { path: string };
  /** optimize source changed: Open…/⌘O or "Use as source" only */
  source: { path: string };
  /** viewed model changed: source open or "View result" */
  view: { path: string };
  /** tabs should refresh from app.info / app.sourcePath */
  context: void;
}

export class App {
  readonly bridge = new Bridge();
  /** Optimize target. Set ONLY by explicit open (Open…/⌘O) or "Use as source". */
  sourcePath: string | null = null;
  /** Whatever is loaded into the viewer (source or a result). */
  viewPath: string | null = null;
  info: Info | null = null;
  viewer: ViewerScene | null = null;
  private listeners = new Map<string, Set<(detail: unknown) => void>>();

  /** Legacy alias for sourcePath (reads). Writes go through openSource(). */
  get pathA(): string | null {
    return this.sourcePath;
  }
  set pathA(v: string | null) {
    this.sourcePath = v;
  }

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
    return this.pickPathAt(getRecentDirs()[0] ?? null);
  }

  /** Native picker seeded at `dir` (null = default location). */
  async pickPathAt(dir: string | null): Promise<string | null> {
    try {
      const res = await this.bridge.openDialogAt(dir);
      return res.path;
    } catch (err) {
      toast(t("toast.openFailed", { message: (err as Error).message }), "error");
      return null;
    }
  }

  /** Native picker (seeded at the most recent dir) + shared "model opened" state. */
  async pickAndOpen(): Promise<string | null> {
    const path = await this.pickPath();
    if (!path) return null;
    this.openSource(path);
    return path;
  }

  /** Explicit open (Open…/⌘O): sets BOTH the optimize source and the view. */
  openSource(path: string): void {
    this.sourcePath = path;
    this.viewPath = path;
    // The previous model's info no longer describes what is on screen.
    this.info = null;
    try {
      recordRecentDirFor(path);
    } catch {
      // recent-dirs bookkeeping must never break an open
    }
    this.emit("source", { path });
    this.emit("view", { path });
    this.emit("path", { path });
  }

  /** Load a result into the viewer WITHOUT touching the optimize source. */
  setView(path: string): void {
    this.viewPath = path;
    this.emit("view", { path });
  }

  /** Power-user flow: keep iterating on a result. Source switches, view stays. */
  useAsSource(path: string): void {
    this.sourcePath = path;
    this.info = null;
    try {
      recordRecentDirFor(path);
    } catch {
      // recent-dirs bookkeeping must never break an open
    }
    this.emit("source", { path });
    this.emit("path", { path });
  }

  /** Legacy alias for openSource(). */
  setPath(path: string): void {
    this.openSource(path);
  }

  setInfo(info: Info | null): void {
    this.info = info;
    this.emit("context");
  }

  setViewer(viewer: ViewerScene | null): void {
    this.viewer = viewer;
  }
}

export const app = new App();
