#!/usr/bin/env bash
# Seed Secrets Manager values for the mobile backend.
#
# Usage:
#   ENV=staging ./scripts/seed-secrets.sh
#
# Prompts interactively for each secret. Existing values are preserved when the
# user submits an empty line.

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
echo "Done."
