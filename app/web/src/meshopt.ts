/**
 * Meshopt geometry decoder wiring (`EXT_meshopt_compression`).
 *
 * Babylon's glTF loader decodes compressed buffer views through
 * `MeshoptCompression`, which loads a decoder script through
 * `MeshoptCompression.Configuration.decoder.url`. The decoder is vendored
 * under `public/meshopt/` (single self-contained file, wasm embedded) so the
 * WKWebView works fully offline — same pattern as `ktx2.ts`.
 *
 * Resolve everything relative to `document.baseURI` because vite is configured
 * with `base: "./"`.
 */
import { MeshoptCompression } from "@babylonjs/core/Meshes/Compression/meshoptCompression";
import "@babylonjs/loaders/glTF/2.0/Extensions/EXT_meshopt_compression";
import { t } from "./i18n";
import { notify } from "./notify";

let configured = false;

export function meshoptDecoderUrl(): string {
  return new URL("meshopt/meshopt_decoder.js", document.baseURI).href;
}

/** URL Babylon needs; also used by the boot-time availability check. */
export function meshoptAssetUrls(): string[] {
  return [meshoptDecoderUrl()];
}

export function configureMeshopt(): void {
  if (configured) return;
  configured = true;
  MeshoptCompression.Configuration = {
    decoder: {
      url: meshoptDecoderUrl(),
    },
  };
}

/**
 * Probes the vendored decoder payload so a missing/renamed file is reported
 * at boot instead of surfacing later as an unloadable compressed model.
 */
export async function checkMeshoptAssets(): Promise<string[]> {
  const missing: string[] = [];
  await Promise.all(
    meshoptAssetUrls().map(async (url) => {
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

/** Reports a meshopt decode failure once (Babylon can log dozens per model). */
export function reportMeshoptFailure(detail: string): void {
  const now = Date.now();
  if (now - warnedTime < 3000) return;
  warnedTime = now;
  notify(t("toast.decodeFail", { detail: detail }), "error");
}
