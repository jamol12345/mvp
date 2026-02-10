# Backend — MVP Lead Management

This folder contains a **copy** of the backend code for the lead management MVP. It exists to separate backend from frontend in the same repository and to prepare for a possible future split into a dedicated backend repo.

## What this part does

- **Express server** (`server.js`): Serves static files from `public/`, exposes REST API for leads and admin (JWT auth), connects to MongoDB via Mongoose, and provides Excel export for the archive.
- **Serverless entry** (`api/index.js`): Re-exports the Express app for serverless deployments (e.g. Netlify Functions).
- **Environment**: `.env.example` lists required variables (MongoDB, JWT secret, tokens, port). No secrets are stored in the repo.

## Deployment

- **Current setup**: The project runs as a single app. The **originals** of these files live at the repository root. The running app is started from the root (e.g. `node server.js`) and uses root `package.json` and `node_modules`. This folder is **not** executed in the current setup.
- **Future split**: If this folder is moved to its own repository, run `npm install` here, set environment variables (see `.env.example`), and start with `npm start`. Serve the frontend from the other repo or point the frontend’s API base URL to this backend. No import paths or API behavior have been changed in these copies.

## Safety

- **No originals removed**: All original backend files remain at the repo root (`server.js`, `api/index.js`, `package.json`, `package-lock.json`, `.env.example`). This folder holds **copies only**.
- **No behavior change**: Nothing was refactored or rewired. This is structure-only organization.
