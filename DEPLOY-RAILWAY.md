# Deploy to Railway (realtime / WebSocket backend)

The app now uses **Socket.IO (WebSocket)** for live updates. WebSockets need a
**persistent** Node process, which Vercel serverless **cannot** provide — so the
backend (Express + Socket.IO) runs on **Railway**, and the same process also serves
the frontend (`public/`). One host, one origin, zero CORS.

- **Database:** unchanged — MongoDB Atlas.
- **Frontend:** served by this same server (`express.static('public')`).
- **Realtime:** `/socket.io/` on the same origin; the client auto-reconnects and
  re-syncs on every (re)connect, so no lead is ever lost.

---

## 1. Create the Railway service

1. Go to https://railway.app → **New Project** → **Deploy from GitHub repo** →
   pick `jamol12345/mvp` (branch `main`).
2. Railway auto-detects Node, runs `npm install`, then `npm start` (`node server.js`).
   No build step needed. (`engines.node >= 18` is pinned in package.json.)

## 2. Environment variables (Railway → service → Variables)

| Variable            | Required | Notes |
|---------------------|----------|-------|
| `MONGODB_URI`       | ✅       | Same Atlas connection string as today |
| `JWT_SECRET`        | ✅       | Same value as today (so existing sessions/tokens stay valid) |
| `BOSS_TOKEN`        | ✅       | Boss login token |
| `CALL_ANVAR_TOKEN`  | ✅       | Anvar login token |
| `CALL_AKBAR_TOKEN`  | ✅       | Akbar login token |
| `CALL_DAVRON_TOKEN` | ✅       | Davron login token |
| `CORS_ORIGIN`       | optional | Only if you serve the frontend from a *different* domain. Same-host = leave unset. |

Do **not** set `PORT` — Railway injects it automatically and the server reads `process.env.PORT`.
`NODE_ENV=production` is fine (Railway sets it by default).

## 3. MongoDB Atlas network access ⚠️

Atlas blocks unknown IPs. In **Atlas → Network Access**, allow Railway's egress:
- Easiest: add `0.0.0.0/0` (allow from anywhere — fine because access still
  requires the DB user/password in `MONGODB_URI`), **or**
- add Railway's static egress IP if you enable it on the service.

If the app logs `MongoDB connection error` on Railway, this is almost always the cause.

## 4. Deploy & verify

1. Railway builds and starts the service; open the generated URL
   (e.g. `https://<your-app>.up.railway.app`).
2. Check:
   - `GET /api/health` → `{"status":"ok"}`
   - `/socket.io/socket.io.js` → `200`
   - Open `/admin`, log in. In the browser console you should NOT see socket
     `connect_error`; the board updates instantly when another tab changes a lead.
3. Open the board in two browsers/managers — move a lead in one, it updates in the
   other within ~0.3s with **no manual refresh**.

## 5. Custom domain (optional)

Point your domain (e.g. `crm.kukcha-eshiklari.uz`) at the Railway service
(Railway → Settings → Domains). Managers then use that single URL for everything.

## 6. Cut over from Vercel/Netlify

Until cutover, the old Vercel deployment keeps working in **polling fallback** mode
(it can't serve WebSockets, so the client silently falls back to the 20s safety poll —
no errors). Once Railway is verified live and the domain points to it:

- Retire the Vercel backend by deleting `vercel.json` and `api/` (Vercel-only;
  incompatible with WebSockets). Git history preserves them.
- The Netlify static front (`public/`) is no longer needed — Railway serves it.

## How realtime works (for reference)

- Every lead/approval/task DB write goes through Mongoose **post-hooks** in
  `server.js`, which emit `lead:changed` / `approval:changed` to connected clients.
  Because it's hooked at the persistence layer, no route can forget to notify.
- Sockets authenticate with the **same JWT** as REST (sent in the handshake).
  Rooms: `all` (everyone), `boss`, `mgr:<key>` (per call-manager).
- The client treats events as a *signal* and re-fetches the authoritative state
  (`liveRefresh()`), so the DB is always the source of truth.
- A slow safety poll (admin 20s, archive 30s) remains as a backstop if a socket
  silently drops.
