import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 5173,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/api/ws": {
        target: "http://localhost:8000",
        ws: true,
        changeOrigin: true,
      },
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/auth/v1": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => `/api${path}`,
      },
      "/rest/v1": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => `/api${path}`,
      },
      "/functions/v1": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => `/api${path}`,
      },
      "/admin/v1": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => `/api${path}`,
      },
      "/admin/dashboard": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => `/api${path}`,
      },
      "/recruiter": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => `/api${path}`,
      },
      "/upload-video": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => `/api${path}`,
      },
      "/ws": {
        target: "http://localhost:8000",
        ws: true,
        changeOrigin: true,
        rewrite: (path) => `/api${path}`,
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    target: "esnext",
    minify: "esbuild",
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-utils": ["framer-motion", "lucide-react", "date-fns", "clsx", "tailwind-merge"],
          "vendor-ai": ["@tensorflow/tfjs", "@tensorflow-models/mobilenet", "@mediapipe/tasks-vision", "@mediapipe/tasks-audio"],
          "vendor-3d": ["three", "@react-three/fiber", "@react-three/drei", "@splinetool/runtime", "@splinetool/react-spline"],
          "vendor-editor": ["@monaco-editor/react"],
          "vendor-pdf": ["jspdf", "jspdf-autotable"],
          "vendor-ui": [
            "@radix-ui/react-accordion", "@radix-ui/react-alert-dialog", "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-dialog", "@radix-ui/react-popover", "@radix-ui/react-tooltip"
          ],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
}));
