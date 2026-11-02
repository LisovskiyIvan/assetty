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
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Material } from "@babylonjs/core/Materials/material";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import "@babylonjs/loaders/glTF";
import { b64ToBytes } from "./bridge";

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
  private disposed = false;

  onProgress?: (label: string) => void;

  constructor(canvas: HTMLCanvasElement, label = "scene") {
    this.canvas = canvas;
    this.engine = new Engine(canvas, true, {
      antialias: true,
      adaptToDeviceRatio: true,
      stencil: true,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    });

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

    this.highlight = new HighlightLayer("hl", this.scene, {
      blurHorizontalSize: 1.2,
      blurVerticalSize: 1.2,
    });
    this.highlight.innerGlow = false;

    this.engine.runRenderLoop(this.renderLoop);

    // Snapshot the engine's per-frame draw call counter (otherwise it accumulates).
    const drawCounter = (this.engine as unknown as { _drawCalls?: { fetchNewFrame?: () => void } })
      ._drawCalls;
    if (drawCounter?.fetchNewFrame) {
      this.scene.onBeforeRenderObservable.add(() => drawCounter.fetchNewFrame?.());
    }

    this.resizeObserver = new ResizeObserver(() => this.engine.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    window.addEventListener("resize", this.resize);
  }

  resize = (): void => {
    if (!this.disposed) this.engine.resize();
  };

  private renderLoop = (): void => {
    if (!this.disposed) this.scene.render();
  };

  private running = true;

  /** Stops rendering while the tab is hidden (saves GPU on background tabs). */
  pause(): void {
    if (this.disposed || !this.running) return;
    this.engine.stopRenderLoop();
    this.running = false;
  }

  resume(): void {
    if (this.disposed) return;
    this.engine.resize();
    if (this.running) return;
    this.engine.runRenderLoop(this.renderLoop);
    this.running = true;
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
    const container = await LoadAssetContainerAsync(bytes, this.scene, { pluginExtension: ".glb" });
    container.addAllToScene();
    container.animationGroups.forEach((g) => g.stop());
    this.frameAll();
    this.onProgress?.(undefined as unknown as string);
  }

  /** Placeholder geometry so the layout is usable without nanoui. */
  loadDemo(): void {
    this.clearScene();
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
  }

  clearScene(): void {
    this.highlight.removeAllMeshes();
    this.scene.animationGroups.slice().forEach((g) => g.stop());
    this.scene.meshes.slice().forEach((m) => m.dispose());
    this.scene.materials.slice().forEach((m) => m.dispose());
    this.scene.textures.slice().forEach((t) => t.dispose());
    this.scene.transformNodes.slice().forEach((n) => n.dispose());
    this.scene.animationGroups.slice().forEach((g) => g.dispose());
  }

  /** Frames the whole scene; deferred one frame so bounds reflect uploaded geometry. */
  frameAll(): void {
    this.scene.onAfterRenderObservable.addOnce(() => this.frameNow());
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
  }

  getStats(): ViewerStats {
    const active = this.scene.getActiveMeshes();
    const indices = this.scene.getActiveIndices();
    const engineAny = this.engine as unknown as { _drawCalls?: { current?: number } };
    const drawCalls = engineAny._drawCalls?.current ?? active.length;
    return {
      fps: this.engine.getFps(),
      meshes: this.scene.meshes.length,
      triangles: Math.round(indices / 3),
      drawCalls,
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
    if (!mesh) return;
    const color = new Color3(0.31, 0.64, 1);
    // HighlightLayer only accepts concrete meshes; instanced/abstract nodes are skipped.
    const asMesh = (m: AbstractMesh) => (m.getTotalVertices() > 0 ? (m as unknown as Mesh) : null);
    const target = asMesh(mesh);
    if (target) this.highlight.addMesh(target, color);
    for (const child of mesh.getChildMeshes(false)) {
      const childMesh = asMesh(child);
      if (childMesh) this.highlight.addMesh(childMesh, color);
    }
    this.highlighted = mesh;
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
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("resize", this.resize);
    this.resizeObserver.disconnect();
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }
}

/** Links two scenes so panning/zooming one mirrors on the other. */
export function linkCameras(a: ViewerScene, b: ViewerScene): void {
  let busy = false;
  const mirror = (from: ViewerScene, to: ViewerScene) => {
    if (busy) return;
    busy = true;
    try {
      to.applyCameraFrom(from.camera);
    } finally {
      busy = false;
    }
  };
  a.camera.onViewMatrixChangedObservable.add(() => mirror(a, b));
  b.camera.onViewMatrixChangedObservable.add(() => mirror(b, a));
}
