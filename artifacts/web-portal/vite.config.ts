import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const isReplit = !!process.env.REPL_ID;
const isBuild = process.env.npm_lifecycle_event === "build";

// PORT is only needed for the dev/preview server, not at build time
const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 3000;

// BASE_PATH defaults to "/" — required for Replit proxy routing, optional elsewhere
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig(async () => ({
  base: basePath,
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(process.env.SUPABASE_URL ?? ""),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(process.env.SUPABASE_ANON_KEY ?? ""),
    // On Railway the portal and API are separate services; set VITE_API_URL to the API service URL.
    // Leave empty to use relative /api paths (Replit / single-host setups).
    "import.meta.env.VITE_API_URL": JSON.stringify(process.env.VITE_API_URL ?? ""),
  },
  plugins: [
    react(),
    tailwindcss(),
    ...(!isBuild
      ? [
          (await import("@replit/vite-plugin-runtime-error-modal")).default(),
        ]
      : []),
    ...(isReplit && !isBuild
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({ root: path.resolve(import.meta.dirname, "..") }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["recharts"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: { strict: true },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
}));
