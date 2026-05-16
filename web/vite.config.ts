import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // GenerateSW: workbox builds the SW from the manifest of built assets.
    // injectRegister: false — we register manually in src/pwa/register-sw.ts
    // so the update-toast UX stays under our control (SPEC §7).
    // manifest: false — we ship a static /public/manifest.webmanifest so it
    // gets nginx's no-cache headers (DEPLOY §4).
    VitePWA({
      strategies: 'generateSW',
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: false,
      includeAssets: [
        'manifest.webmanifest',
        'favicon.ico',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-maskable-192.png',
        'icons/icon-maskable-512.png',
        'icons/apple-touch-icon.png',
        'icons/favicon-16.png',
        'icons/favicon-32.png',
        'fonts/*.woff2',
        'robots.txt',
      ],
      workbox: {
        // Built JS/CSS/HTML/icons/fonts are precached as cache-first immutable.
        // Fonts are now self-hosted, so the gfonts runtimeCaching rules are gone.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff2,txt}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/health$/, /^\/robots\.txt$/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^\/assets\/ort-wasm-.*\.wasm$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ai-runtime-wasm',
              expiration: {
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
          {
            urlPattern: /^https:\/\/huggingface\.co\/.*\/resolve\/.*\.(onnx|bin|json|txt)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ai-vision-models',
              expiration: {
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
          {
            urlPattern: /^https:\/\/(cdn-lfs\.huggingface\.co|cas-bridge\.xethub\.hf\.co)\//i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ai-vision-model-blobs',
              expiration: {
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
        clientsClaim: true,
        skipWaiting: false,
      },
      devOptions: {
        // Disabled by default: dev server doesn't need a SW. Production
        // E2E uses `npm run preview` against the built `dist/`.
        enabled: false,
      },
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  // Prevent Vite from pre-bundling or analyzing @huggingface/transformers.
  // The library bundles large WASM files; letting Vite process them causes
  // the build to hang with no output. The lib is loaded lazily at runtime
  // via dynamic import() inside ai-vision.ts.
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },

  build: {
    target: 'es2022',
    // v0.5.2.1: production builds NEVER ship source maps. Without
    // this, the deployed dist/ contained .js.map files that let any
    // user reconstruct the original TypeScript via DevTools — i.e.
    // the source code was effectively public. Local dev is unaffected
    // (Vite's dev server provides sourcemaps via its own pipeline,
    // independent of build.sourcemap). To debug a deployed bundle,
    // build locally with VITE_DEBUG=1 (toggle below) and serve via
    // npm run preview.
    sourcemap: process.env.VITE_DEBUG === '1',
    cssCodeSplit: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // Split the 498 KB main chunk so unrelated screen code doesn't block
        // the initial paint. react/router/i18n/db each become their own
        // long-cacheable chunk; product code lives in the index entry.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          i18n: ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
          db: ['dexie'],
          ui: ['@radix-ui/react-dialog', '@radix-ui/react-radio-group'],
        },
      },
    },
  },
});
