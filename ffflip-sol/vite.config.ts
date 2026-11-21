import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: { "process.env": {}, global: "globalThis" },
  server: { proxy: { "/api": "http://localhost:8787" } },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes("@solana") || id.includes("bn.js") || id.includes("borsh") ? "solana" : id.includes("react") ? "react" : undefined),
      },
    },
  },
});
