#!/usr/bin/env bash
# Seed Secrets Manager values for the mobile backend.
#
# Usage:
#   ENV=staging ./scripts/seed-secrets.sh
#
# Prompts interactively for each secret. Existing values are preserved when the
# user submits an empty line.
#
# After seeding, the script reads each secret back and refuses to exit
# successfully if any one of them is still at the Terraform placeholder
# `REPLACE_ME` (or empty) — the most common foot-gun is to accidentally skip
# the gs-oauth-client-id prompt with an empty Enter, ship the Lambda, and
# discover the OAuth flow forwarding `client_id=REPLACE_ME` to GS.

set -euo pipefail

ENV="${ENV:-staging}"
REGION="${AWS_REGION:-eu-west-1}"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required" >&2
  exit 1
fi

SECRETS=(
  "gs-mobile/${ENV}/gs-oauth-client-id"
  "gs-mobile/${ENV}/gs-oauth-client-secret"
  "gs-mobile/${ENV}/gs-oauth-base-url"
  "gs-mobile/${ENV}/photoroom-api-key"
  "gs-mobile/${ENV}/autoretouch-api-key"
)

for SECRET in "${SECRETS[@]}"; do
  echo
  echo "--- ${SECRET}"
  read -r -p "  new value (empty = skip): " VALUE
  if [[ -z "${VALUE}" ]]; then
    echo "  skipped"
    continue
  fi
  aws secretsmanager put-secret-value \
    --secret-id "${SECRET}" \
    --secret-string "${VALUE}" \
    --region "${REGION}" \
    >/dev/null
  echo "  updated"
done

echo
echo "=== Verifying secrets state ==="
BAD_SECRETS=()
for SECRET in "${SECRETS[@]}"; do
  CURRENT=$(aws secretsmanager get-secret-value \
    --secret-id "${SECRET}" \
    --region "${REGION}" \
    --query SecretString \
    --output text 2>/dev/null || echo "<missing>")
  if [[ "${CURRENT}" == "REPLACE_ME" ]] || [[ "${CURRENT}" == "<missing>" ]] || [[ -z "${CURRENT}" ]]; then
    echo "  ✗ ${SECRET}: still placeholder (${CURRENT})"
    BAD_SECRETS+=("${SECRET}")
  else
    echo "  ✓ ${SECRET}: set"
  fi
done

if (( ${#BAD_SECRETS[@]} > 0 )); then
  echo
  echo "ERROR: ${#BAD_SECRETS[@]} secret(s) still holding a placeholder. The Lambda" >&2
  echo "will forward 'REPLACE_ME' to upstreams (e.g. GS OAuth) and the flow will" >&2
  echo "break. Re-run this script and provide a real value for:" >&2
  for S in "${BAD_SECRETS[@]}"; do
    echo "  - ${S}" >&2
  done
  exit 2
fi

echo
echo "Done."
