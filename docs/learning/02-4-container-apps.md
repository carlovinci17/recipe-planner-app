# Lesson 2.4 — Container Apps + Dockerfile (app live on Azure)

**Skills in play:** Microsoft Learn MCP (verified Container Apps / Key Vault facts) · `diagnosing-bugs` (the proxy + cold-start saga) · `/security-review` mindset (secrets stay in Key Vault).

**Date:** 2026-08-03   **Module:** 2   **WAF pillar(s):** Operational Excellence, Security, Cost   **Token cost:** low (mostly az/CLI + a few MS Learn lookups)   **Status:** ✅ Done — signed in and running on Azure

## What we did
Packaged the current app into a container and ran it on **Azure Container Apps**, pulling a
**private** image from GitHub Container Registry, with all secrets sourced from **Key Vault** via a
passwordless **managed identity**. End state: Google sign-in works and the app serves on a public
Azure HTTPS URL.

```
GitHub push → CI builds image → ghcr.io (private)
   → Container Apps pulls it (PAT) → runs it (warm)
   → reads secrets from Key Vault via id-recipe-planner
   → https://recipe-planner.<env>.azurecontainerapps.io
```

## The build (Step 1–2)
- `next.config.ts` → `output: "standalone"`; multi-stage `Dockerfile` (`node:24-bookworm-slim` for the `sharp`/`@napi-rs/canvas` native modules), non-root runner, `.dockerignore` excludes local `node_modules` + `.env*`.
- `NEXT_PUBLIC_*` passed as **build args** (they're inlined into the client bundle at build time; public, so safe to bake in). Real secrets never enter the image.

## The deploy (Step 3–4)
| Piece | Choice |
|---|---|
| Registry | **ghcr.io private** (free) — CI (`.github/workflows/build.yml`) builds & pushes on every push using the built-in `GITHUB_TOKEN` |
| Pull credential | A GitHub **PAT** (`read:packages`) stored as a Container Apps registry secret |
| Compute | Container Apps env `cae-recipe-planner`; app `recipe-planner`, ingress on **3000**, scale rules |
| Secrets | 5 **Key Vault references** on the app → mapped to env-var names; resolved by `id-recipe-planner` (Secrets User) |

## Gotchas that cost real time (the actual learning)
1. **`next build` needs the two required `NEXT_PUBLIC_*` at build time** — Zod env validation runs at import; pass them as `--build-arg`.
2. **Redirects behind a TLS-terminating proxy.** Container Apps terminates HTTPS at the ingress and forwards plain HTTP to the container on `0.0.0.0:3000`, so `request.nextUrl` is the *internal* address. Redirects went to `http://0.0.0.0:3000/…`, then (after a partial fix) `https://<fqdn>:3000/…`. Fix: rebuild the redirect origin from `x-forwarded-host`/`-proto` **and strip the port** (`lib/url.ts` `publicUrl()`).
3. **Scale-to-zero breaks interactive flows.** Idle → 0 replicas; an OAuth round-trip then hits a ~20–25s cold start that exceeds the browser timeout (`ERR_CONNECTION_TIMED_OUT`). Set `min-replicas 1` to stay warm (small cost) — a real Cost ↔ Performance trade-off.
4. **Revision transitions can briefly split traffic** — wait for a single active revision at 100% before testing.
5. **Key Vault reference secrets need the identity attached first** (Phase B before Phase C).

## Pros / Cons of this setup
| Pros | Cons |
|---|---|
| No secrets in image or env — Key Vault + passwordless identity | Private-image pull needs a PAT to manage/rotate |
| CI-built, reproducible, scale-to-zero-capable | Cold starts hurt UX (mitigated with `min-replicas 1`) |
| Production-shaped (least privilege, non-root) | More moving parts than Vercel's "just push" |

## Cost note
`min-replicas 1` (one always-warm replica, mostly at the cheaper idle rate) is currently set so the
app is usable. Revert to `0` for strict $0 at the cost of cold starts. (Decision D — still open.)

## FAQs captured this lesson
> **Q (you):** Does GitHub Actions link to Azure? How did it rebuild in Azure?
> **A:** It didn't rebuild in Azure — CI builds on **GitHub's** runners and pushes to ghcr.io; Azure only *pulls*. Auto-deploy (GitHub → Azure) is Lesson 2.5.
> **Q (you):** Why a container and not a Static Web App / PWA?
> **A:** The app is server-heavy (Server Actions + RSC + the AI pipeline + native modules) — SWA can't run that; PWA is a frontend capability we keep regardless.
> **Q (you):** Was the sign-in bug something we introduced?
> **A:** No — it was always latent; earlier failures blocked the flow before we reached it.

## Evidence / links
- Verified via Microsoft Learn: [Container Apps storage/scale](https://learn.microsoft.com/azure/container-apps/), [Key Vault RBAC](https://learn.microsoft.com/azure/key-vault/general/rbac-guide).
- Repo: `Dockerfile`, `.dockerignore`, `.github/workflows/build.yml`, `lib/url.ts`, `next.config.ts`.
- Live: `https://recipe-planner.delightfulrock-67fe0b09.australiaeast.azurecontainerapps.io`
