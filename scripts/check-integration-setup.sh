#!/usr/bin/env bash
# Host setup check for job-ops + cv-tailoring integration.
# Exit 0 only when every hard prerequisite is present.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
JOB_OPS="${JOB_OPS_ROOT:-$ROOT/job-ops}"
VAULT="${CV_TAILORING_ROOT:-$ROOT/cv-tailoring}"
GDOCS="$VAULT/_shared/gdocs"
FAIL=0

ok()   { printf '  [ok]   %s\n' "$1"; }
bad()  { printf '  [FAIL] %s\n' "$1"; FAIL=1; }
warn() { printf '  [warn] %s\n' "$1"; }

echo "== Scheduler env (job-ops/.env) =="
ENV_FILE="$JOB_OPS/.env"
if [[ -f "$ENV_FILE" ]]; then
  for key in SCHEDULED_PIPELINE_CRON SCHEDULED_PIPELINE_TIMEZONE SCHEDULED_PIPELINE_SEARCH_NAME SCHEDULED_PIPELINE_TENANT_ID SCHEDULED_PIPELINE_USER_ID; do
    if grep -Eq "^${key}=[\"']?[^\"']+" "$ENV_FILE"; then
      ok "$key is set"
    else
      bad "$key is missing or empty in $ENV_FILE"
    fi
  done
  if grep -Eq '^SCHEDULED_PIPELINE_CRON="?47 20 \* \* 1,5,6,0"?' "$ENV_FILE"; then
    ok "cron is Fri/Sat/Sun/Mon 20:47"
  else
    warn "cron is not 47 20 * * 1,5,6,0 (check intended window)"
  fi
else
  bad "missing $ENV_FILE"
fi

echo "== gdocs secrets =="
for f in config.ini token.json; do
  if [[ -s "$GDOCS/$f" ]]; then
    ok "$f present"
  else
    bad "missing $GDOCS/$f (copy from Windows vault _shared/gdocs/)"
  fi
done

echo "== Python / opencode =="
if command -v python3 >/dev/null 2>&1; then
  ok "python3 on PATH ($(command -v python3))"
else
  bad "python3 not on PATH"
fi
if python3 -c 'import laya' 2>/dev/null || "${VAULT}/_shared/.venv-ai/bin/python" -c 'import laya' 2>/dev/null; then
  ok "python package laya importable"
else
  warn "laya not installed (python3 -m venv _shared/.venv-ai && pip install laya) — primitives scoring unavailable"
fi
if command -v opencode >/dev/null 2>&1; then
  ok "opencode on PATH ($(command -v opencode))"
else
  bad "opencode not on PATH"
fi

echo "== Paths =="
if [[ -d "$VAULT/_shared/05-work-primitives" ]]; then
  ok "criteria bank dir exists"
else
  bad "missing $VAULT/_shared/05-work-primitives"
fi
if [[ -f "$JOB_OPS/docker-compose.yml" ]] && grep -q '../cv-tailoring:/cv-tailoring' "$JOB_OPS/docker-compose.yml"; then
  ok "compose mounts full cv-tailoring at /cv-tailoring"
else
  warn "compose may be missing full cv-tailoring mount"
fi

echo
if [[ "$FAIL" -ne 0 ]]; then
  echo "Setup check FAILED — fix items above before enabling cvTailoringEnabled."
  exit 1
fi
echo "Setup check passed."
