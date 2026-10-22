#!/bin/sh
# Verifier for the docker-entrypoint.sh startup guard (change docker-startup-guard).
# Self-contained: temp dirs + fake npx/npm on PATH. No Docker needed.
# Usage: sh scripts/test-entrypoint-guard.sh
set -u

ENTRY="$(dirname "$0")/../docker-entrypoint.sh"
PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1"; }

# Fake toolchain: records that the migrate+start line was reached.
mkfake() {
  d="$1"
  mkdir -p "$d/bin"
  printf '#!/bin/sh\necho "$0 $@" >> "$FAKE_SENTINEL"\nexit 0\n' > "$d/bin/npx"
  printf '#!/bin/sh\necho "$0 $@" >> "$FAKE_SENTINEL"\nexit 0\n' > "$d/bin/npm"
  chmod +x "$d/bin/npx" "$d/bin/npm"
}

# --- 1.1: empty dir, no opt-in -> non-zero, no jobs.db created ---
t=$(mktemp -d); mkfake "$t"; mkdir -p "$t/data"
if FAKE_SENTINEL="$t/sentinel" PATH="$t/bin:$PATH" \
  DATA_DIR="$t/data" STARTUP_GUARD_TRIES=2 STARTUP_GUARD_SLEEP=0 \
  sh "$ENTRY" 2>"$t/stderr"; then
  bad "1.1 empty dir booted (expected refusal)"
else
  ok "1.1 empty dir refused (non-zero exit)"
fi
[ ! -e "$t/data/jobs.db" ] && ok "1.1 no jobs.db created" || bad "1.1 jobs.db was created"
grep -q "jobs.db" "$t/stderr" 2>/dev/null && ok "1.1 stderr names the missing marker" || bad "1.1 stderr missing marker"

# --- 1.2: empty dir + ALLOW_FRESH_INIT=1 -> migrate line reached ---
t=$(mktemp -d); mkfake "$t"; mkdir -p "$t/data"
if FAKE_SENTINEL="$t/sentinel" PATH="$t/bin:$PATH" \
  DATA_DIR="$t/data" ALLOW_FRESH_INIT=1 STARTUP_GUARD_TRIES=1 STARTUP_GUARD_SLEEP=0 \
  sh "$ENTRY" >/dev/null 2>&1; then
  grep -q "migrate" "$t/sentinel" 2>/dev/null && ok "1.2 opt-in reaches migrations" || bad "1.2 migrations not reached"
else
  bad "1.2 opt-in run failed"
fi

# --- 1.3a: marker appears mid-wait -> boot proceeds ---
t=$(mktemp -d); mkfake "$t"; mkdir -p "$t/data"
( sleep 1; touch "$t/data/jobs.db" ) &
if FAKE_SENTINEL="$t/sentinel" PATH="$t/bin:$PATH" \
  DATA_DIR="$t/data" STARTUP_GUARD_TRIES=30 STARTUP_GUARD_SLEEP=1 \
  sh "$ENTRY" >/dev/null 2>&1; then
  grep -q "migrate" "$t/sentinel" 2>/dev/null && ok "1.3a late marker boots" || bad "1.3a boot did not reach migrations"
else
  bad "1.3a late marker refused"
fi

# --- 1.3b: marker absent past window -> non-zero, dir untouched ---
t=$(mktemp -d); mkfake "$t"; mkdir -p "$t/data"
before=$(ls -A "$t/data" | wc -l)
if FAKE_SENTINEL="$t/sentinel" PATH="$t/bin:$PATH" \
  DATA_DIR="$t/data" STARTUP_GUARD_TRIES=2 STARTUP_GUARD_SLEEP=0 \
  sh "$ENTRY" >/dev/null 2>&1; then
  bad "1.3b absent marker booted (expected refusal)"
else
  ok "1.3b absent marker refused"
fi
after=$(ls -A "$t/data" | wc -l)
[ "$before" = "$after" ] && [ ! -e "$t/data/jobs.db" ] && ok "1.3b no files created" || bad "1.3b data dir modified"

echo "---"
echo "pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
