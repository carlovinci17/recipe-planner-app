# Lesson 5.4 — Write path: server-proxied uploads + base64 vision-feed

**Date:** 2026-08-12   **Module:** 5 (Storage)   **WAF pillar(s):** Security · Cost   **Status:** ✅ Done — typecheck + build + 36 tests green; auth gates verified on a prod build.
**Decided in:** [ADR-0006](../adr/0006-storage.md) (Decision 2).

## The one-line idea
Keyless Azure Blob **can't be written from the browser** (no Shared Access Signature to hand out).
So every upload now goes **through our server**, which holds the Managed Identity and does the write.

## What we did
1. **`app/api/storage/upload/route.ts`** — one authorized upload route. `multipart/form-data`
   (`file`, `container`, `path`, optional `cap`). It:
   - authorizes exactly like the read route — **must be a member of the `{householdId}` in the
     path** (401/403);
   - rejects the wrong container or an oversized file (400/413);
   - `cap="cover"` → `sharp` rotates (EXIF), caps the longest edge to **2560px**, re-encodes to
     **WebP**, and returns the changed `.webp` path; otherwise stores bytes as-is;
   - writes via the new gated seam **`ingestionStorage.uploadTo`** (Azure Blob or Supabase).
2. **Gated the 3 browser-direct signed-PUT flows** — under Azure they POST the file to the route
   (`uploadViaServer`, keyed off `NEXT_PUBLIC_STORAGE_PROVIDER`); under Supabase they keep the
   existing signed PUT:
   - recipe **cover photo** (`recipe-image-uploader.tsx`) → `recipe-images`, `cap=cover`;
   - **multi-photo import** (`import-photo.tsx`) → `recipe-uploads`, raw (the pipeline rasterizes);
   - the two services (`createImageUploadUrl`, `createMultiPhotoJob`) return **path-only** under
     Azure (no signature).
3. **Vision-feed** — `ingestionStorage.signedUrl(s)` return **`data:` URLs (base64)** under Azure.
   The Anthropic provider already converts `data:` image parts into base64 image blocks, so the
   skim/extract calls feed the model with **zero AI-code changes**. (Keyless has no public URL to
   give a model.)
4. **Hardened `getCurrentUser`** — a failed/absent Auth.js session read now **fails closed**
   (returns `null` → 401) instead of throwing a 500. This is what turned the unauthenticated image
   route from a 500 into a clean 401.

## Why a plain upload route (not a signed browser upload, not `next/image` upload)
Keyless is the whole point of ADR-0006 Decision 3 — no keys, no SAS anywhere. The only actor that
can write to Blob is the server identity, so the bytes must pass through the server once. `sharp`
capping there is a bonus: user photos shrink to a sane size (Cost) and EXIF is stripped (privacy).

## Proven
- Typecheck clean; **production build compiles**; both routes registered (`/api/storage/upload`,
  `/api/images/[...path]`).
- **Auth gates checked on a prod build** (deterministic, not the dev server): unauth image route →
  **401**, bad container → **400**, upload route unauth → blocked.
- **36 integration tests green** (`STORAGE_PROVIDER` unset → Supabase paths untouched).
- Live browser test (you): after restarting dev, add a cover photo to a recipe → it uploads to the
  Azure dev `recipe-images` container and renders back through `/api/images/…`.

## Gotcha logged
Next dev (Turbopack) was **serving stale route code** during testing — edits to the API route
weren't reflected until a dev-server restart. When an API route behaves against the code you're
looking at, **restart `npm run dev`** (or verify against `npm run build && npm run start`, which is
deterministic).

## Not verifiable until Module 6
The multi-photo import + vision-feed only fire inside the Inngest ingestion pipeline. The code is
gated and typechecked, but a full "import a cookbook photo under Azure and watch it extract" run
belongs to **Module 6**, when the pipeline itself runs on the new stack.

## Evidence / links
- `app/api/storage/upload/route.ts`, `components/recipes/upload-via-server.ts`,
  `lib/ingestion/storage.ts` (`uploadTo`, `signedUrl(s)`), `lib/auth/current-user.ts`.
- Clients: `components/recipes/recipe-image-uploader.tsx`, `app/(app)/recipes/import/import-photo.tsx`.
