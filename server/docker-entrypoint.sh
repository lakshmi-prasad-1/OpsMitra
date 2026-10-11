#!/bin/sh
# Container entrypoint.
#
# Hosted volumes (Railway, Fly, Docker bind mounts...) are mounted over /data when the container starts and are
# often owned by root, which hides the ownership set while the image was built. The app itself must NOT run as
# root, so: if we start as root, make sure the database folder is writable by the unprivileged app user (changing
# ownership only, never deleting or rewriting data), then drop privileges and exec the real command.
set -eu

APP_USER="${APP_USER:-node}"

if [ "$(id -u)" = "0" ]; then
  APP_UID="$(id -u "$APP_USER")"
  APP_GID="$(id -g "$APP_USER")"
  as_app() { setpriv --reuid="$APP_UID" --regid="$APP_GID" --init-groups "$@"; }

  if [ -n "${SQLITE_PATH:-}" ]; then
    DB_PATH="$SQLITE_PATH"
    DB_DIR="$(dirname "$DB_PATH")"
    case "$DB_DIR" in
      ""|"/"|".") echo "[entrypoint] SQLITE_PATH must point into a dedicated folder (for example /data/opsmitra.sqlite), not '$DB_DIR'. Refusing to change ownership." >&2; exit 1 ;;
    esac
    mkdir -p "$DB_DIR"

    needs_fix=0
    as_app test -w "$DB_DIR" || needs_fix=1
    for f in "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"; do
      if [ -e "$f" ] && ! as_app test -w "$f"; then needs_fix=1; fi
    done

    if [ "$needs_fix" = "1" ]; then
      echo "[entrypoint] $DB_DIR is not writable by '$APP_USER'; fixing ownership (data is left untouched)."
      chown -R "$APP_UID:$APP_GID" "$DB_DIR" || echo "[entrypoint] warning: could not change ownership of $DB_DIR; the app may fail to open the database." >&2
    fi
  fi
  exec setpriv --reuid="$APP_UID" --regid="$APP_GID" --init-groups "$@"
fi

# Already unprivileged (local run, or the platform forced a user): just start the app.
exec "$@"
