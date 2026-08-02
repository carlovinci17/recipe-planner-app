# Lesson 2.3 — Managed Identity + Key Vault

**Skills in play:** `/security-review` touchpoint. Azure facts verified via Microsoft Learn.

**Date:** 2026-07-29   **Module:** 2   **WAF pillar(s):** Security   **Token cost:** negligible   **Status:** ✅ Done (via Portal) — verified: secret round-trips; identity has read-only role

**Provisioned (this project):** vault `kv-recipe-planner` (`https://kv-recipe-planner.vault.azure.net/`, RBAC) · identity `id-recipe-planner` (clientId `58d11ec5-7086-4739-9b1b-4a8a864fff0a`, principalId `a1871a67-13e2-41f9-8913-533cf01e1c21`, role: Key Vault Secrets User). The **clientId** is what wires the identity into Container Apps in 2.4.

## Concept
| Thing | What it is | Role it gets |
|---|---|---|
| **Key Vault** | Managed lockbox for secrets | — |
| **Managed Identity** | Passwordless ID badge for the app | `Key Vault Secrets User` (read-only) |
| **You (admin)** | — | `Key Vault Secrets Officer` (read+write) |

**Why:** the app reads secrets with a *passwordless* identity + *least-privilege* (read-only) role.
No secret ever stored in a `.env`. Uses **RBAC** (roles), not legacy access policies.
**Cost:** managed identity free; Key Vault ~$0.03 / 10k ops → effectively $0.

## Method A — CLI (`az`)
```bash
RG=rg-recipe-planner; LOC=australiaeast; IDN=id-recipe-planner
KV=kv-recipe-<unique>          # 3–24 chars, globally unique

az identity create -g $RG -n $IDN -l $LOC
az keyvault create -n $KV -g $RG -l $LOC --enable-rbac-authorization true \
  --tags project=recipe-planner env=dev

# me = write access
az role assignment create --role "Key Vault Secrets Officer" \
  --assignee-object-id $(az ad signed-in-user show --query id -o tsv) \
  --assignee-principal-type User --scope $(az keyvault show -n $KV --query id -o tsv)

# app identity = read-only
az role assignment create --role "Key Vault Secrets User" \
  --assignee-object-id $(az identity show -g $RG -n $IDN --query principalId -o tsv) \
  --assignee-principal-type ServicePrincipal --scope $(az keyvault show -n $KV --query id -o tsv)
```

## Method B — Azure Portal
1. **Managed identity:** search *Managed Identities* → **Create** → RG `rg-recipe-planner`, Region *Australia East*, Name `id-recipe-planner` → Create.
2. **Key Vault:** search *Key vaults* → **Create** → same RG/region, unique name, tier *Standard*; on **Access configuration** set Permission model = **Azure RBAC** → Create.
3. **Your write access:** open the vault → **Access control (IAM)** → Add role assignment → **Key Vault Secrets Officer** → member = *yourself* → Review + assign.
4. **App read access:** IAM → Add role assignment → **Key Vault Secrets User** → Assign access to **Managed identity** → pick `id-recipe-planner` → Review + assign.

## Prove it (either method)
```bash
az keyvault secret set --vault-name $KV --name test-secret --value "hello-from-keyvault"
az keyvault secret show --vault-name $KV --name test-secret --query value -o tsv   # → hello-from-keyvault
```
Portal: vault → **Objects → Secrets → Generate/Import** (`test-secret`), then open it → **Show Secret Value**.
> ⚠️ Role assignments take 1–2 min to propagate; a "Forbidden" right after assigning just means "wait and retry".

## Evidence / links
- [Create Key Vault with RBAC](https://learn.microsoft.com/azure/key-vault/general/rbac-guide) · [Key Vault Secrets User role](https://learn.microsoft.com/azure/key-vault/general/rbac-guide#azure-built-in-roles-for-key-vault-data-plane-operations)
- Next: 2.4 wires this identity into Container Apps so the app reads secrets at runtime.
