/** One Babylon engine + scene, used by the Viewer tab and by both Optimize panes. */
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { HighlightLayer } from "@babylonjs/core/Layers/highlightLayer";
import { LoadAssetContainerAsync, SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Material } from "@babylonjs/core/Materials/material";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
// Curated glTF 2.0 extensions (viewer previews arbitrary user GLBs: unlit,
// texture transform, punctual lights, quantization, spec-gloss legacy,
// instancing, webp/avif, meshopt, basisu/KTX2) + the SceneLoader plugin.
// Drops the legacy glTF 1.0 loader, validation, and KHR_draco_mesh_compression:
// no Draco decoder is wired (see meshopt.ts/ktx2.ts), so Draco files cannot
// decode either way. Meshopt is also registered via meshopt.ts (duplicate
// side-effect imports are deduped and keep this module self-sufficient).
import "@babylonjs/loaders/glTF/glTFFileLoader";
import "@babylonjs/loaders/glTF/2.0/Extensions/EXT_meshopt_compression";
import "@babylonjs/loaders/glTF/2.0/Extensions/EXT_mesh_gpu_instancing";
import "@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp";
import "@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_avif";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_texture_basisu";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_texture_transform";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_unlit";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_emissive_strength";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_pbrSpecularGlossiness";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_lights_punctual";
import { b64ToBytes } from "./bridge";
import { t } from "./i18n";
import { notify } from "./notify";

/** Vendored prefiltered IBL (specular + irradiance polynomials) in `public/env/`. */
export const ENVIRONMENT_URL = (): string =>
  new URL("env/environmentSpecular.env", document.baseURI).href;

export interface ExplorerSelection {
  kind: "node" | "mesh" | "material" | "texture" | "animation";
  name: string;
  mesh?: AbstractMesh;
}

export interface ViewerStats {
  fps: number;
  meshes: number;
  triangles: number;
  drawCalls: number;
  /** Materials referenced by the loaded meshes (excludes engine internals). */
  materials: number;
  /** Model textures (excludes the scene environment map and render targets). */
  textures: number;
}

export interface ExplorerData {
  nodes: AbstractMesh[];
  materials: Material[];
  textures: BaseTexture[];
  animations: AnimationGroup[];
}

export class ViewerScene {
  readonly canvas: HTMLCanvasElement;
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  readonly highlight: HighlightLayer;
  private resizeObserver: ResizeObserver;
  private inputAbort = new AbortController();
  private disposed = false;
  /** True between a successful model/demo load and the next clearScene(). */
  private loadedModel = false;
  /** False for a fresh/emptied scene: model-derived stats are meaningless. */
  get hasModel(): boolean {
    return this.loadedModel;
  }
  private envWatchdog: ReturnType<typeof setTimeout> | null = null;
  /** Fallback that starts the IBL upload when no frame was ever rendered. */
  private setupTimer: ReturnType<typeof setTimeout> | null = null;
  /** Pending texture-audit timers (cleared on dispose). */
  private auditTimers: Array<ReturnType<typeof setTimeout>> = [];
  /** Bumped on dispose: audit callbacks holding a stale id exit silently. */
  private auditGen = 0;

  onProgress?: (label: string | null) => void;

  constructor(canvas: HTMLCanvasElement, label = "scene") {
    this.canvas = canvas;
    this.engine = new Engine(canvas, true, {
      antialias: true,
      // DPR is clamped by hand below: adaptToDeviceRatio would render at the
      // full device ratio (2x on Retina Macs = 4x pixels) in EVERY scene
      // (viewer + two optimize panes), and HighlightLayer blur on top.
      adaptToDeviceRatio: false,
      stencil: true,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    });
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.engine.setHardwareScalingLevel(1 / dpr);

    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.05, 0.07, 0.09, 1);
    this.scene.imageProcessingConfiguration.toneMappingEnabled = true;
    this.scene.imageProcessingConfiguration.exposure = 1.0;
    this.scene.imageProcessingConfiguration.contrast = 1.05;

    this.camera = new ArcRotateCamera(
      label,
      -Math.PI / 2.2,
      Math.PI / 2.6,
      6,
      Vector3.Zero(),
      this.scene,
    );
    this.camera.attachControl(canvas, true);
    this.camera.wheelPrecision = 40;
    this.camera.pinchPrecision = 60;
    this.camera.panningSensibility = 90;
    this.camera.lowerRadiusLimit = 0.01;
    this.camera.upperRadiusLimit = 5000;
    this.camera.minZ = 0.01;
    this.camera.maxZ = 10000;

    const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.1), this.scene);
    hemi.intensity = 1.1;
    hemi.groundColor = new Color3(0.12, 0.13, 0.16);

    const dir = new DirectionalLight("key", new Vector3(-0.6, -1, -0.45), this.scene);
    dir.intensity = 1.6;
    dir.position = new Vector3(8, 12, 8);

    this.setupEnvironmentDeferred();

    this.highlight = new HighlightLayer("hl", this.scene, {
      blurHorizontalSize: 1.2,
      blurVerticalSize: 1.2,
    });
    this.highlight.innerGlow = false;

    // Render-on-demand: anything that changes the picture re-arms a short
    // burst of frames; the loop stops itself once the scene settles, so an
    // idle tab costs no GPU. Camera inertia keeps firing view-matrix changes
    // from inside the loop, which re-arms it until the camera rests.
    this.camera.onViewMatrixChangedObservable.add(() => this.requestRender());
    this.scene.onNewMeshAddedObservable.add(() => this.requestRender());
    this.scene.onDataLoadedObservable.add(() => this.requestRender());
    this.scene.onEnvironmentTextureChangedObservable.add(() => this.requestRender());
    // Input arrives while the loop is stopped (nothing to fire the hooks
    // above until a frame runs): wake the loop explicitly. Camera inertia
    // then keeps it awake via the view-matrix hook until the camera rests.
    this.scene.onPointerObservable.add(() => this.requestRender());
    const { signal } = this.inputAbort;
    canvas.addEventListener("wheel", () => this.requestRender(), { passive: true, signal });
    canvas.addEventListener("keydown", () => this.requestRender(), { signal });
    this.requestRender(30);

    // Snapshot the engine's per-frame draw call counter (otherwise it accumulates).
    const drawCounter = this.engineDrawCounter();
    if (drawCounter?.fetchNewFrame) {
      this.scene.onBeforeRenderObservable.add(() => drawCounter.fetchNewFrame?.());
    }

    // Observe the canvas itself: its CSS box is what actually changes when the
    // window, the right panel or the inspector dock resizes. Listening on the
    // parent misses dock-driven layout changes.
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    // …and the pane: grid/flex cells can change size without the canvas box
    // changing on the same frame (result panel appearing, dock toggling), and a
    // hidden pane reports 0×0 which `resize()` deliberately ignores.
    const pane = canvas.parentElement;
    if (pane) this.resizeObserver.observe(pane);
    window.addEventListener("resize", this.resize);
  }

  /**
   * Image-based lighting. glTF metallic-roughness materials are lit almost
   * entirely by the environment (metals have no diffuse term), so without one
   * they render black. The prefiltered `.env` also carries the irradiance
   * polynomials used for the diffuse term.
   *
   * The upload compiles a helper post-process through the scene's render
   * pipeline, so it must not start before the first frame — creating it in the
   * constructor deadlocks `scene.isReady()` (materials wait for the env, the
   * env waits for a render). Defer until one frame has been drawn, with a
   * timer as a belt-and-braces fallback for paused/offscreen tabs.
   */
  private setupEnvironmentDeferred(): void {
    let started = false;
    const start = (): void => {
      if (started || this.disposed) return;
      started = true;
      if (this.setupTimer !== null) {
        clearTimeout(this.setupTimer);
        this.setupTimer = null;
      }
      this.setupEnvironment();
    };
    this.scene.onAfterRenderObservable.addOnce(start);
    this.setupTimer = setTimeout(start, 400);
  }

  private setupEnvironment(): void {
    const url = ENVIRONMENT_URL();
    const env = CubeTexture.CreateFromPrefilteredData(url, this.scene);
    env.name = "environmentSpecular.env";
    env.level = 1;
    this.scene.environmentTexture = env;
    this.scene.environmentIntensity = 0.9;

    // A missing/undecodable .env would silently leave metals black: report it
    // once the texture should have been ready.
    this.envWatchdog = setTimeout(() => {
      this.envWatchdog = null;
      if (this.disposed || env.isReady()) return;
      notify(t("toast.envFail", { url }), "error");
    }, 8000);
  }

  /** True when the IBL map finished loading. */
  get environmentReady(): boolean {
    return this.scene.environmentTexture?.isReady() ?? false;
  }

  resize = (): void => {
    if (this.disposed) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.engine.resize();
    // While paused (hidden tab) no frame is scheduled, so the corrected
    // drawing buffer would only show up on the next resume. Paint it now.
    if (!this.running) this.scene.render();
  };

  /**
   * Re-syncs the drawing buffer with the CSS box immediately and again after
   * the next two animation frames. Panes are mounted/labelled asynchronously
   * (result panel, inspector dock, label overlays), so the box we can measure
   * right after a model load is often not the final one.
   */
  forceResize = (): void => {
    this.resize();
    requestAnimationFrame(() => {
      if (this.disposed) return;
      this.resize();
      requestAnimationFrame(() => {
        if (this.disposed) return;
        this.resize();
      });
    });
  };

  private renderLoop = (): void => {
    if (this.disposed) return;
    this.scene.render();
    if (this.settleLeft > 0 && --this.settleLeft === 0) {
      this.engine.stopRenderLoop();
      this.running = false;
    }
  };

  private running = false;
  /** Frames left in the current burst (lets uploads/post settle). */
  private settleLeft = 0;
  /** Burst length re-armed by every dirty signal. */
  private static readonly SETTLE_FRAMES = 8;

  /**
   * Schedules `frames` of rendering, starting the loop if it stopped. The
   * loop stops itself once the scene settles — call this after any change
   * that needs painting (loads, selection, camera writes from outside).
   */
  requestRender(frames: number = ViewerScene.SETTLE_FRAMES): void {
    if (this.disposed) return;
    this.settleLeft = Math.max(this.settleLeft, frames);
    if (!this.running) {
      this.running = true;
      this.engine.runRenderLoop(this.renderLoop);
    }
  }

  /** Stops rendering while the tab is hidden (saves GPU on background tabs). */
  pause(): void {
    if (this.disposed || !this.running) return;
    this.engine.stopRenderLoop();
    this.running = false;
    this.settleLeft = 0;
  }

  resume(): void {
    if (this.disposed) return;
    this.resize();
    // Repaint once; further frames only if something is still dirty.
    this.requestRender();
  }

  /** Loads a GLB from a base64 payload (what `loadBytes` returns). */
  async loadBase64(b64: string): Promise<void> {
    if (!b64) throw new Error("empty payload");
    await this.loadBytes(b64ToBytes(b64));
  }

  async loadBytes(bytes: Uint8Array): Promise<void> {
    this.clearScene();
    SceneLoader.ShowLoadingScreen = false;
    this.onProgress?.("parsing glb…");
    try {
      const container = await LoadAssetContainerAsync(bytes, this.scene, {
        pluginExtension: ".glb",
      });
      container.addAllToScene();
      this.loadedModel = true;
      container.animationGroups.forEach((g) => g.stop());
      this.frameAll();
      this.forceResize();
      this.scheduleTextureAudit();
    } finally {
      // A throw must not leave the spinner + dark pane stuck on.
      this.onProgress?.(null);
      this.requestRender(30);
    }
  }

  /**
   * Babylon reports a texture that failed to decode (KTX2, image decode) with a
   * `Logger.Warn` only — the material then renders with its factor colour and
   * the failure is invisible in the UI. Re-check after the decoders settle and
   * surface the names.
   */
  private scheduleTextureAudit(): void {
    const gen = this.auditGen;
    const later = (fn: () => void, ms: number): void => {
      const id = setTimeout(() => {
        this.auditTimers = this.auditTimers.filter((t) => t !== id);
        fn();
      }, ms);
      this.auditTimers.push(id);
    };
    const check = (attempt: number): void => {
      if (this.disposed || gen !== this.auditGen) return;
      const bad = this.scene.textures.filter(
        (t) => t.getClassName() !== "RenderTargetTexture" && !t.isReady(),
      );
      if (bad.length === 0) return;
      if (attempt < 2) {
        later(() => check(attempt + 1), 2000);
        return;
      }
      const names =
        bad
          .slice(0, 3)
          .map((tex) => tex.name || "(unnamed)")
          .join(", ") + (bad.length > 3 ? "…" : "");
      notify(
        t("toast.texAudit", {
          n: bad.length,
          names: names,
        }),
        "error",
      );
    };
    later(() => check(0), 1500);
  }

  /** Snapshot used by the debug hook and the inspector-less diagnostics. */
  textureDiagnostics(): Array<{ name: string; kind: string; ready: boolean; size: string }> {
    return this.scene.textures
      .filter((t) => t.getClassName() !== "RenderTargetTexture")
      .map((t) => ({
        name: t.name || "(unnamed)",
        kind: t.getClassName(),
        ready: t.isReady(),
        size: `${t.getSize().width || "?"}x${t.getSize().height || "?"}`,
      }));
  }

  /** Placeholder geometry so the layout is usable without nanoui. */
  loadDemo(): void {
    this.clearScene();
    this.loadedModel = true;
    const matA = new StandardMaterial("demo-a", this.scene);
    matA.diffuseColor = new Color3(0.32, 0.58, 0.9);
    matA.specularColor = new Color3(0.3, 0.3, 0.3);
    matA.roughness = 0.4;

    const matB = new StandardMaterial("demo-b", this.scene);
    matB.diffuseColor = new Color3(0.24, 0.26, 0.3);

    const knot = MeshBuilder.CreateTorusKnot(
      "TorusKnot_demo",
      { radius: 1, tube: 0.32, radialSegments: 128, tubularSegments: 48 },
      this.scene,
    );
    knot.material = matA;

    const ground = MeshBuilder.CreateGround("Ground_demo", { width: 6, height: 6 }, this.scene);
    ground.position.y = -2;
    ground.material = matB;

    for (let i = 0; i < 3; i++) {
      const box = MeshBuilder.CreateBox(`Box_demo_${i}`, { size: 0.5 }, this.scene);
      box.position = new Vector3(-2.2 + i * 0.9, -1.6, 1.6);
      box.material = matB;
    }

    this.frameAll();
    this.forceResize();
    this.requestRender(30);
  }

  /**
   * Scene-level textures that survive model swaps: the IBL map is set
   * explicitly; the BRDF lookup tables are created lazily by the PBR materials
   * and cached on the scene, so disposing them leaves the scene property
   * pointing at a dead texture that never becomes ready again — every PBR
   * material then waits forever and the next loaded model never renders.
   * Also excluded from model-texture stats.
   */
  private keptSceneTextures(): Set<BaseTexture | null> {
    return new Set<BaseTexture | null>([
      this.scene.environmentTexture,
      this.scene.environmentBRDFTexture,
      this.scene.environmentFuzzBRDFTexture,
    ]);
  }

  clearScene(): void {
    this.loadedModel = false;
    this.highlight.removeAllMeshes();
    this.scene.animationGroups.slice().forEach((g) => g.stop());
    this.scene.meshes.slice().forEach((m) => m.dispose());
    this.scene.materials.slice().forEach((m) => m.dispose());
    const keep = this.keptSceneTextures();
    this.scene.textures
      .filter((t) => !keep.has(t))
      .slice()
      .forEach((t) => t.dispose());
    this.scene.transformNodes.slice().forEach((n) => n.dispose());
    this.scene.animationGroups.slice().forEach((g) => g.dispose());
  }

  /** Frames the whole scene; deferred one frame so bounds reflect uploaded geometry. */
  frameAll(): void {
    this.scene.onAfterRenderObservable.addOnce(() => this.frameNow());
  }

  /**
   * Camera state written by the last automatic framing. A camera write only
   * fires `onViewMatrixChangedObservable` inside the next `scene.render()`, so
   * a flag set here would already be stale by then; comparing the values
   * instead tells a mirrored scene "this was not user input".
   */
  private autoFrame: { alpha: number; beta: number; radius: number; target: Vector3 } | null = null;

  /** True when the camera still sits exactly where `frameNow()` left it. */
  get isAutoFraming(): boolean {
    const s = this.autoFrame;
    if (!s) return false;
    const eps = 1e-6;
    return (
      Math.abs(this.camera.alpha - s.alpha) < eps &&
      Math.abs(this.camera.beta - s.beta) < eps &&
      Math.abs(this.camera.radius - s.radius) < eps &&
      Vector3.DistanceSquared(this.camera.target, s.target) < 1e-8
    );
  }

  private frameNow(): void {
    if (this.disposed) return;
    this.scene.updateTransformMatrix();
    for (const mesh of this.scene.meshes) {
      mesh.computeWorldMatrix(true);
      if (mesh.getTotalVertices() > 0) mesh.refreshBoundingInfo(false, false);
    }
    const ext = this.scene.getWorldExtends();
    const min = ext.min;
    const max = ext.max;
    if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) return;
    const center = min.add(max).scale(0.5);
    const size = max.subtract(min).length();
    if (!Number.isFinite(size) || size <= 0) return;
    this.camera.setTarget(center);
    this.camera.radius = Math.max(0.0001, size * 1.45);
    this.camera.lowerRadiusLimit = Math.max(0.00001, size * 0.02);
    this.camera.upperRadiusLimit = Math.max(20, size * 12);
    this.camera.minZ = Math.max(0.0001, size * 0.002);
    this.camera.maxZ = Math.max(100, size * 100);
    this.autoFrame = {
      alpha: this.camera.alpha,
      beta: this.camera.beta,
      radius: this.camera.radius,
      target: this.camera.target.clone(),
    };
  }

  /** Babylon's private per-frame draw-call counter (shape varies by build):
   * single choke point, so no call site pokes `engine._drawCalls` directly. */
  private engineDrawCounter(): { fetchNewFrame?: () => void; current?: number } | undefined {
    try {
      return (
        this.engine as unknown as {
          _drawCalls?: { fetchNewFrame?: () => void; current?: number };
        }
      )._drawCalls;
    } catch {
      return undefined;
    }
  }

  /** Current-frame draw calls, when the engine exposes its private counter. */
  private drawCalls(): number | undefined {
    const current = this.engineDrawCounter()?.current;
    return typeof current === "number" ? current : undefined;
  }

  getStats(): ViewerStats {
    const active = this.scene.getActiveMeshes();
    const indices = this.scene.getActiveIndices();
    const drawCalls = this.drawCalls() ?? active.length;
    const materials = new Set<Material>();
    for (const mesh of this.scene.meshes) {
      if (mesh.material) materials.add(mesh.material);
    }
    const textures = this.scene.textures.filter(
      (t) => !this.keptSceneTextures().has(t) && t.getClassName() !== "RenderTargetTexture",
    ).length;
    return {
      // No frames are being produced while the loop is stopped.
      fps: this.running ? this.engine.getFps() : 0,
      meshes: this.scene.meshes.length,
      triangles: Math.round(indices / 3),
      drawCalls,
      materials: materials.size,
      textures,
    };
  }

  explorerData(): ExplorerData {
    return {
      nodes: this.scene.meshes.filter((m) => !m.isDisposed()),
      materials: this.scene.materials,
      textures: this.scene.textures.filter((t) => t.getClassName() !== "RenderTargetTexture"),
      animations: this.scene.animationGroups,
    };
  }

  private highlighted: AbstractMesh | null = null;

  selectMesh(mesh: AbstractMesh | null): void {
    this.highlight.removeAllMeshes();
    this.highlighted = null;
    if (!mesh) {
      this.requestRender();
      return;
    }
    const color = new Color3(0.31, 0.64, 1);
    // HighlightLayer only accepts concrete meshes; instanced/abstract nodes are skipped.
    const asMesh = (m: AbstractMesh): Mesh | null =>
      m instanceof Mesh && m.getTotalVertices() > 0 ? m : null;
    const target = asMesh(mesh);
    if (target) this.highlight.addMesh(target, color);
    for (const child of mesh.getChildMeshes(false)) {
      const childMesh = asMesh(child);
      if (childMesh) this.highlight.addMesh(childMesh, color);
    }
    this.highlighted = mesh;
    this.requestRender();
  }

  get selectedMesh(): AbstractMesh | null {
    return this.highlighted;
  }

  /** Mirrors camera parameters into another scene (used by the Optimize dual view). */
  applyCameraFrom(src: ArcRotateCamera): void {
    const eps = 1e-5;
    if (Math.abs(this.camera.alpha - src.alpha) > eps) this.camera.alpha = src.alpha;
    if (Math.abs(this.camera.beta - src.beta) > eps) this.camera.beta = src.beta;
    if (Math.abs(this.camera.radius - src.radius) > eps) this.camera.radius = src.radius;
    const t = src.target;
    if (Vector3.DistanceSquared(this.camera.target, t) > eps) this.camera.setTarget(t.clone());
    this.requestRender();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.auditGen++;
    for (const id of this.auditTimers) clearTimeout(id);
    this.auditTimers = [];
    if (this.setupTimer !== null) clearTimeout(this.setupTimer);
    this.setupTimer = null;
    if (this.envWatchdog) clearTimeout(this.envWatchdog);
    this.envWatchdog = null;
    (this.camera as ArcRotateCamera | null)?.detachControl();
    this.inputAbort.abort();
    window.removeEventListener("resize", this.resize);
    this.resizeObserver.disconnect();
    this.engine.stopRenderLoop();
    // The inspector dock keeps a token bound to this scene: tell the shell to
    // detach it first so a disposed scene is never kept alive (main.ts hides
    // the dock when the event's scene is the bound one; sync dispatch, so the
    // token/scene refs are cleared before `scene.dispose()` below).
    try {
      window.dispatchEvent(
        new CustomEvent("assetty:scene-disposing", { detail: { scene: this.scene } }),
      );
    } catch {
      // No DOM (bun tests) — nothing bound to detach.
    }
    this.scene.dispose();
    this.engine.dispose();
  }
}

/** Links two scenes so panning/zooming one mirrors on the other.
 * Returns an unlink function; call it before disposing either scene so
 * repeated scene switches don't accumulate observers. */
export function linkCameras(a: ViewerScene, b: ViewerScene): () => void {
  let busy = false;
  const mirror = (from: ViewerScene, to: ViewerScene) => {
    if (busy) return;
    // Automatic framing is per-model: mirroring it would replace the other
    // pane's (differently sized) model framing with this one's camera, which
    // looks like a sudden zoom / stretch right after a run. User input still
    // mirrors in both directions.
    if (from.isAutoFraming) return;
    busy = true;
    try {
      to.applyCameraFrom(from.camera);
    } finally {
      busy = false;
    }
  };
  const o1 = a.camera.onViewMatrixChangedObservable.add(() => mirror(a, b));
  const o2 = b.camera.onViewMatrixChangedObservable.add(() => mirror(b, a));
  return () => {
    a.camera.onViewMatrixChangedObservable.remove(o1);
    b.camera.onViewMatrixChangedObservable.remove(o2);
  };
}
