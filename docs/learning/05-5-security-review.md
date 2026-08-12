# Lesson 5.5 — Security review (storage)

**Date:** 2026-08-12   **Module:** 5 (Storage)   **WAF pillar(s):** Security   **Status:** ✅ Done — 2 findings fixed, 4 triaged/accepted.
**Reviews:** Lessons 5.2–5.4. **Closes Module 5.**

## Scope
The whole Azure Blob surface: the read route (`/api/images/[...path]`), the write route
(`/api/storage/upload`), the gated seam (`lib/ingestion/storage.ts`, `lib/storage/blob.ts`), and the
`getCurrentUser` change. The one property that matters: **Blob has no path-based authorization, so
these routes are the only gate** — they must reproduce what the Supabase Storage RLS policy did.

## Core property — verified sound ✅
Authorization on both routes = **household-from-path**: the caller must be a member of the
`{householdId}` that is the first segment of the blob key. Because Azure blob names are *literal*
(no `..` resolution), a key only matches a real blob if its first segment is a real household — so
you can only reach blobs of a household you belong to. Confirmed on a prod build: unauthenticated →
**401**, wrong container → **400**, and (by construction) cross-household → **403**.

Also good by design: **keyless** (no account key or SAS anywhere — nothing to leak); reads are
capped/streamed; cover uploads are `sharp`-re-encoded (EXIF stripped).

## Findings

| # | Severity | Finding | Action |
|---|---|---|---|
| **F1** | Low (hardening) | No guard against empty / `.` / `..` path segments. | **Fixed** — guard on both routes. |
| **F2** | Low (hardening) | Served images had no `X-Content-Type-Options`, so a crafted upload could be MIME-sniffed. | **Fixed** — `nosniff` header. |
| **F3** | Info | Upload route returns **307 → /login** for unauthenticated (middleware) rather than 401; an expired session mid-upload could read the login page as a "success". | Accepted (access is blocked); logged in `tech-debt.md`. |
| **F4** | Info | Raw uploads store a client-supplied content-type. | Accepted — the read route derives content-type from the extension and only ever emits `image/*`; `nosniff` (F2) closes the sniff path. |
| **F5** | Info | `req.formData()` buffers the whole upload before the size check — a memory-DoS vector. | Accepted for scale (member-gated, 25 MB cap, `maxDuration 60`); logged. |
| **F6** | Info | `getCurrentUser` swallows Auth.js errors → `null`. | Accepted — it **fails closed** (denies access), the secure direction. |

### F1 — path-segment guard (the important half is the upload route)
The read route's `..` is already collapsed by the framework's URL normalization *before* it reaches
the handler, so URL traversal isn't actually reachable there. The real vector is the **upload
route**, whose `path` arrives as a **form field** (never URL-normalized) — a member could otherwise
send `myHousehold/../otherHousehold/…`. Blob names being literal means even that wouldn't overwrite
another household's blob, but rejecting the segments outright is the clean, obvious guard.

### F2 — nosniff
Cover photos are re-encoded to WebP by `sharp`, so they can't carry active content. Raw uploads
(ingestion page photos) are served back with a content-type derived from the file **extension**, and
`typeFor()` only ever returns `image/jpeg | image/png | image/webp` — never `text/html` or
`image/svg+xml`. `nosniff` makes that guarantee enforceable by the browser.

## What I did *not* find
No secret exposure (keyless), no cross-household read/write bypass, no unauthenticated data path, no
injection via the resize query params (parsed + clamped ≤ 4096).

## Deferred to Module 6
The multi-photo import + base64 vision-feed only execute inside the Inngest pipeline; their runtime
security (e.g. the service-role client scoping every query by `household_id`) is re-reviewed when the
pipeline runs on Azure.

## Evidence / links
- `app/api/images/[...path]/route.ts`, `app/api/storage/upload/route.ts`, `docs/tech-debt.md`.
- ADR-0006 (esp. Decisions 3 keyless + 4 household-in-the-route).
