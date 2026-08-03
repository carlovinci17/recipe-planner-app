# Lesson 2.5 — CI/CD: auto-deploy GitHub → Azure (OIDC)

**Skills in play:** Microsoft Learn MCP (federated identity / OIDC facts) · `/security-review` mindset (passwordless, least privilege).

**Date:** 2026-08-03   **Module:** 2   **WAF pillar(s):** Operational Excellence, Security   **Token cost:** low   **Status:** ✅ Done (auto-deploy) — CI quality gates still to add (see below)

## What we did
Connected GitHub Actions → Azure so a push **automatically redeploys** to Container Apps — no more
hand-run `az containerapp update`. Auth uses **OIDC federated identity**: GitHub proves who it is
with a short-lived token, so **no secret is stored in GitHub**.

```
git push → build job: build image → ghcr.io
         → deploy job: OIDC login to Azure (passwordless)
         → az containerapp update → new revision live
```

## The setup (one-time)
| Piece | Value | Why |
|---|---|---|
| Deploy identity | `id-github-deploy` (user-assigned) | Separate from the app's Key Vault identity — least privilege |
| Federated credential | subject `repo:carlovinci17/recipe-planner-app:ref:refs/heads/version2/plan` | The passwordless trust: only *this repo+branch* can assume the identity |
| RBAC | **Contributor** scoped to `rg-recipe-planner` | Just enough to update the app; nothing outside the RG |
| Repo Variables | `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | Non-secret IDs the workflow logs in with |
| Workflow | `deploy` job (`needs: build`, `id-token: write`) → `azure/login@v2` → `az containerapp update` | The deploy step |

## Why OIDC over a stored secret (best practice)
- **No long-lived credential in GitHub** — nothing to leak or rotate. The token is minted per-run and expires in minutes.
- **Scoped trust** — the federated credential names the exact repo + branch; another repo can't use it.
- Contrast the old way: a service-principal client secret pasted into a GitHub secret (leakable, needs rotation).

## Verified
Pushed `:2fe8a9a`; both jobs green; live revision flipped to `recipe-planner--0000006` on the new
image with **zero manual steps**.

## Still to add (remaining 2.5 scope — deferred)
The plan's full CI also wants **quality/security gates** on PRs — not yet wired:
- `typecheck → lint → test → build` gate
- **gitleaks** (pre-commit + CI) · **trivy** (image/IaC scan) · **trufflehog** (scheduled history scan)

These are additive; the deploy pipeline is the headline and it's done.

## FAQs captured this lesson
> **Q (you, earlier):** Does GitHub Actions link to Azure?
> **A:** Now yes — via this OIDC deploy job. Before 2.5 it only built + pushed to ghcr; Azure merely pulled.

## Evidence / links
- `.github/workflows/build.yml` (the `deploy` job)
- Verified via Microsoft Learn: GitHub Actions OIDC federated identity with Azure.
