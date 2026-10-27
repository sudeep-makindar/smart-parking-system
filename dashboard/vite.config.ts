import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The production build is stored in the ESP32-S3's SPIFFS partition.
// SPIFFS limits file names to 31 characters (including the leading "/"),
// so everything is emitted flat into dist/ with short hashed names,
// e.g. /a-3kF9xQ2b.js -> /a-3kF9xQ2b.js.gz after gzip (16 chars).
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    assetsDir: "",
    target: "es2019",
    cssCodeSplit: false,
    modulePreload: false,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      output: {
        entryFileNames: "a-[hash:8].js",
        chunkFileNames: "c-[hash:8].js",
        assetFileNames: "a-[hash:8][extname]",
        // One JS file = fewer HTTP requests for the ESP32 to serve
        inlineDynamicImports: true,
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});
