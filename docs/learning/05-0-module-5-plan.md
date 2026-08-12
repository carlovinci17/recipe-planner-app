# Module 5 — Storage: mini-plan

**Decided in:** [ADR-0006](../adr/0006-storage.md) (+ [0003](../adr/0003-service-signatures.md), [0005](../adr/0005-authentication.md)).
**Goal:** replace Supabase Storage with **Azure Blob Storage** — private, keyless (Managed Identity),
images served through a server route + `next/image`, capped at ~2560px. Touch `app/` only via the seam.

## Design baseline (from ADR-0006)
1. **Read:** server image route + `next/image`; blobs stay private; cap ~2560px + WebP.
2. **Upload (new photos):** server-proxied + `sharp` (cap/WebP/EXIF); no browser signature.
3. **Auth:** keyless — Managed Identity (prod) / `az login` (dev); **no SAS**; server-streamed reads.
4. **Containers:** two private (`recipe-uploads`, `recipe-images`); household isolation **in the route**.
5. **Local dev:** a separate cheap dev storage account, keyless (parity, not Azurite).
- **Gated** by `STORAGE_PROVIDER` (`azure` | `supabase`) — prod + tests stay on Supabase until cutover.

## Lessons
| Lesson | Do | Prove it |
|---|---|---|
| **5.1** Blob account + containers | Bicep: a **dev** Storage account + two private containers; grant your `az login` identity **Storage Blob Data Contributor**; (prod account + Managed Identity role come with the Container App). *MS Learn: "create storage account Bicep", "assign Blob data roles".* | `az storage blob list` works keyless. |
| **5.2** The seam (`lib/storage/blob.ts`) | Mirror `lib/ingestion/storage.ts` (download/upload/stream) on `@azure/storage-blob` + `DefaultAzureCredential`; keep the `{householdId}/…` paths; gate on `STORAGE_PROVIDER`. Server-side `sharp` cap on upload. | Typecheck; a unit test uploads+reads a blob against the dev account. |
| **5.3** Read path: image route + client rewire ✅ | Add the authorized `/api/images/[...]` route (**household check** → provider-gated fetch → optional `sharp` resize); rewrite `use-signed-image` to return that deterministic route URL under Azure (no browser signing). | Images render; build compiles; 36 tests green. |
| **5.4** Write path: server-proxied uploads + vision-feed | Replace the 3 browser-direct signed-PUT flows (recipe photos, ingestion source, multi-photo) with a server-proxied upload route (`sharp` cap for photos); switch the ingestion vision-feed from signed URLs → base64 (keyless has no public URL). | A new upload lands in Blob; import extracts under Azure. |
| **5.5** Security review | `/security-review` the route's **household-from-path** check (the replacement for the Supabase Storage policy) + upload validation. | Findings triaged. |

> **Note (split at execution):** 5.3 as originally planned bundled route + upload. In practice the
> **read path** (route + auth + resize + hook) is a complete, independently-verifiable slice, and the
> **write path** (3 upload flows → server-proxied `sharp`, plus the vision model switching from
> signed-URL to base64 image source) is a second slice of equal size, coupled to the ingestion
> pipeline. Split so each lesson is coherent and each tick is honest. Old 5.4 (security) → 5.5.

## Exit criteria
- With `STORAGE_PROVIDER=azure`: recipe images render (cards/detail/gallery), a new upload works, paths keep the `{householdId}/…` prefix.
- Typecheck + integration suite green (Supabase path unchanged). Cross-household image access is 403.

## How to copy prod images into dev (deliberate, one-way)
Dev and prod storage are **separate** (dev = throwaway test data). When you want realistic data in dev,
copy **prod → dev only** — never the reverse. Uses **AzCopy** (server-to-server; verified via MS Learn).

**Prereqs:** your `az login` identity has **Storage Blob Data Reader** on the *prod* account and
**Storage Blob Data Contributor** on the *dev* account; both accounts are in the same Entra tenant; you
have network access to both.

```bash
# 1. Install AzCopy (once): https://aka.ms/downloadazcopy  (or `brew install azcopy`)
# 2. Sign in with your Entra identity — no keys, no SAS:
azcopy login
# 3. Copy each container prod → dev (server-to-server; data never touches your machine):
azcopy copy 'https://<PROD-account>.blob.core.windows.net/recipe-images' \
            'https://<DEV-account>.blob.core.windows.net/recipe-images' --recursive
azcopy copy 'https://<PROD-account>.blob.core.windows.net/recipe-uploads' \
            'https://<DEV-account>.blob.core.windows.net/recipe-uploads' --recursive
```
Notes: same-region copies incur **no bandwidth charge**; `--recursive` copies the whole container
(household path prefixes preserved). ⚠️ This is **real user data** — treat it with care, don't copy
dev → prod, and clean it out of dev when you're done reproducing an issue.

## Decisions still to make at execution time
- **Which subscription/region** for the dev + prod storage accounts (match the app's region → free copies).
- Blob **access tier** (Hot for images) + optional lifecycle rule to expire `recipe-uploads` rasters.
- `next/image` `remotePatterns` / the route's cache headers.
