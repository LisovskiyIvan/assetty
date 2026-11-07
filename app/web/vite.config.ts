import { defineConfig } from "vite";

// Served from the nanoui WKWebView with a custom/file scheme, so every URL must
// be relative. `public/` holds the vendored KTX2/basis transcoders and is copied
// verbatim into `dist/`.
export default defineConfig({
  base: "./",
  publicDir: "public",
  build: {
    outDir: "dist",
    assetsDir: "assets",
    target: "es2022",
    sourcemap: false,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 1500,
    emptyOutDir: true,
  },
  server: {
    port: 5178,
    strictPort: true,
  },
  preview: {
    port: 5179,
  },
  esbuild: {
    legalComments: "none",
  },
});
