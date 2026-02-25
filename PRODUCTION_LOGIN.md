# Production login debug checklist

When login works locally but not on Netlify:

## 1. Frontend API URL

- The frontend uses **relative** URLs when running on localhost.
- On Netlify, all API calls must go to the **Vercel backend**.
- This repo uses `getApiBase()`: on non-localhost it returns `https://api.kukcha-eshiklari.uz`. No config change needed if your API is at that domain.

## 2. Vercel environment variables

In Vercel → Project → Settings → Environment Variables, ensure:

| Variable           | Required |
|--------------------|----------|
| `MONGODB_URI`      | Yes      |
| `JWT_SECRET`       | Yes      |
| `BOSS_TOKEN`       | Yes      |
| `CALL_ANVAR_TOKEN` | Yes      |
| `CALL_AKBAR_TOKEN` | Yes      |
| `CALL_DAVRON_TOKEN`| Yes      |

Redeploy the backend after changing env vars.

## 3. Backend debug logs

After deploying, check Vercel function logs for login attempts. You should see:

- `[LOGIN] Incoming token length: X`
- `[LOGIN] Env BOSS_TOKEN set: true/false` (and same for CALL_*)
- On success: `[LOGIN] Authenticated as: boss` or `call anvar` etc.
- On failure: `[LOGIN] No matching user for provided token` if the token does not match any env value.

If "Env … set: false", the variable is missing or not applied (redeploy after adding it).

## 4. CORS

The backend allows:

- `https://mvp-kokcha.netlify.app`
- `https://api.kukcha-eshiklari.uz`

To add another frontend origin, set in Vercel:

`CORS_ORIGIN=https://mvp-kokcha.netlify.app,https://your-other-site.com`

## 5. Browser DevTools

1. Open Netlify admin page → F12 → **Network**.
2. Enter token and submit login.
3. Find the request to `api.kukcha-eshiklari.uz` (or your API domain) → **login** or **admin/login**.
4. Check:
   - **Status**: 200 = OK, 401 = invalid token, 400 = missing token, (failed) = CORS or wrong URL.
   - **Response** body: `{ "success": true, "token": "...", "role": "boss" }` on success; `{ "error": "..." }` on failure.

If the request goes to `mvp-kokcha.netlify.app/api/...` instead of `api.kukcha-eshiklari.uz/api/...`, the frontend is still using relative URLs (old deploy or wrong branch).
