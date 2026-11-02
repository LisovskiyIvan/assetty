import { app } from "../app";
import { el, fmtBytes, kv, psnrBadge, section, clear } from "../ui";
import type { EncodeResult, ImageInfo } from "../types";
import type { TabHandle } from "./types";

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
  let busy = false;
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
    if (last && last.image.index === img.index) {
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
      listHost.append(
        el("div", {
          class: "empty",
          text: app.pathA ? "no images in this asset" : "select a .glb in the sidebar",
        }),
      );
      return;
    }
    const rows = images.map((img) =>
      el(
        "tr",
        {
          class: `clickable ${img.index === selected ? "selected" : ""}`,
          onclick: () => {
            selected = img.index;
            last = null;
            renderList();
            renderSide();
            encodeBtn.disabled = !app.bridge.live || busy;
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
          img.has_mips
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
    if (path) {
      try {
        const res = await app.bridge.textures(path);
        images = res.images.slice().sort((a, b) => a.index - b.index);
      } catch (err) {
        app.toast(`textures failed: ${(err as Error).message}`, "error");
      }
    }
    renderList();
    renderSide();
    encodeBtn.disabled = true;
  }

  encodeBtn.addEventListener("click", async () => {
    const path = app.pathA;
    const img = images[selected];
    if (!path || !img || busy) return;
    busy = true;
    encodeBtn.disabled = true;
    encodeBtn.textContent = "encoding…";
    try {
      const result = await app.bridge.textureEncode(path, img.index);
      last = { image: img, result };
      renderSide();
      app.toast(
        `image ${img.index}: ${fmtBytes(result.ktx2_size)} @ ${result.psnr.toFixed(1)} dB`,
        "ok",
      );
    } catch (err) {
      app.toast(`encode failed: ${(err as Error).message}`, "error");
    } finally {
      busy = false;
      encodeBtn.textContent = "Encode to KTX2";
      encodeBtn.disabled = false;
    }
  });

  const offPath = app.on("path", (d) => {
    if (d.slot !== "a") return;
    void reload();
  });

  return {
    el: root,
    activate: () => {
      void reload();
    },
    dispose: () => offPath(),
  };
}
