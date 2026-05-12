# Inventar — Deployment

Static files only. Single nginx container behind the existing Cloudflare Tunnel. No database, no API server.

---

## 1. VPS layout

The application sits at `/opt/inventar/` on the existing Hostinger VPS, alongside `/opt/stack/` shared infrastructure.

```
/opt/inventar/
├── docker-compose.yml          ← one service: web (nginx serving dist/)
├── docker/
│   ├── web.Dockerfile          ← multi-stage: Vite build → nginx:alpine
│   └── nginx.conf              ← SPA fallback + cache headers + sw scope + CSP
├── web/                        ← React/Vite/TS source
└── README.md
```

That's all. No Postgres container. No FastAPI service. No Redis. No backup scripts (the user's data is on their device, not the VPS).

---

## 2. docker-compose.yml

```yaml
services:
  inventar_web:
    build:
      context: .
      dockerfile: docker/web.Dockerfile
    networks:
      - stack_shared
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost/health"]
      interval: 30s
      timeout: 5s
      retries: 3

networks:
  stack_shared:
    external: true
    name: stack_default
```

`stack_shared` is the existing network the cloudflared container in `/opt/stack/` is attached to. `inventar_web` joins it so cloudflared can reach the container by name.

---

## 3. docker/web.Dockerfile

```dockerfile
# ─── build stage ────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build
# Output ends up in /app/dist

# ─── serve stage ────────────────────────────────────────────
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

---

## 4. docker/nginx.conf

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Don't cache index.html or service worker — they must update on deploy
    location = /index.html {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }
    location = /sw.js {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }
    location = /manifest.webmanifest {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    # Aggressively cache hashed assets — Vite emits /assets/[name].[hash].[ext]
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # CSP — strict, no inline scripts allowed
    add_header Content-Security-Policy "
        default-src 'self';
        img-src 'self' data: blob:;
        script-src 'self';
        style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
        font-src 'self' https://fonts.gstatic.com;
        connect-src 'self';
        manifest-src 'self';
        worker-src 'self';
    " always;

    # Health check
    location = /health {
        return 200 "ok";
        access_log off;
        add_header Content-Type text/plain;
    }
}
```

`unsafe-inline` on style-src is needed by Vite-generated CSS injection in dev/runtime; for production tightening it can be replaced with hashes if/when needed.

---

## 5. Cloudflare Tunnel ingress

Add `inventar.hoodhood.ai` to the existing `vps-tunnel`. Two valid paths.

### Path A — Zero Trust dashboard:

1. Cloudflare Zero Trust → Networks → Tunnels → `vps-tunnel` → Public Hostname → Add public hostname.
2. Subdomain: `inventar`. Domain: `hoodhood.ai`. Type: HTTP. URL: `inventar_web:80`.
3. Save.

### Path B — file-based config in cloudflared container:

Append to `/opt/stack/cloudflared/config.yml` before the catch-all:

```yaml
ingress:
  # … existing routes …
  - hostname: inventar.hoodhood.ai
    service: http://inventar_web:80
  - service: http_status:404
```

Then restart cloudflared:

```bash
cd /opt/stack && docker compose restart cloudflared
```

Verify which path is in use first:

```bash
docker logs stack_cloudflared 2>&1 | grep -i "config" | head -20
```

---

## 5b. Cloudflare cache rules — REQUIRED for the update modal

**Why this section exists.** Cloudflare's default Browser Cache TTL
on the Free plan rewrites `Cache-Control: no-cache` to
`Cache-Control: max-age=14400` on `.js` files — including `/sw.js`.
That freezes every merchant's browser cache on the previous service
worker for up to 4 hours after a deploy, so the v0.6 update-consent
modal never fires, the new bundle never loads, and any feature
shipped in the last 4 hours appears "broken" to merchants.

Origin nginx already sends the strongest "do not cache" header set
we can (see `docker/nginx.conf` v0.6.7+: `no-store, no-cache,
must-revalidate, max-age=0`). Cloudflare overrides it anyway —
this is a known dashboard-level config decision that cannot be
changed from the VPS. The fix is two cache rules in the Cloudflare
dashboard, set ONCE.

### Steps (Cloudflare dashboard, one-time setup)

1. **Cloudflare dashboard → Caching → Cache Rules → Create rule.**
2. **Rule 1 — Service worker (the critical one).**
   - Rule name: `Bypass cache for service worker`
   - When incoming requests match: `URI Path` `equals` `/sw.js`
   - Then: **Cache eligibility** → **Bypass cache**.
   - Save and deploy.
3. **Rule 2 — What's-new manifest.**
   - Rule name: `Bypass cache for update manifest`
   - When incoming requests match: `URI Path` `equals` `/whats-new.json`
   - Then: **Cache eligibility** → **Bypass cache**.
   - Save and deploy.
4. (Optional, defence-in-depth) **Rule 3 — index.html.**
   - Rule name: `Bypass cache for SPA shell`
   - When incoming requests match: `URI Path` `equals` `/index.html` **OR** `URI Path` `equals` `/`
   - Then: **Cache eligibility** → **Bypass cache**.

### Verify it stuck

```bash
# Both should report `cf-cache-status: DYNAMIC` (or BYPASS) and the
# origin's no-store Cache-Control header, NOT max-age=14400.
curl -sI https://inventar.hoodhood.ai/sw.js | grep -iE 'cache-control|cf-cache'
curl -sI https://inventar.hoodhood.ai/whats-new.json | grep -iE 'cache-control|cf-cache'
```

If you see `max-age=14400` or `cf-cache-status: HIT` on `/sw.js`,
the rule didn't apply — re-check the rule ordering in the CF
dashboard (Cache Rules apply top-down; an earlier "Cache Everything"
rule beats a later "Bypass").

### Purge once after creating the rules

The CF edge may still hold a cached copy of `/sw.js` from before
the rule existed. Purge it once:

  **Caching → Configuration → Purge Cache → Custom Purge → URL**
  - `https://inventar.hoodhood.ai/sw.js`
  - `https://inventar.hoodhood.ai/whats-new.json`

After this purge the next merchant visit downloads a fresh SW, the
v0.6 consent modal fires for the new version, and update-detection
works for every subsequent release without any further dashboard
action.

---

## 6. Initial bring-up

```bash
cd /opt/inventar
docker compose up -d --build

# Smoke test from inside the VPS
docker compose exec inventar_web wget -qO- http://localhost/health
# → ok

# Add tunnel route (Path A or B above)

# Smoke test from the public internet
curl -fsS https://inventar.hoodhood.ai/health
# → ok
```

---

## 7. Updates

```bash
cd /opt/inventar
git pull
docker compose up -d --build
```

That's it. Container restart takes 5 seconds. The PWA's service worker on every user's device fetches the new shell on next launch; users see a "Updated to v1.X" toast.

No database migrations. No data risk. No downtime sensitive to user state — there is no shared user state.

---

## 8. End-user install instructions

What the code owner sends to a new user:

> Open Chrome on your phone. Go to **https://inventar.hoodhood.ai**.
>
> When the app loads, tap the menu (⋮) at the top right of Chrome, then tap **Add to Home screen** (or **Install app** if shown).
>
> An icon will appear on your home screen. Tap it. Pick your language. Type your shop name.
>
> Done. The app works without internet from now on. Your data lives only on this phone — go to **Settings → Export Data** at least once a week to back it up.

For iPhone: Safari is required for "Add to Home Screen" (Chrome on iOS does not support full PWA installation). Same URL, same flow otherwise.

---

## 9. Backup of the VPS itself

The VPS holds **only the code**. Backup is just `git push origin main` after every meaningful change. There is no application data on the VPS to back up.

If the VPS is destroyed: clone the repo to a new VPS, run `docker compose up -d --build`, point Cloudflare Tunnel at the new container. End users are unaffected — their data is on their phones.

---

## 10. Domain and TLS

- DNS: `inventar.hoodhood.ai` is routed via the Cloudflare Tunnel to `inventar_web:80`.
- TLS: terminated by Cloudflare. Origin is HTTP-only inside the VPS network; this is fine because cloudflared is the only thing reaching it.
- HSTS: enabled via Cloudflare dashboard, 6-month max-age, after 24 hours of clean operation.
- HTTP/2 and HTTP/3: enabled by Cloudflare automatically.

---

## 11. Monitoring

Because there is no user data on the VPS, monitoring is limited to:

- Container health (`docker ps`, `docker compose ps`).
- nginx access logs (anonymous, IPs already redacted by Cloudflare).
- Uptime Kuma in `/opt/stack/` watching `https://inventar.hoodhood.ai/health`.

No application-level metrics. No analytics. No telemetry from users.
