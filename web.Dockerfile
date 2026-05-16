FROM node:20-alpine AS build
WORKDIR /app

ENV npm_config_audit=false \
    npm_config_fund=false \
    npm_config_update_notifier=false \
    npm_config_progress=false \
    npm_config_fetch_retries=3 \
    npm_config_fetch_retry_mintimeout=10000 \
    npm_config_fetch_retry_maxtimeout=120000

COPY web/package.json web/package-lock.json ./

RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund

COPY web/ ./

RUN npm run build

FROM nginx:alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
