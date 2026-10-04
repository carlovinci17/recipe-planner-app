#!/usr/bin/env bash
#
# Hit every page and API route and report its status, so "is the whole app
# still working?" is one command rather than a manual click-through.
#
# Two modes:
#   unauthenticated (default) - a gated page MUST redirect to /login, a public
#                               page MUST return 200. A 500 anywhere is a fail.
#   authenticated             - set SESSION_COOKIE to an Auth.js session token
#                               (scripts/mint-session.ts prints one) and every
#                               page must return 200.
#
# Usage:
#   bash scripts/sweep-pages.sh                       # localhost, no session
#   BASE=https://... bash scripts/sweep-pages.sh       # production
#   SESSION_COOKIE="$(npx tsx scripts/mint-session.ts)" bash scripts/sweep-pages.sh
#
set -uo pipefail

BASE="${BASE:-http://localhost:3000}"
SESSION_COOKIE="${SESSION_COOKIE:-}"
RECIPE_ID="${RECIPE_ID:-}"

# Public pages: reachable without a session. WITH one they are expected to
# redirect — middleware bounces a signed-in user off /login and /signup, and
# the marketing root sends them to /recipes. Either way, never a 5xx.
PUBLIC_PAGES=(
  "/"
  "/login"
  "/signup"
)

# Gated pages: without a session these must redirect; with one they must render.
GATED_PAGES=(
  "/recipes"
  "/recipes/import"
  "/recipes/new"
  "/planner"
  "/shopping"
  "/settings"
  "/settings/account"
  "/settings/household"
  "/settings/integrations"
)

# Gated, but correctly redirects even WITH a session once you have a household
# (getActiveHousehold sends you on to /recipes). Contract: never a 5xx.
CONDITIONAL_PAGES=(
  "/onboarding"
)

pass=0
fail=0
declare -a FAILURES=()

curl_status() {
  local path="$1"
  local args=(-s -o /dev/null -w '%{http_code}' -m 45)
  if [ -n "${SESSION_COOKIE}" ]; then
    args+=(-H "Cookie: ${COOKIE_NAME}=${SESSION_COOKIE}")
  fi
  curl "${args[@]}" "${BASE}${path}" 2>/dev/null || echo "000"
}

# Secure cookie name on https, plain on http - Auth.js keys off the scheme.
if [[ "${BASE}" == https://* ]]; then
  COOKIE_NAME="__Secure-authjs.session-token"
else
  COOKIE_NAME="authjs.session-token"
fi

check() {
  local path="$1" expect="$2" code
  code=$(curl_status "${path}")
  local ok=0
  case "${expect}" in
    200)      [ "${code}" = "200" ] && ok=1 ;;
    redirect) [[ "${code}" =~ ^30[0-9]$ ]] && ok=1 ;;
    # A gated page with no session must redirect; with one it must render.
    auth)     if [ -n "${SESSION_COOKIE}" ]; then [ "${code}" = "200" ] && ok=1
              else [[ "${code}" =~ ^30[0-9]$ ]] && ok=1; fi ;;
    # Public with a session, or onboarding with a household: a redirect is the
    # right answer. The only real failure is a server error or no answer.
    ok-or-redirect) [[ "${code}" =~ ^(200|30[0-9])$ ]] && ok=1 ;;
    # Public with no session must render.
    public)   if [ -n "${SESSION_COOKIE}" ]; then [[ "${code}" =~ ^(200|30[0-9])$ ]] && ok=1
              else [ "${code}" = "200" ] && ok=1; fi ;;
  esac
  if [ "${ok}" = "1" ]; then
    printf '  ok   %-34s %s\n' "${path}" "${code}"
    pass=$((pass + 1))
  else
    printf '  FAIL %-34s %s (expected %s)\n' "${path}" "${code}" "${expect}"
    fail=$((fail + 1))
    FAILURES+=("${path} -> ${code}")
  fi
}

echo "sweeping ${BASE}"
if [ -n "${SESSION_COOKIE}" ]; then
  echo "mode: authenticated (${COOKIE_NAME})"
else
  echo "mode: unauthenticated - gated pages must redirect, not 500"
fi
echo

echo "public pages"
for p in "${PUBLIC_PAGES[@]}"; do check "${p}" public; done

echo
echo "gated pages"
for p in "${GATED_PAGES[@]}"; do check "${p}" auth; done

echo
echo "conditional pages"
for p in "${CONDITIONAL_PAGES[@]}"; do check "${p}" ok-or-redirect; done

if [ -n "${RECIPE_ID}" ]; then
  echo
  echo "recipe detail (RECIPE_ID=${RECIPE_ID})"
  for p in "/recipes/${RECIPE_ID}" "/recipes/${RECIPE_ID}/edit"; do check "${p}" auth; done
fi

echo
echo "api routes that should answer without a session"
# These guard themselves (shared secret / their own auth), so the contract is
# "a definite answer", never a 500 from a missing dependency.
for p in "/api/auth/providers" "/api/auth/csrf"; do check "${p}" 200; done

echo
if [ "${fail}" -eq 0 ]; then
  echo "ALL PASS (${pass} checks)"
  exit 0
fi
echo "FAILURES (${fail} of $((pass + fail))):"
for f in "${FAILURES[@]}"; do echo "  - ${f}"; done
exit 1
