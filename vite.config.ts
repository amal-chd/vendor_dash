import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'KadaDine POS',
        short_name: 'Kada POS',
        description: 'Advanced Offline POS for KadaDine',
        theme_color: '#ffffff',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // The world country/state/city dataset (~8.4 MB) is lazy-loaded only by
        // address forms (useGeoData). Precaching it made every visitor's service
        // worker download it on first load; fetch it on demand and cache then.
        globIgnores: ['**/vendor-geo-*.js'],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/vendor-geo-.*\.js$/,
            handler: 'CacheFirst',
            options: { cacheName: 'geo-dataset', expiration: { maxEntries: 2 } },
          },
        ],
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024, // 15MB limit
        // Take over on the very next load instead of waiting for every tab to
        // close, and drop the previous precache. Without this a returning user
        // keeps being served the last release's index.html, whose hashed chunk
        // names no longer exist. Firebase's SPA rewrite then answers those
        // dead .js URLs with index.html (HTML, HTTP 200), the browser tries to
        // execute markup as a module, and the app renders a blank page.
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
        // Never let the navigation fallback answer an asset request with the
        // app shell — a missing asset must fail as a missing asset.
        navigateFallbackDenylist: [/^\/assets\//],
      }
    })
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    target: "es2020",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;

          // Match on the PACKAGE NAME, not a substring of the whole path: a
          // greedy `id.includes("react")` also swept in @radix-ui/react-*,
          // lucide-react and embla-carousel-react.
          const rest = id.split("node_modules/").pop() ?? "";
          const pkg = rest.startsWith("@")
            ? rest.split("/").slice(0, 2).join("/")
            : rest.split("/")[0];

          // Only split out chunks that DEPEND on the core and are never
          // depended on BY it, so every chunk edge points one way.
          //
          // React is deliberately NOT isolated. It is CommonJS, so Vite
          // generates interop helpers for it that live outside node_modules;
          // isolating React left those helpers in the misc chunk, which also
          // holds React consumers, so the two chunks imported each other. On a
          // circular chunk import one side evaluates before the other's
          // exports exist — which is how the app booted with an undefined
          // React and rendered a blank page in production. Verify a cold load
          // in a real browser before changing this; the cycle is invisible to
          // both `tsc` and the build.
          if (pkg === "firebase" || pkg.startsWith("@firebase")) return "vendor-firebase";
          if (pkg === "lucide-react") return "vendor-icons";
          if (pkg === "framer-motion" || pkg === "motion-dom" || pkg === "motion-utils") {
            return "vendor-motion";
          }
          if (pkg === "recharts" || pkg.startsWith("d3-") || pkg === "victory-vendor") {
            return "vendor-charts";
          }
          if (pkg === "country-state-city") return "vendor-geo";
          if (pkg.startsWith("@tanstack")) return "vendor-tanstack";

          // React, react-dom, react-router, Radix and every other small
          // dependency share one chunk with the CJS helpers they need. Radix
          // is in here rather than split out because several misc packages
          // (cmdk, vaul, …) import it, which would point an edge back into
          // core and recreate the cycle.
          return "vendor-core";
        },
      },
    },
  },
}));