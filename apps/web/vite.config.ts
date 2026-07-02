import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.API_URL ?? "http://localhost:3000",
        changeOrigin: false,
      },
      "/dev": {
        target: process.env.API_URL ?? "http://localhost:3000",
        changeOrigin: false,
      },
      "/webhooks": {
        target: process.env.API_URL ?? "http://localhost:3000",
        changeOrigin: false,
      },
    },
  },
});
