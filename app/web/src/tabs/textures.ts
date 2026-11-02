import { app } from "../app";
import { isBusyError } from "../bridge";
import { el, fmtBytes, kv, psnrBadge, section, clear, emptyState, OPEN_HINT } from "../ui";
import type { EncodeResult, ImageInfo } from "../types";
import type { TabHandle } from "./types";

const ENCODE_TIMEOUT_MS = 10 * 60 * 1000;

export function mountTextures(): TabHandle {
  const root = el("div", { class: "tab-body" });
  const main = el("div", { class: "tab-main" });
  const head = el(
    "div",
    { class: "panel-head" },
    el("span", { text: "images" }),
    el("span", { class: "muted mono", text: "source: info()" }),
  );
  const listHost = el("div", { style: { overflow: "auto", flex: "1" } });
  main.append(head, listHost);

  const side = el("div", { class: "tab-side" });
  root.append(main, side);

  let images: ImageInfo[] = [];
  let selected = -1;
  /** Index of the image whose async encode is in flight (null when idle). */
  let encoding: number | null = null;
  let encodeTimer: ReturnType<typeof setTimeout> | null = null;
  let last: { image: ImageInfo; result: EncodeResult } | null = null;

  const encodeBtn = el("button", {
    class: "primary",
    text: "Encode to KTX2",
    disabled: true,
  });

  function renderSide(): void {
    clear(side);
    const img = images[selected];
    if (!img) {
      side.append(section("Image", el("div", { class: "empty", text: "select an image" })));
      side.append(
        section(
          "Encode",
          el("div", { class: "muted", text: "pick an image, then encode with basisu" }),
        ),
      );
      return;
    }
    side.append(
      section(
        "Image",
        kv([
          ["index", String(img.index)],
          ["name", img.name ?? "—"],
          ["format", img.format],
          ["size", `${img.width}×${img.height}`],
          ["disk", fmtBytes(img.disk)],
          ["vram", fmtBytes(img.vram)],
          ["mips", img.has_mips ? "yes" : "no"],
        ]),
      ),
    );
    const resultHost = el("div", { class: "panel-body" });
    if (encoding === img.index) {
      resultHost.append(el("span", { class: "badge yellow", text: "encoding…" }));
    } else if (last && last.image.index === img.index) {
      const r = last.result;
      resultHost.append(
        el(
          "div",
          { class: "row spread" },
          el("span", { class: "muted", text: "PSNR" }),
          psnrBadge(r.psnr),
        ),
        kv([
          ["ktx2 size", fmtBytes(r.ktx2_size)],
          ["vram after", fmtBytes(r.vram_after)],
          ["disk delta", `${fmtBytes(r.ktx2_size - img.disk)}`],
          ["vram delta", `${fmtBytes(r.vram_after - img.vram)}`],
        ]),
      );
    } else {
      resultHost.append(el("div", { class: "muted", text: "not encoded yet" }));
    }
    encodeBtn.textContent = encoding === null ? "Encode to KTX2" : "encoding…";
    encodeBtn.disabled = !app.bridge.live || encoding !== null;
    side.append(
      section(
        "Encode",
        el("div", { class: "row" }, encodeBtn),
        el("div", {
          class: "hint",
          text: "basisu transcode → .ktx2; PSNR > 35 dB is visually lossless-ish",
        }),
        resultHost,
      ),
    );
  }

  function renderList(): void {
    clear(listHost);
    if (images.length === 0) {
      if (app.pathA) {
        listHost.append(el("div", { class: "empty", text: "no images in this asset" }));
      } else {
        listHost.append(
          emptyState(OPEN_HINT, { label: "Open…", onClick: () => void app.pickAndOpen() }),
        );
      }
      return;
    }
    const rows = images.map((img) =>
      el(
        "tr",
        {
          class: `clickable ${img.index === selected ? "selected" : ""} ${
            img.index === encoding ? "encoding" : ""
          }`,
          onclick: () => {
            selected = img.index;
            last = null;
            renderList();
            renderSide();
          },
        },
        el("td", { class: "mono", text: String(img.index) }),
        el("td", { text: img.name ?? "—" }),
        el("td", { class: "mono", text: img.format }),
        el("td", { class: "num", text: `${img.width}×${img.height}` }),
        el("td", { class: "num", text: fmtBytes(img.disk) }),
        el("td", { class: "num", text: fmtBytes(img.vram) }),
        el(
          "td",
          null,
          img.index === encoding
            ? el("span", { class: "badge yellow", text: "encoding…" })
            : img.has_mips
              ? el("span", { class: "badge green", text: "mips" })
              : el("span", { class: "badge dim", text: "no mips" }),
        ),
      ),
    );
    listHost.append(
      el(
        "table",
        null,
        el(
          "thead",
          null,
          el(
            "tr",
            null,
            el("th", { text: "#" }),
            el("th", { text: "name" }),
            el("th", { text: "format" }),
            el("th", { class: "num", text: "size" }),
            el("th", { class: "num", text: "disk" }),
            el("th", { class: "num", text: "vram" }),
            el("th", { text: "" }),
          ),
        ),
        el("tbody", null, ...rows),
      ),
    );
  }

  async function reload(): Promise<void> {
    const path = app.pathA;
    images = [];
    selected = -1;
    last = null;
    clearEncodeState();
    if (path || !app.bridge.live) {
      try {
        const res = await app.bridge.textures(path ?? "/demo/DamagedHelmet.glb");
        images = res.images.slice().sort((a, b) => a.index - b.index);
      } catch (err) {
        app.toast(`textures failed: ${(err as Error).message}`, "error");
      }
    }
    renderList();
    renderSide();
    encodeBtn.disabled = true;
  }

  function clearEncodeState(): void {
    if (encodeTimer) {
      clearTimeout(encodeTimer);
      encodeTimer = null;
    }
    encoding = null;
  }

  function applyEncode(index: number, result: EncodeResult): void {
    clearEncodeState();
    const image = images.find((i) => i.index === index) ?? images[selected];
    if (!image) return;
    last = { image, result };
    renderList();
    renderSide();
    app.toast(
      `image ${image.index}: ${fmtBytes(result.ktx2_size)} @ ${result.psnr.toFixed(1)} dB`,
      "ok",
    );
  }

  // Background encode: the call resolves with `{ started: true }` and the real
  // result arrives here (new hosts). Old hosts return the result directly.
  const offDone = app.bridge.onTextureEncodeDone((event) => {
    if (encoding === null) return;
    if (event.index >= 0 && event.index !== encoding) return;
    if (!event.ok) {
      clearEncodeState();
      renderList();
      renderSide();
      app.toast(`encode failed: ${event.error}`, "error");
      return;
    }
    applyEncode(event.index >= 0 ? event.index : encoding, event.result);
  });

  encodeBtn.addEventListener("click", async () => {
    const path = app.pathA;
    const img = images[selected];
    if (!path || !img || encoding !== null) return;
    const index = img.index;
    encoding = index;
    encodeBtn.disabled = true;
    encodeBtn.textContent = "encoding…";
    renderList();
    renderSide();
    try {
      const call = await app.bridge.textureEncode(path, index);
      if (call.started) {
        // Run stays disabled until textureEncodeDone arrives.
        encodeTimer = setTimeout(() => {
          encodeTimer = null;
          if (encoding !== index) return;
          clearEncodeState();
          renderList();
          renderSide();
          app.toast("texture encode timed out — no completion event", "error");
        }, ENCODE_TIMEOUT_MS);
        return;
      }
      applyEncode(index, call.result);
    } catch (err) {
      clearEncodeState();
      renderList();
      renderSide();
      app.toast(
        isBusyError(err)
          ? "texture encode already running — wait for it to finish"
          : `encode failed: ${(err as Error).message}`,
        "error",
      );
    }
  });

  const offPath = app.on("path", () => {
    void reload();
  });

  return {
    el: root,
    activate: () => {
      void reload();
    },
    dispose: () => {
      offPath();
      offDone();
      clearEncodeState();
    },
  };
}
