# Lesson 5.3 — Read path: authorized image route + client rewire

**Date:** 2026-08-12   **Module:** 5 (Storage)   **WAF pillar(s):** Security · Performance   **Status:** ✅ Done — build compiles, 36 tests green.
**Decided in:** [ADR-0006](../adr/0006-storage.md) (Decisions 1 + 4).

## The one-line idea
Azure Blob has **no path-based authorization** — a blob is either reachable by the app identity or
not; it can't say "only this household." So the *route* becomes the gate. Every image now loads
through one server route that checks who you are before it hands back a single byte.

## What we did (read/display path only)
1. **`app/api/images/[...path]/route.ts`** — the authorized image route. URL shape
   `/api/images/{container}/{householdId}/{...blob}?w=&h=&q=`. It:
   - `getCurrentUser()` → 401 if signed out;
   - `householdService.listForCurrentUser()` → **403 unless the caller is a member of the
     `{householdId}` in the path** (this is the replacement for the old Supabase Storage policy);
   - fetches the blob through the **provider-gated** `ingestionStorage.downloadFile` (Azure Blob or
     Supabase — one route serves both stacks);
   - optional **`sharp` resize** (`?w/h/q`, WebP) for thumbnails — the replacement for Supabase's
     on-the-fly transform;
   - responds with `Cache-Control: private, max-age=3600`.
2. **`components/recipes/use-signed-image.ts`** — added an Azure branch. When
   `NEXT_PUBLIC_STORAGE_PROVIDER === "azure"` the hook returns the route URL **synchronously**
   (deterministic — no browser-side signing round-trip); otherwise it keeps the existing Supabase
   client-signing. All **11 display consumers** (cards, gallery, planner, review pickers, uploader
   thumbnails) ride the hook, so none of them changed.

## Why a plain route, not `next/image`
The ADR said "route + `next/image`." At implementation that collides with auth: **`next/image`'s
optimizer fetches the source server-side and does not forward the user's session cookie**, so an
authed route would see no user. The route doing its own `sharp` resize — fetched **directly by the
browser `<img>` (cookies sent)** — keeps the ADR's intent (private, server-mediated, resized) while
actually being authorizable. Documented as a deliberate refinement.

## Proven
- Typecheck clean; **production build compiles**; `/api/images/[...path]` registered as a dynamic route.
- **36 integration tests green** (`STORAGE_PROVIDER` unset → Supabase path untouched).
- Manual check (you): with `STORAGE_PROVIDER=azure` + `NEXT_PUBLIC_STORAGE_PROVIDER=azure`, recipe
  images load via `/api/images/…`; another household's image returns 403.

## Client env needed
`.env.local` needs **`NEXT_PUBLIC_STORAGE_PROVIDER=azure`** (the client can't read the server-only
`STORAGE_PROVIDER`; `NEXT_PUBLIC_` is inlined into the browser bundle at build).

## Scope split (why this lesson is read-only)
Originally 5.3 also included the upload rewire. The write path — 3 browser-direct signed-PUT flows
(recipe photos, ingestion source, multi-photo) → server-proxied `sharp`, **plus** the ingestion
vision-feed switching from signed URLs to base64 (keyless Blob has no public URL to hand Anthropic) —
is a slice of equal size and coupled to the ingestion pipeline. It's now **Lesson 5.4**; security
review is **5.5**.

## Evidence / links
- `app/api/images/[...path]/route.ts`, `components/recipes/use-signed-image.ts`.
- ADR-0006 Decisions 1 (read) + 4 (household isolation in the route).
