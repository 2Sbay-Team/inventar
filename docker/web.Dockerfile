# ─── build stage ────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# Copy manifests first so Docker layer-caches node_modules.
# The expensive npm ci only re-runs when package.json or package-lock.json
# changes — not on every source code edit.
COPY web/package.json web/package-lock.json ./

# --ignore-scripts skips lifecycle hooks (husky, etc.) that only matter
# on a dev machine. NODE_ENV=production cuts install time further.
RUN npm ci --ignore-scripts

# Copy source after installing deps (preserves the cache layer above).
COPY web/ ./

# Build the PWA — Vite emits to /app/dist
RUN npm run build

# ─── serve stage ────────────────────────────────────────────
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
