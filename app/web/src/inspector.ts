/**
 * Babylon Inspector v2, docked into the app shell.
 *
 * The inspector is loaded lazily (`import("@babylonjs/inspector")` only when
 * first opened) so the React/FluentUI payload never delays app start.
 *
 * It is configured with `layoutMode: "overlay"` plus an explicit
 * `containerElement`: the inspector renders inside our dock column instead of
 * covering the canvas (that is what `layoutMode: "inline"` would do — it
 * re-parents the rendering canvas, which would break the tab layout). The dock
 * is a normal grid column, so opening/closing it resizes the canvas and the
 * engine follows through its ResizeObserver.
 */
import type { Scene } from "@babylonjs/core/scene";
import { notify } from "./notify";
import { themeMode } from "./settings";

interface InspectorToken {
  dispose(): Promise<void>;
  readonly isDisposed: boolean;
}

type ShowInspectorFn = (scene: Scene, options: Record<string, unknown>) => InspectorToken;

export function createInspectorDock(onChange?: (open: boolean) => void): InspectorDock {
  return new InspectorDock(onChange);
}

export class InspectorDock {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  private token: InspectorToken | null = null;
  private scene: Scene | null = null;
  private busy = false;
  private readonly title: HTMLElement;
  private readonly onChange?: (open: boolean) => void;

  constructor(onChange?: (open: boolean) => void) {
    this.onChange = onChange;
    this.title = document.createElement("span");
    this.title.textContent = "Inspector — no scene";

    const close = document.createElement("button");
    close.className = "small";
    close.textContent = "close";
    close.title = "Hide inspector (⌘I)";
    close.addEventListener("click", () => void this.hide());

    const head = document.createElement("div");
    head.className = "dock-head";
    head.append(this.title, close);

    this.body = document.createElement("div");
    this.body.className = "dock-body";

    this.el = document.createElement("aside");
    this.el.id = "inspector-dock";
    this.el.className = "inspector-dock";
    this.el.hidden = true;
    this.el.append(head, this.body);
  }

  get isOpen(): boolean {
    return this.token !== null && !this.el.hidden;
  }

  /** Opens the inspector for `scene` (or closes it when already open). */
  async toggle(scene: Scene | null): Promise<boolean> {
    if (this.busy) return this.isOpen;
    if (this.isOpen) {
      await this.hide();
      return false;
    }
    if (!scene) {
      notify("Inspector needs a loaded scene — open a model first", "error");
      return false;
    }
    this.busy = true;
    try {
      this.el.hidden = false;
      this.el.dataset.state = "loading";
      const mod = (await import("@babylonjs/inspector")) as unknown as {
        ShowInspector?: ShowInspectorFn;
      };
      if (typeof mod.ShowInspector !== "function") {
        throw new Error("inspector bundle has no ShowInspector()");
      }
      this.token = mod.ShowInspector(scene, {
        containerElement: this.body,
        layoutMode: "overlay",
        autoResizeEngine: true,
        // The inspector has its own Fluent theme: follow the app's current one.
        themeMode: themeMode(),
        disableTeachingMoments: true,
      });
      this.scene = scene;
      this.title.textContent = `Inspector — ${scene.meshes.length} meshes`;
      this.el.dataset.state = "ready";
      this.onChange?.(true);
      return true;
    } catch (err) {
      this.el.hidden = true;
      this.el.dataset.state = "failed";
      this.onChange?.(false);
      notify(`inspector failed: ${(err as Error).message}`, "error");
      return false;
    } finally {
      this.busy = false;
    }
  }

  async show(scene: Scene | null): Promise<boolean> {
    if (this.isOpen) return true;
    return await this.toggle(scene);
  }

  async hide(): Promise<void> {
    const token = this.token;
    this.token = null;
    this.scene = null;
    this.el.hidden = true;
    this.el.dataset.state = "hidden";
    if (token && !token.isDisposed) {
      try {
        await token.dispose();
      } catch (err) {
        notify(`inspector close failed: ${(err as Error).message}`, "error");
      }
    }
    this.onChange?.(false);
  }

  /** Called when the inspected scene goes away. */
  async detach(): Promise<void> {
    if (this.scene) await this.hide();
  }
}
