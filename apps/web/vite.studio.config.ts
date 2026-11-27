import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// KVARD Studio: separate entry point and build artifact (dist-studio), same
// dependencies and design system as the Platform. Served same-origin at /studio/
// so the Platform session cookie, CSRF posture and CORS stay unchanged.
export default defineConfig({
  root: "studio",
  base: "/studio/",
  plugins: [react()],
  build: { outDir: "../dist-studio", emptyOutDir: true },
  server: {
    host: "0.0.0.0",
    port: 5174,
    proxy: { "/api": { target: "http://127.0.0.1:3001", changeOrigin: true } },
  },
});
