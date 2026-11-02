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
 */
import { KhronosTextureContainer2 } from "@babylonjs/core/Misc/khronosTextureContainer2";
import "@babylonjs/core/Materials/Textures/Loaders/index";

let configured = false;

export function ktx2BaseUrl(): string {
  return new URL("ktx2/", document.baseURI).href;
}

export function basisBaseUrl(): string {
  return new URL("basis/", document.baseURI).href;
}

export function configureKtx2(): void {
  if (configured) return;
  configured = true;
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
