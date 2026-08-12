# ADR-0006 — Storage (Supabase Storage → Azure Blob)

**Status:** ✅ Accepted — 2026-08-12
**Module:** 5 (Storage)
**WAF pillar(s):** Security (primary), Cost Optimization, Performance Efficiency
**Deciders:** Carlo (owner), with Claude as advisor
**Related:** [ADR-0003](0003-service-signatures.md) (stable service API), [ADR-0005](0005-authentication.md) (Managed Identity / getCurrentUser)

---

## Context

Two Supabase Storage buckets today: `recipe-uploads` (ingestion page rasters, service-role server
writes, path `{householdId}/{jobId}/page-NNN.jpg`, capped 1200px) and `recipe-images` (user recipe
photos, uploaded via a **browser** signed-upload URL). Serving uses a **client** hook
(`use-signed-image`) that signs URLs *from the browser* (Supabase anon) **and** requests **on-the-fly
resize** (thumbnails). Supabase Storage policies enforce the `{householdId}/…` path-prefix isolation.

Azure Blob differs in three load-bearing ways: it **can't be safely signed from the browser**, it has
**no on-the-fly image transform**, and it has **no per-path authorization** (no Storage-policy
equivalent). So this is more than a rename.

## Decisions

### 1. Read path — **server image route + `next/image`; images capped at ~2560px**
Serve images through a stable, authorized route (e.g. `/api/images/{householdId}/…`) fronted by
Next.js `<Image>`, which resizes/recompresses on demand and caches per size. The route is the browser's
only entry point; the blob stays fully private. Stored images are capped at **~2560px longest edge +
WebP** (the app's largest display need is the 2400px fullscreen; smaller views downscale via
`next/image`). Rejected: pre-generating fixed sizes (B — more storage, frozen sizes), serving
originals (C — heavy payloads), Front Door transforms (D — infra/cost overkill at 2 users).

### 2. Upload path (new user photos) — **server-proxied + `sharp`**
The browser POSTs the photo to a Next route; the **server** caps it (2560px, WebP, fix EXIF) with
`sharp` and writes to Blob via Managed Identity. No browser-facing write signature. Trusted,
consistent (guarantees the cap regardless of client), reuses `sharp`. Ingestion rasters keep their
existing server-side writes. Rejected: client-side shrink + direct-to-Blob write-SAS (untrusted, less
reliable) — a scale-time option only.

### 3. Auth — **keyless (Managed Identity prod / `az login` dev), server-streamed reads, no SAS**
`DefaultAzureCredential`: Managed Identity in prod (role **Storage Blob Data Contributor**), the
`az login` identity in dev. Because both reads and writes are server-mediated, **no SAS is needed** —
the read route streams the blob (server download via identity → `next/image`), writes go straight
through. No account keys, no signatures to scope/expire/leak. Matches ADR-0005/Module 2's no-secrets
stance. Cost: the read route proxies bytes — negligible (`next/image` caches per size).

### 4. Containers — **two private containers; household isolation enforced in the route**
Mirror today: `recipe-uploads` + `recipe-images`, both **private**, path `{householdId}/…` preserved.
Least code change (`bucket` → `container` is ~1:1), separable lifecycles (rasters are disposable),
DB paths untouched. **Critical:** Blob has no path-based authorization, so the route **must verify
`getCurrentUser()`'s household matches the path's `{householdId}`** before streaming/writing — this
replaces the Supabase Storage policy and is the focus of the Lesson-5 security review.

### 5. Local dev — **a separate (cheap) dev storage account, keyless**
Dev talks to its own real Azure storage account via `az login` — true dev/prod parity (exercises the
Managed Identity + RBAC path for real). Chosen over Azurite because (a) Azurite is key-based, which
would diverge dev auth from prod, and (b) local dev **already** requires Azure (Entra sign-in since
Module 4), so Azurite's offline win doesn't apply. Dev and prod storage are **intentionally isolated**
(dev has throwaway test data) — same model as local vs prod Supabase today.

## Consequences

- **Gated** like the data (`DATABASE_URL`) and auth (`AUTH_PROVIDER`) layers via a `STORAGE_PROVIDER`
  flag (`azure` | `supabase`): prod + tests stay on Supabase Storage until cutover; dev flips to Blob.
- **Existing images** are optimized (cap + WebP) as part of the **Module 9 migration** — not here.
- `lib/storage/blob.ts` keeps the shape of `lib/ingestion/storage.ts` (stable seam, ADR-0003).
- **Pros:** private blobs, no secrets/SAS, on-demand resize, minimal storage, least code churn, parity.
- **Cons:** the read route proxies image bytes (fine at scale ≪; add a CDN later — the ADR-0006/D path).

## Copying prod images into dev (deliberate, one-way)

When you need realistic data in dev, copy **prod → dev only** with AzCopy (server-to-server; verified
via MS Learn). Prereqs: your `az login` identity has **Storage Blob Data Reader** on prod and
**Storage Blob Data Contributor** on dev; both accounts in the same Entra tenant.
```bash
azcopy login          # Entra (keyless) — no keys/SAS
azcopy copy 'https://<PROD-acct>.blob.core.windows.net/recipe-images' \
            'https://<DEV-acct>.blob.core.windows.net/recipe-images' --recursive
# repeat for recipe-uploads if needed
```
**Never** copy dev → prod. Treat copied blobs as real user data (privacy) — don't leave them lying
around. Full how-to in `docs/learning/05-0-module-5-plan.md`.
