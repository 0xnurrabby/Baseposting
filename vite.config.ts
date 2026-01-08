import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vercel serves the app at https://baseposting.online/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      // Required by prompt: import { Attribution } from "https://esm.sh/ox/erc8021";
      // We keep it as a runtime ESM import (not bundled).
      external: ["https://esm.sh/ox/erc8021"],
    },
  },
});
