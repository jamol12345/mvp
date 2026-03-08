# Client lead form (Vue 3 + Vite)

Public lead submission form as a Vue 3 app. Submits to `POST /api/leads`.

## Setup

```bash
cd client-form
cp .env.example .env
# Edit .env: set VITE_API_URL to your backend (e.g. http://localhost:3000 for local dev)
npm install
npm run dev
```

Runs at **http://localhost:5173**. Backend must allow CORS from `http://localhost:5173` (already configured in server.js when using this repo's backend).

## Build

```bash
npm run build
```

Output in `dist/`. Deploy `dist/` to any static host; set `VITE_API_URL` at build time to your production API (e.g. `https://crm-kukcha.vercel.app`).

## Env

- **VITE_API_URL** — API base URL (no trailing slash). Empty = same-origin. Example: `https://crm-kukcha.vercel.app`

## Component

`src/components/LeadForm.vue` is self-contained and can be copied into another Vue project. See comments in the file for API shape and how to change the API URL.
