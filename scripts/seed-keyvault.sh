#!/usr/bin/env bash
# =============================================================================
# Seed an Azure Key Vault from a .env-style file.
#
# Azure Key Vault has NO native ".env import", so this loops each KEY=VALUE line
# and runs `az keyvault secret set`, converting "_" -> "-" in the secret name
# (Key Vault names allow only letters, digits and hyphens).
#
#   Usage:  ./scripts/seed-keyvault.sh <vault-name> <env-file>
#   e.g.:   ./scripts/seed-keyvault.sh recipe-planner-kv .env.prod
#
# Only the [SECRET] lines belong in Key Vault. Either pass a file containing just
# those, or comment out the [ENV]/[BUILD] lines before running. Requires `az`
# logged in (`az login`) with secret-set permission on the vault.
# =============================================================================
set -euo pipefail

VAULT="${1:?usage: seed-keyvault.sh <vault-name> <env-file>}"
FILE="${2:?usage: seed-keyvault.sh <vault-name> <env-file>}"
[[ -f "$FILE" ]] || { echo "env file not found: $FILE" >&2; exit 1; }

while IFS='=' read -r key rest; do
  key="${key%%[[:space:]]}"
  # skip blanks and comment lines
  [[ -z "$key" || "$key" == \#* ]] && continue
  # value = everything after the first '=', minus a trailing CR and inline comment
  value="${rest%$'\r'}"
  value="${value%%[[:space:]]#*}"      # drop trailing " # comment"
  secret_name="${key//_/-}"            # DATABASE_URL -> DATABASE-URL
  echo "→ $key  ->  secret '$secret_name'"
  az keyvault secret set \
    --vault-name "$VAULT" \
    --name "$secret_name" \
    --value "$value" \
    --output none
done < "$FILE"

echo "✅ Done. Reference each secret from the Container App as a Key Vault reference"
echo "   (Container Apps: secretRef -> keyvaultref, mapping DATABASE-URL back to DATABASE_URL)."
