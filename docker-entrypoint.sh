#!/bin/sh
# Job Ops container entrypoint.
#
# The Cloudflare challenge viewer is started lazily by the server only when a
# challenge needs human interaction. Keeping it out of startup avoids carrying
# idle Xvfb/x11vnc/noVNC processes on every normal pipeline run.

# Startup guard: never fork a fresh database on an unmounted data dir.
#
# After a host reboot Docker may autostart this container before the file
# share is ready, so DATA_DIR looks empty and migrations would silently
# initialize a forked DB. Instead: wait briefly for the marker, then fail
# fast so the restart policy retries visibly instead of forking silently.
DATA_DIR="${DATA_DIR:-/app/data}"
MARKER="$DATA_DIR/jobs.db"
STARTUP_GUARD_TRIES="${STARTUP_GUARD_TRIES:-60}"
STARTUP_GUARD_SLEEP="${STARTUP_GUARD_SLEEP:-2}"

if [ ! -f "$MARKER" ] && [ "${ALLOW_FRESH_INIT:-}" != "1" ]; then
  tries=0
  while [ "$tries" -lt "$STARTUP_GUARD_TRIES" ] && [ ! -f "$MARKER" ]; do
    sleep "$STARTUP_GUARD_SLEEP"
    tries=$((tries + 1))
  done
  if [ ! -f "$MARKER" ]; then
    echo "job-ops: refusing to boot: $DATA_DIR has no jobs.db (data dir looks unmounted)" >&2
    echo "job-ops: to allow a genuine first install on an empty dir, restart once with ALLOW_FRESH_INIT=1 (one-shot; remove it afterwards)" >&2
    echo "job-ops: recovery direction is host -> container only; never copy a forked DB back to the host" >&2
    exit 1
  fi
fi

# Run the app
cd /app/orchestrator
exec sh -c "npx tsx src/server/db/migrate.ts && npm run start"
