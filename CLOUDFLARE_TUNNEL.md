# Cloudflare Tunnel + Vercel Deployment Guide

This guide exposes your local FastAPI backend (port 8000) to the internet via a
Cloudflare Tunnel, then deploys the Next.js frontend to Vercel pointing at that tunnel.

---

## 1. Install `cloudflared`

```bash
# Debian / Ubuntu
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb

# Or via npm (cross-platform)
npm install -g cloudflared
```

---

## 2. Authenticate with Cloudflare

```bash
cloudflared tunnel login
```

This opens a browser window — select the zone (domain) you want to use.

---

## 3. Create a named tunnel

```bash
cloudflared tunnel create deez-dragons-api
```

Note the **Tunnel ID** printed in the output (a UUID).

---

## 4. Create the tunnel config

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <YOUR_TUNNEL_ID>
credentials-file: /home/<YOUR_USER>/.cloudflared/<YOUR_TUNNEL_ID>.json

ingress:
  - hostname: deez-dragons-api.yourdomain.com
    service: http://localhost:8000
  - service: http_status:404
```

Replace `deez-dragons-api.yourdomain.com` with your actual subdomain.

---

## 5. Add a DNS record

```bash
cloudflared tunnel route dns deez-dragons-api deez-dragons-api.yourdomain.com
```

---

## 6. Run the tunnel

```bash
# Foreground (dev)
cloudflared tunnel run deez-dragons-api

# Background systemd service (production)
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

---

## 7. Update backend `.env`

```env
API_HOST_PREFIX=https://deez-dragons-api.yourdomain.com
```

Restart the FastAPI server so media URLs embed the tunnel hostname.

---

## 8. Deploy frontend to Vercel

```bash
cd frontend
npx vercel --prod
```

Set these **Environment Variables** in the Vercel dashboard
(Project → Settings → Environment Variables):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `https://deez-dragons-api.yourdomain.com` |
| `CF_TUNNEL_HOSTNAME` | `deez-dragons-api.yourdomain.com` |

---

## 9. PWA install

Once deployed, visit the Vercel URL on mobile Chrome/Safari.
The browser will prompt **"Add to Home Screen"** — tap it to install as a PWA.

The service worker (`/sw.js`) caches the app shell for offline launch;
all API and media requests always go network-first.

---

## Local dev quick-start (no tunnel needed)

```bash
# Terminal 1 — backend
cd backend && uvicorn server:app --reload --port 8000

# Terminal 2 — frontend
cd frontend && npm run dev
```

`frontend/.env.local` already points `NEXT_PUBLIC_API_BASE_URL` at `http://localhost:8000`.
