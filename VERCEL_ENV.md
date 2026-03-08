# Vercel environment variables (required for login)

After deploy, in **Vercel Dashboard → Project → Settings → Environment Variables**, ensure these are set:

- `BOSS_TOKEN`
- `CALL_ANVAR_TOKEN`
- `CALL_AKBAR_TOKEN`
- `CALL_DAVRON_TOKEN`
- `JWT_SECRET`
- `MONGODB_URI`

Then **redeploy** (Deployments → ⋮ → Redeploy) so the serverless function picks up the variables.

If login returns 401, check Vercel function logs: you should see `BOSS_TOKEN exists: true`, etc. If any show `false`, add or fix that variable and redeploy.
