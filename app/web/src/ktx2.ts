/**
 * KTX2 / basis transcoder wiring.
 *
 * Babylon 9 fetches its decoder through `KhronosTextureContainer2.URLConfig`.
 * All decoder payloads are vendored under `public/ktx2/` so the WKWebView works
 * fully offline. `public/basis/` additionally carries the classic basis
 * transcoder (used by .basis files).
 *
 * Resolve everything relative to `document.baseURI` because vite is configured
 * with `base: "./"`: the app may be served from a file:// or custom scheme root.
 *
 * Decoding happens on the main thread (`DefaultNumWorkers = 0`): the nanoui
 * WKWebView serves the app from a custom scheme, where a blob-worker has no
 * guaranteed access to `fetch`/`WebAssembly` of the vendored wasm payloads.
 * Main-thread decoding only costs a one-off module load and avoids a silent
 * worker-init failure (Babylon reports those as a bare `Logger.Warn`).
 */
import { KhronosTextureContainer2 } from "@babylonjs/core/Misc/khronosTextureContainer2";
import "@babylonjs/core/Materials/Textures/Loaders/index";
import { notify } from "./notify";

let configured = false;

export function ktx2BaseUrl(): string {
  return new URL("ktx2/", document.baseURI).href;
}

export function basisBaseUrl(): string {
  return new URL("basis/", document.baseURI).href;
}

/** URLs Babylon needs; also used by the boot-time availability check. */
export function ktx2AssetUrls(): string[] {
  const base = ktx2BaseUrl();
  return [
    `${base}babylon.ktx2Decoder.js`,
    `${base}msc_basis_transcoder.js`,
    `${base}msc_basis_transcoder.wasm`,
    `${base}uastc_astc.wasm`,
    `${base}uastc_bc7.wasm`,
    `${base}uastc_rgba8_unorm_v2.wasm`,
    `${base}uastc_rgba8_srgb_v2.wasm`,
    `${base}uastc_r8_unorm.wasm`,
    `${base}uastc_rg8_unorm.wasm`,
    `${base}zstddec.wasm`,
  ];
}

export function configureKtx2(): void {
  if (configured) return;
  configured = true;

  // Decode in the current thread; see the module comment above.
  KhronosTextureContainer2.DefaultNumWorkers = 0;
  // Uncompressed RGBA is the safest fallback when ASTC/BC7 are unavailable
  // (software renderers, older GPUs): still better than a blank texture.
  KhronosTextureContainer2.DefaultDecoderOptions.useRGBAIfASTCBC7NotAvailableWhenUASTC = true;

  const base = ktx2BaseUrl();
  const url = KhronosTextureContainer2.URLConfig;
  url.jsDecoderModule = `${base}babylon.ktx2Decoder.js`;
  url.wasmUASTCToASTC = `${base}uastc_astc.wasm`;
  url.wasmUASTCToBC7 = `${base}uastc_bc7.wasm`;
  url.wasmUASTCToRGBA_UNORM = `${base}uastc_rgba8_unorm_v2.wasm`;
  url.wasmUASTCToRGBA_SRGB = `${base}uastc_rgba8_srgb_v2.wasm`;
  url.wasmUASTCToR8_UNORM = `${base}uastc_r8_unorm.wasm`;
  url.wasmUASTCToRG8_UNORM = `${base}uastc_rg8_unorm.wasm`;
  url.jsMSCTranscoder = `${base}msc_basis_transcoder.js`;
  url.wasmMSCTranscoder = `${base}msc_basis_transcoder.wasm`;
  url.wasmZSTDDecoder = `${base}zstddec.wasm`;
}

/**
 * Probes the vendored decoder payloads so a missing/renamed file is reported
 * at boot instead of surfacing later as a blank texture. Resolves the list of
 * unreachable URLs (empty when everything is in place).
 */
export async function checkKtx2Assets(): Promise<string[]> {
  const missing: string[] = [];
  await Promise.all(
    ktx2AssetUrls().map(async (url) => {
      try {
        const res = await fetch(url, { method: "HEAD", cache: "no-store" });
        // A scheme handler may reject HEAD; only a definitive 404 counts.
        if (res.status === 404 || res.status === 403) missing.push(new URL(url).pathname);
      } catch {
        // fetch unavailable for this scheme — decoding will surface its own error
      }
    }),
  );
  return missing;
}

let warnedTime = 0;

/** Reports a decoder failure once (Babylon can log dozens per model). */
export function reportDecoderFailure(detail: string): void {
  const now = Date.now();
  if (now - warnedTime < 3000) return;
  warnedTime = now;
  notify(`texture decode failed: ${detail}`, "error");
}
