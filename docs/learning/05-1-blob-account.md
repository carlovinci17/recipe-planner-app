# Lesson 5.1 — Blob account + private containers (keyless)

**Date:** 2026-08-12   **Module:** 5 (Storage)   **WAF pillar(s):** Security, Cost   **Status:** ✅ Done — dev account live, keyless verified.
**Decided in:** [ADR-0006](../adr/0006-storage.md).

## What we did
Created the **dev** Azure Blob storage account + the two private containers, keyless, via Bicep
(`infra/storage.bicep`). "Keyless" is enforced *by the resource*: `allowSharedKeyAccess: false` means
account keys don't work at all — the only way in is a Microsoft Entra identity (your `az login` in
dev; the Container App's Managed Identity in prod).

## The Bicep (reusable per environment)
`infra/storage.bicep` — params `principalId` (who gets access) + `principalType` (`User` dev /
`ServicePrincipal` prod). Key properties: `allowSharedKeyAccess: false` (keyless), `allowBlobPublicAccess:
false` (private), `minimumTlsVersion: 'TLS1_2'`. Two containers `recipe-uploads` + `recipe-images`
(`publicAccess: None`). Grants **Storage Blob Data Contributor** (`ba92f5b4-2d11-453d-a403-e96b0029c9fe`)
to the principal.

## Deploy + verify (what we ran)
```bash
az deployment group create -g rg-recipe-planner -n storage-dev \
  --template-file infra/storage.bicep \
  --parameters principalId=<your-az-object-id> principalType=User
# then, keyless (shared key is off, so --auth-mode login is required):
az storage container list --account-name <acct> --auth-mode login -o table
az storage blob upload    --account-name <acct> --container-name recipe-images --name test.txt --file … --auth-mode login
```
**This run's dev account:** `strpdevdtyzeg7l6ihh4` (goes into `.env.local` as the Blob endpoint for
Lesson 5.2). Prod account is deployed the same way (with the Managed Identity) at cutover.

## Gotchas
- **`--auth-mode login` is mandatory** — with shared-key disabled, the default key mode fails. That's
  the keyless design proving itself, not an error.
- **Role propagation** takes up to ~10 min after deploy before keyless calls succeed.
- Don't paste inline `# comments` into the shell — some shells pass `#` as an argument.

## Evidence / links
- `infra/storage.bicep`. MS Learn: _Azure built-in roles for Storage_ (Blob Data Contributor),
  _Storage Account Blob Containers (Bicep)_, _Assign an Azure role for access to blob data_.
