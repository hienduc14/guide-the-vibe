import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies the Operator API (run the server on :7390).
const target = process.env.GTV_SERVER ?? "http://127.0.0.1:7390";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": target,
      "/v1": target,
      "/health": target,
      "/p": target,
    },
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});
