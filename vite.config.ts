import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: "./",
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    optimizeDeps: {
      include: ["@mediapipe/face_mesh", "@mediapipe/camera_utils"],
    },
    proxy: {
      "/api/fast2sms": {
        target: "https://www.fast2sms.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/fast2sms/, "/dev/bulkV2"),
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
