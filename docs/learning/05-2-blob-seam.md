# Lesson 5.2 — The Blob seam (`lib/storage/blob.ts`)

**Date:** 2026-08-12   **Module:** 5 (Storage)   **WAF pillar(s):** Security   **Status:** ✅ Done — keyless round-trip verified; 36 tests green.
**Decided in:** [ADR-0006](../adr/0006-storage.md).

## What we did
Built the code seam that talks to the Blob account — keyless, mirroring the shape of
`lib/ingestion/storage.ts` (ADR-0003 stable seam). Gated on `STORAGE_PROVIDER` so prod + tests stay
on Supabase Storage until cutover.

## The seam
`lib/storage/blob.ts` — a `BlobServiceClient` built with **`DefaultAzureCredential`** (Managed Identity
in prod, `az login` in dev — never a key), exposing `download` / `upload` / `stream` / `exists` /
`remove` against the two containers. `stream` is what Lesson 5.3's image route pipes to the response
(no SAS, no buffering).

## Wiring
- `lib/env.ts`: `STORAGE_PROVIDER` (`azure` | `supabase`) + `AZURE_STORAGE_ACCOUNT`.
- `lib/ingestion/storage.ts`: `downloadFile` + `uploadDerivedImage` now dispatch — `azure` →
  `blobStorage`, else Supabase. The `blobStorage` import is **dynamic**, so the Supabase path never
  loads the Azure SDK (same pattern as the Drizzle `lib/db` gate).

## Proven
- Typecheck clean.
- A **keyless round-trip** (upload → download → delete) against the real dev account
  `strpdevdtyzeg7l6ihh4` succeeded using `DefaultAzureCredential` (the `az login` leg of the chain —
  the same code path Managed Identity uses in prod).
- **36 integration tests green** (`STORAGE_PROVIDER` unset → Supabase path unchanged).

## Next (Lesson 5.3)
The browser-facing pieces: the authorized `/api/images/…` route (household check → `stream`) fronted
by `next/image`, rewiring `use-signed-image`, and the server-proxied `sharp` upload — the parts that
replace the Supabase signed URLs.

## Evidence / links
- `lib/storage/blob.ts`, `lib/ingestion/storage.ts`, `lib/env.ts`. SDK: `@azure/storage-blob` 12.33,
  `@azure/identity` 4.13.
