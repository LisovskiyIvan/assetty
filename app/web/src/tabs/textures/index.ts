/** Textures tab mount + preview/encode runs + reload + subscriptions. */
import { app } from "../../app";
import { isMissingMethodError, notify } from "../../notify";
import { onLang, t } from "../../i18n";
import { el, fmtBytes } from "../../ui";
import {
  createSeq,
  createSettingsEdit,
  isBusyError,
  isCancelledError,
  isFormTarget,
  isOverlayOpen,
  isTabVisible,
  notifyJobError,
} from "../../guards";
import {
  claimJob,
  getJob,
  jobLabelKey,
  onJobChange,
  releaseJob,
  setJobCancelling,
} from "../../jobs";
import { clearTextureOverride, replaceTextureOverride, onSettingsChange } from "../../settings";
import type { TextureOverride } from "../../settings";
import type { EncodeResult, ImageInfo, TexturePreview } from "../../types";
import type { TabHandle } from "../types";
import { closeFieldHelp } from "../../optimizeForm";
import { buildApplyBar, createApplyFlow } from "./apply";
import { effectiveFor, previewUrlFor, renderSidePanel } from "./panel";
import type { CompareImages } from "./panel";
import { refreshOverrideBadges, renderTextureList } from "./list";

const ENCODE_TIMEOUT_MS = 10 * 60 * 1000;
const PREVIEW_TIMEOUT_MS = 20_000;

/** One in-flight encode; the token invalidates replies from an older request. */
interface ActiveEncode {
  token: number;
  index: number;
  path: string;
}

export function mountTextures(): TabHandle {
  const root = el("div", { class: "tab-body textures-tab" });
  const main = el("div", { class: "tab-main" });
  const headLabel = el("span", { text: t("tex.images") });
  const headNote = el("span", { class: "muted mono", text: t("tex.viewApply") });
  const head = el("div", { class: "panel-head" }, headLabel, headNote);
  const listHost = el("div", { class: "texture-list" });

  const bar = buildApplyBar();
  const applyFlow = createApplyFlow(bar);
  main.append(head, bar.bar, listHost);

  const side = el("div", { class: "tab-side" });
  root.append(main, side);

  let images: ImageInfo[] = [];
  let selected = -1;
  /** Guards the settings subscription against this tab's own override writes. */
  const selfEdit = createSettingsEdit();

  /* ------------------------------------------------------------- preview state */

  /** Last decoded preview; only rendered when it belongs to the selected image. */
  let preview: TexturePreview | null = null;
  /** Index whose preview is in flight (spinner row badge). */
  let previewing: number | null = null;
  let previewError: string | null = null;
  let previewErrorIndex: number | null = null;
  const previewSeq = createSeq();
  let previewTimer: ReturnType<typeof setTimeout> | null = null;

  /* -------------------------------------------------------------- encode state */

  let activeEncode: ActiveEncode | null = null;
  /** Cancel requested: the terminal encode-done event is still pending. */
  let cancellingEncode = false;
  const encodeSeq = createSeq();
  let encodeTimer: ReturnType<typeof setTimeout> | null = null;
  const results = new Map<number, EncodeResult>();
  const compares = new Map<number, CompareImages>();
  /** Bumped when the model changes so late compare loads cannot land on it. */
  const compareGen = createSeq();

  const encodeBtn = el("button", {
    class: "primary",
    text: t("tex.encodeBtn"),
    disabled: true,
  }) as HTMLButtonElement;

  function renderList(): void {
    renderTextureList(
      listHost,
      {
        images,
        selected,
        previewing,
        activeEncodeIndex: activeEncode?.index ?? null,
      },
      (index) => selectImage(index),
    );
  }

  function renderSide(): void {
    const bus = getJob();
    const otherKind = !activeEncode && bus.kind !== null && bus.kind !== "encode" ? bus.kind : null;
    renderSidePanel(
      side,
      {
        images,
        selected,
        preview,
        previewing,
        previewError,
        previewErrorIndex,
        results,
        encoding: activeEncode !== null,
        cancelling: cancellingEncode,
        busyNote: otherKind ? t("job.busyNote", { job: t(jobLabelKey(otherKind)) }) : null,
        encodeBtn,
        previewActs: bar.previewActs,
      },
      {
        onDeselect: () => deselect(),
        onEncode: () => void startEncode(),
        onCancelEncode: () => void cancelEncode(),
        onApplyShortcut: (settings) => void applyFlow.start(settings),
        commitOverride: (src: string, patch: TextureOverride) => {
          selfEdit.wrap(() => {
            replaceTextureOverride(src, patch);
          });
          refreshOverrideBadges(listHost, side, images);
          applyFlow.sync();
        },
        resetOverride: (src: string, img: ImageInfo) => {
          clearTextureOverride(src, img.index);
          renderList();
          renderSide();
          applyFlow.sync();
        },
      },
      compares,
    );
  }

  /* --------------------------------------------------------------- preview run */

  function clearPreviewTimer(): void {
    if (previewTimer) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
  }

  function armPreviewTimeout(seq: number, index: number): void {
    clearPreviewTimer();
    previewTimer = setTimeout(() => {
      previewTimer = null;
      if (!previewSeq.check(seq) || previewing !== index) return;
      previewing = null;
      previewError = t("tex.timeoutMsg");
      previewErrorIndex = index;
      renderList();
      renderSide();
      notify(t("tex.previewTimeout"), "error");
    }, PREVIEW_TIMEOUT_MS);
  }

  function applyPreview(index: number, result: TexturePreview): void {
    clearPreviewTimer();
    previewing = null;
    preview = { ...result, index };
    previewError = result.b64 ? null : t("tex.previewUnavailable");
    previewErrorIndex = result.b64 ? null : index;
    renderList();
    renderSide();
  }

  async function requestPreview(index: number): Promise<void> {
    const path = app.viewPath ?? (!app.bridge.live ? "/demo/DamagedHelmet.glb" : null);
    if (!path) return;
    const token = previewSeq.next();
    previewing = index;
    preview = null;
    previewError = null;
    previewErrorIndex = null;
    clearPreviewTimer();
    renderList();
    renderSide();
    try {
      const img = images.find((i) => i.index === index);
      const call = await app.bridge.texturePreview(
        path,
        index,
        img ? effectiveFor(img) : undefined,
      );
      if (!previewSeq.check(token)) return; // another row was clicked meanwhile
      if (call.started) {
        armPreviewTimeout(token, index);
        return;
      }
      applyPreview(index, call.result);
    } catch (err) {
      if (!previewSeq.check(token)) return;
      previewing = null;
      clearPreviewTimer();
      const missing = isMissingMethodError(err);
      const busy = isBusyError(err);
      const message = busy ? t("tex.previewBusy") : (err as Error).message;
      previewError = missing ? t("tex.notSupported") : message;
      previewErrorIndex = index;
      notify(
        missing
          ? t("tex.previewNoHost")
          : busy
            ? t("tex.previewBusy")
            : t("tex.previewFail", { message }),
        "error",
      );
      renderList();
      renderSide();
    }
  }

  function selectImage(index: number): void {
    selected = index;
    previewSeq.bump(); // cancel any in-flight preview from the previous row
    preview = null;
    previewing = null;
    previewError = null;
    previewErrorIndex = null;
    clearPreviewTimer();
    renderList();
    renderSide();
    const cached = results.get(index);
    if (cached) void loadCompare(index, cached);
    void requestPreview(index);
  }

  /** Close the detail panel (✕ button or Escape). */
  function deselect(): void {
    selected = -1;
    previewSeq.bump(); // cancel any in-flight preview
    preview = null;
    previewing = null;
    previewError = null;
    previewErrorIndex = null;
    clearPreviewTimer();
    renderList();
    renderSide();
  }

  /* ---------------------------------------------------------------- encodes */

  function clearEncodeState(): void {
    if (encodeTimer) {
      clearTimeout(encodeTimer);
      encodeTimer = null;
    }
    releaseJob("encode");
    activeEncode = null;
    cancellingEncode = false;
  }

  /** Timeout never frees the gate: the terminal event is still owed, so keep
   * waiting (and keep Cancel available). Re-arms until the done event lands. */
  function armEncodeTimer(token: number): void {
    if (encodeTimer) clearTimeout(encodeTimer);
    encodeTimer = setTimeout(() => {
      encodeTimer = null;
      if (!encodeSeq.check(token) || !activeEncode) return;
      renderList();
      renderSide();
      notify(t("job.stillRunning"), "info");
      armEncodeTimer(token);
    }, ENCODE_TIMEOUT_MS);
  }

  /** Neutral end of a user-cancelled encode: info, never error; kept results stay. */
  function finishEncodeCancelled(): void {
    clearEncodeState();
    renderList();
    renderSide();
    notify(t("job.cancelled"), "info");
  }

  /**
   * Asks the host to stop the in-flight encode. The gate frees only on the
   * terminal encode-done event, so nothing releases here. A refused/failed
   * request restores Cancel while the job keeps running; the token guard
   * keeps a late RPC from touching a job that already finished meanwhile.
   */
  async function cancelEncode(): Promise<void> {
    if (!activeEncode || cancellingEncode) return;
    const token = activeEncode.token;
    cancellingEncode = true;
    setJobCancelling("encode", true);
    renderList();
    renderSide();
    let accepted = false;
    let failed = false;
    try {
      accepted = (await app.bridge.cancelJob()).cancelled;
    } catch (err) {
      failed = true;
      notify(t("job.cancelFail", { message: (err as Error).message }), "error");
    }
    if (activeEncode?.token !== token) return; // finished while the RPC flew
    if (!accepted) {
      cancellingEncode = false;
      setJobCancelling("encode", false);
      renderList();
      renderSide();
      if (!failed) notify(t("job.stillRunning"), "info");
    }
  }

  function applyEncode(index: number, result: EncodeResult): void {
    const image = images.find((i) => i.index === index);
    clearEncodeState();
    if (!image) return;
    results.set(index, result);
    compares.delete(index);
    renderList();
    renderSide();
    if (selected === index) void loadCompare(index, result);
    notify(
      t("tex.encodeDone", {
        index,
        size: fmtBytes(result.ktx2_size),
        psnr: result.psnr.toFixed(1),
      }),
      "ok",
    );
  }

  async function loadCompare(index: number, result: EncodeResult): Promise<void> {
    if (compares.has(index)) return;
    if (!result.before_png && !result.after_png) {
      // Legacy payload: no rendered previews, keep the decoded original if we have it.
      compares.set(index, { before: previewUrlFor(preview, index), after: null });
      renderSide();
      return;
    }
    const gen = compareGen.current();
    const [before, after] = await Promise.all([
      result.before_png ? app.bridge.pngDataUrl(result.before_png) : Promise.resolve(null),
      result.after_png ? app.bridge.pngDataUrl(result.after_png) : Promise.resolve(null),
    ]);
    if (!compareGen.check(gen)) return;
    compares.set(index, { before: before ?? previewUrlFor(preview, index), after });
    if (selected === index) renderSide();
  }

  async function startEncode(): Promise<void> {
    const path = app.viewPath;
    const img = images.find((i) => i.index === selected);
    if (!path || !img || activeEncode) return;
    const other = getJob();
    if (other.kind !== null) {
      notify(t("job.busyNote", { job: t(jobLabelKey(other.kind)) }), "error");
      return;
    }
    const token = encodeSeq.next();
    claimJob("encode");
    activeEncode = { token, index: img.index, path };
    cancellingEncode = false;
    renderList();
    renderSide();
    try {
      const call = await app.bridge.textureEncode(path, img.index, effectiveFor(img));
      if (!encodeSeq.check(token) || activeEncode?.token !== token) return;
      if (call.started) {
        armEncodeTimer(token);
        return;
      }
      releaseJob("encode");
      applyEncode(img.index, call.result);
    } catch (err) {
      if (!encodeSeq.check(token)) return;
      clearEncodeState();
      renderList();
      renderSide();
      notifyJobError(err, t("tex.encodeBusy"), (message) => t("tex.encodeFail", { message }));
    }
  }

  const offPreviewDone = app.bridge.onTexturePreviewDone((event) => {
    const current = previewing;
    if (current === null) return;
    if (event.index >= 0 && event.index !== current) return;
    if (!event.ok) {
      clearPreviewTimer();
      previewing = null;
      previewError = event.error;
      previewErrorIndex = current;
      renderList();
      renderSide();
      notify(t("tex.previewFail", { message: event.error }), "error");
      return;
    }
    applyPreview(event.index >= 0 ? event.index : current, event.result);
  });

  // Background encode: the call resolves with `{ started: true }` and the real
  // result arrives here (new hosts). Old hosts return the result directly.
  const offDone = app.bridge.onTextureEncodeDone((event) => {
    const active = activeEncode;
    if (!active) return;
    if (event.index >= 0 && event.index !== active.index) return;
    if (active.path !== app.viewPath) {
      // Model changed while the job ran: the result no longer applies.
      clearEncodeState();
      renderList();
      renderSide();
      return;
    }
    if (!event.ok) {
      if (isCancelledError(event.error)) {
        finishEncodeCancelled();
        return;
      }
      clearEncodeState();
      renderList();
      renderSide();
      notify(t("tex.encodeFail", { message: event.error }), "error");
      return;
    }
    applyEncode(event.index >= 0 ? event.index : active.index, event.result);
  });

  encodeBtn.addEventListener("click", () => void startEncode());

  const offApplySettings = onSettingsChange(() => {
    if (!selfEdit.isInternal()) {
      renderList();
      renderSide();
    }
    applyFlow.sync();
  });

  // Instant language switch: every string in this tab re-renders from the
  // active dictionary (the row editor keeps no static text of its own).
  const offLang = onLang(() => {
    headLabel.textContent = t("tex.images");
    headNote.textContent = t("tex.viewApply");
    bar.applyHint.textContent = t("tex.previewDry");
    bar.firstRunHint.textContent = t("tex.firstRun");
    applyFlow.syncLang();
    renderList();
    renderSide();
  });

  /* ------------------------------------------------------------------ reload */

  async function reload(): Promise<void> {
    const path = app.viewPath;
    const keep = selected;
    images = [];
    selected = -1;
    preview = null;
    previewing = null;
    previewError = null;
    previewErrorIndex = null;
    clearPreviewTimer();
    previewSeq.bump();
    compareGen.bump();
    // An in-flight encode keeps its claim: the backend still owns the gate
    // and the terminal event finalizes it (path-mismatch releases safely).
    // Only the seq is NOT bumped for the encode — stale encode replies must
    // still land while the job runs. Preview seqs are bumped above.
    if (!activeEncode) clearEncodeState();
    applyFlow.reset();
    applyFlow.syncActsOn();
    results.clear();
    compares.clear();
    renderList();
    renderSide();
    if (path || !app.bridge.live) {
      try {
        const res = await app.bridge.textures(path ?? "/demo/DamagedHelmet.glb");
        images = res.images.slice().sort((a, b) => a.index - b.index);
      } catch (err) {
        notify(t("tex.texturesFail", { message: (err as Error).message }), "error");
      }
    }
    /* Keep the selection when the same image survives the reload, else deselect. */
    selected = images.some((i) => i.index === keep) ? keep : -1;
    renderList();
    renderSide();
    if (selected >= 0) void requestPreview(selected);
  }

  const offView = app.on("view", () => {
    void reload();
  });
  const offSource = app.on("source", () => {
    applyFlow.sync();
    applyFlow.syncActsOn();
    refreshOverrideBadges(listHost, side, images);
    renderList();
    renderSide();
  });

  const onKey = (ev: KeyboardEvent): void => {
    // Hidden tabs never act (both tabs stay mounted); held keys don't repeat.
    if (ev.key !== "Escape" || ev.repeat || !isTabVisible(root)) return;
    if (isFormTarget(ev.target) || isOverlayOpen()) return;
    // One Escape = one action: a running job first (encode, then apply), else
    // the row selection. Open menus own Escape (see isOverlayOpen).
    if (activeEncode && !cancellingEncode) {
      void cancelEncode();
      return;
    }
    if (applyFlow.isRunning()) {
      void applyFlow.cancel();
      return;
    }
    if (cancellingEncode) return; // terminal event still pending
    if (selected >= 0) deselect();
  };
  document.addEventListener("keydown", onKey);

  // Another tab claimed the gate (optimize/LODs): reflect it in the buttons.
  const offJob = onJobChange(() => {
    renderList();
    renderSide();
    applyFlow.sync();
  });

  return {
    el: root,
    activate: () => {
      void reload();
    },
    deactivate: () => {
      closeFieldHelp();
    },
    dispose: () => {
      document.removeEventListener("keydown", onKey);
      offView();
      offSource();
      offDone();
      offPreviewDone();
      offApplySettings();
      offLang();
      offJob();
      applyFlow.dispose();
      // Unmount never frees an in-flight gate: the backend still owns it.
      if (!activeEncode) clearEncodeState();
      else if (encodeTimer) {
        clearTimeout(encodeTimer);
        encodeTimer = null;
      }
      clearPreviewTimer();
      previewSeq.bump();
      encodeSeq.bump();
      compareGen.bump();
    },
  };
}
