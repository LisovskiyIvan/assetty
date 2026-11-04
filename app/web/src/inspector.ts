/**
 * Babylon Inspector v2, inline inside the Viewer tab's canvas pane.
 *
 * The inspector is loaded lazily (`import("@babylonjs/inspector")` only when
 * first opened) so the React/FluentUI payload never delays app start.
 *
 * It uses `layoutMode: "inline"` with NO `containerElement`: the inspector
 * wraps the rendering canvas's parent (`.canvas-wrap`), so the stock layout —
 * Scene Explorer LEFT, canvas CENTER, Properties/Debug/Statistics/Tools
 * RIGHT — shares one ServiceContainer and one SelectionService (clicking a
 * node in the tree drives the properties pane; two `ShowInspector` instances
 * on one scene cannot coexist anyway — the second disposes the first, see
 * `InspectorTokens` in the inspector bundle). On dispose the inspector
 * restores the wrap's original children, so the canvas never gets stranded.
 *
 * Pane widths are fixed-but-sane (300/360, min 240/260) and resizable through
 * the inspector's own drag handles; the engine follows resizes through
 * `autoResizeEngine` plus the ViewerScene ResizeObserver.
 */
import type { Scene } from "@babylonjs/core/scene";
import { t } from "./i18n";
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
  private token: InspectorToken | null = null;
  private scene: Scene | null = null;
  private busy = false;
  private readonly onChange?: (open: boolean) => void;

  constructor(onChange?: (open: boolean) => void) {
    this.onChange = onChange;
  }

  get isOpen(): boolean {
    return this.token !== null && !this.token.isDisposed;
  }

  /** Scene the open inspector is bound to (null when closed). */
  get boundScene(): Scene | null {
    return this.isOpen ? this.scene : null;
  }

  /** Opens the inspector for `scene` (or closes it when already open). */
  async toggle(scene: Scene | null): Promise<boolean> {
    if (this.busy) return this.isOpen;
    if (this.isOpen) {
      await this.hide();
      return false;
    }
    if (!scene) {
      notify(t("toast.inspectorNeedScene"), "error");
      return false;
    }
    this.busy = true;
    try {
      const mod = (await import("@babylonjs/inspector")) as unknown as {
        ShowInspector?: ShowInspectorFn;
      };
      if (typeof mod.ShowInspector !== "function") {
        throw new Error("inspector bundle has no ShowInspector()");
      }
      // No containerElement: inline mode wraps the rendering canvas's parent,
      // yielding explorer | canvas | properties with a shared selection.
      this.token = mod.ShowInspector(scene, {
        layoutMode: "inline",
        autoResizeEngine: true,
        // The inspector has its own Fluent theme: follow the app's current one.
        themeMode: themeMode(),
        disableTeachingMoments: true,
        leftPaneDefaultWidth: 300,
        leftPaneMinWidth: 240,
        rightPaneDefaultWidth: 360,
        rightPaneMinWidth: 260,
      });
      this.scene = scene;
      this.onChange?.(true);
      return true;
    } catch (err) {
      this.token = null;
      this.scene = null;
      this.onChange?.(false);
      notify(t("toast.inspectorFail", { message: (err as Error).message }), "error");
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
    if (token && !token.isDisposed) {
      try {
        await token.dispose();
      } catch (err) {
        notify(t("toast.inspectorCloseFail", { message: (err as Error).message }), "error");
      }
    }
    this.onChange?.(false);
  }

  /** Called when the inspected scene goes away. */
  async detach(): Promise<void> {
    if (this.scene) await this.hide();
  }
}
