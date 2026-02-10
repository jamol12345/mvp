Deployment Checklist

Frontend (Static HTML on Netlify)
1. Publish `public/` as the site output (no build step).
2. Ensure `/api/*` is proxied to the Vercel backend in `netlify.toml`.
3. Verify `/`, `/admin.html`, and `/done_calls.html` load correctly.

Backend (Express on Vercel)
1. Set `MONGODB_URI`, `JWT_SECRET`, `MANAGER_TOKEN`, `CALL_MANAGER_TOKEN`.
2. Set `CORS_ORIGIN` to the Netlify domain.
3. Deploy and verify `/api/leads` and `/api/admin/leads/poll`.

Post-Deploy Verification
1. Public form submits and shows the success modal.
2. Lead appears in MongoDB.
3. Admin polling shows the notification count.
4. Manual refresh loads new leads correctly.
5. Manager-only analytics and add-client are blocked for Call Manager.
