# Lesson 8.1 — Provision Azure Web PubSub (keyless, Free tier)

**Date:** 2026-08-18   **Module:** 8   **WAF pillar(s):** Cost · Security   **Status:** ✅ Done — resource live, keyless, role granted.

## What we did
Provisioned the realtime backbone via **Bicep** (`infra/webpubsub.bicep`) and deployed it into
`rg-recipe-planner`/`australiaeast`:
- **`wps-recipe-planner`** — Web PubSub, **Free_F1** (1 unit = 20 concurrent connections + 20,000
  messages/day; ample for a 2-user household).
- **Keyless by construction** — `disableLocalAuth: true`, so access keys are off entirely; the only
  way in is Microsoft Entra RBAC.
- **Role** — **Web PubSub Service Owner** granted to my `az login` user (dev). That role includes the
  auth API that mints client access tokens, which the negotiate route needs (8.2).

Endpoint: `https://wps-recipe-planner.webpubsub.azure.com` → recorded as `AZURE_WEBPUBSUB_ENDPOINT`
in gitignored `.env.local`.

## Why Bicep + keyless
Same discipline as storage (ADR-0006) and jobs (ADR-0007): infra is reproducible/tear-down-able, and
**no connection string or access key** exists to leak or rotate — the negotiate server authenticates
as a Managed Identity (prod) or `az login` (dev). The Bicep mirrors `storage.bicep`'s per-environment
principal pattern: pass the dev user's object id now; pass the app Managed Identity
(`id-recipe-planner`, principal `a1871a67-…`) at cutover.

## Prove it
```
az webpubsub show -n wps-recipe-planner -g rg-recipe-planner \
  --query "{sku:sku.name, localAuthDisabled:disableLocalAuth, state:provisioningState}"
# → Free_F1, true, Succeeded
az role assignment list --scope <wps resource id> --query "[].roleDefinitionName"
# → Web PubSub Service Owner
```

## Cutover note (Module 11)
Grant **Web PubSub Service Owner** to the Container App Managed Identity `id-recipe-planner` so the
deployed negotiate route mints tokens keyless in prod. (Deferred — prod still runs Supabase Realtime
until `REALTIME_PROVIDER=azure` flips.)

## Next (8.2)
The realtime seam: `lib/realtime/` server publisher (`WebPubSubServiceClient` + `DefaultAzureCredential`),
the `/api/realtime/negotiate` route (session-scoped group + token), and a browser hook that replaces
the three `.channel()` sites — all gated behind `REALTIME_PROVIDER`.
