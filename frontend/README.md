# Frontend — MVP Lead Management

This folder contains a **copy** of the frontend assets for the lead management MVP. It exists to separate frontend from backend in the same repository and to prepare for a possible future split into a dedicated frontend repo.

## What this part does

- **Static HTML/CSS/JS**: Public form (`index.html`), admin panel (`admin.html`), and archive view (`done_calls.html`), with shared `styles.css`.
- **Vanilla stack**: No build step; plain HTML, CSS, and JavaScript. The app expects to be served by the backend (or a reverse proxy in front of it) and calls APIs on the same origin.

## Deployment

- **Current setup**: The project runs as a single app. The **originals** of these files live at the repository root under `public/` and are served by the Express server. The running app uses the root `public/` and `server.js`, not this folder.
- **Future split**: If this folder is moved to its own repository, it can be deployed as a static site (e.g. Netlify, Vercel) with the API base URL configured for the separate backend. No import paths or API URLs have been changed here.

## Safety

- **No originals removed**: All original frontend files remain at the repo root in `public/`. This folder holds **copies only**.
- **No behavior change**: Nothing was refactored or rewired. This is structure-only organization.
