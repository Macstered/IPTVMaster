#!/bin/sh
set -eu

usage() {
  echo "Usage: $0 [--yes] BACKUP_FILE" >&2
}

assume_yes=false
if [ "${1:-}" = "--yes" ]; then
  assume_yes=true
  shift
fi

if [ "$#" -ne 1 ]; then
  usage
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
backup_path=$1

if [ ! -f "$backup_path" ]; then
  echo "Backup file does not exist: $backup_path" >&2
  exit 2
fi

backup_dir=$(CDPATH= cd -- "$(dirname -- "$backup_path")" && pwd)
backup_path="$backup_dir/$(basename -- "$backup_path")"
compose_file="$project_dir/compose.yaml"

case "$backup_path" in
  *.dump) ;;
  *)
    echo "Backup file must use the .dump extension." >&2
    exit 2
    ;;
esac

if [ -f "$backup_path.sha256" ]; then
  expected_checksum=$(awk 'NR == 1 { print $1 }' "$backup_path.sha256")
  actual_checksum=$(sha256sum "$backup_path" | awk '{ print $1 }')
  if [ -z "$expected_checksum" ] || [ "$actual_checksum" != "$expected_checksum" ]; then
    echo "Backup checksum validation failed: $backup_path" >&2
    exit 1
  fi
  echo "$(basename -- "$backup_path"): OK"
else
  echo "Warning: no checksum sidecar found; validating the archive structure only." >&2
fi

docker compose -f "$compose_file" exec -T postgres pg_restore --list \
  <"$backup_path" >/dev/null

if [ "$assume_yes" != true ]; then
  echo "This will replace the current IPTVMaster database with:"
  echo "  $backup_path"
  printf 'Type RESTORE to continue: '
  read -r confirmation
  if [ "$confirmation" != RESTORE ]; then
    echo "Restore cancelled."
    exit 1
  fi
fi

app_stopped=false
database_replaced=false
restart_app() {
  if [ "$app_stopped" = true ] && [ "$database_replaced" = false ]; then
    docker compose -f "$compose_file" start app >/dev/null
  fi
}
trap restart_app EXIT HUP INT TERM

docker compose -f "$compose_file" stop app >/dev/null
app_stopped=true

docker compose -f "$compose_file" exec -T postgres sh -c \
  'exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set ON_ERROR_STOP=1 --command="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();"' \
  >/dev/null

docker compose -f "$compose_file" exec -T postgres sh -c \
  'exec pg_restore --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges --single-transaction' \
  <"$backup_path"

database_replaced=true
docker compose -f "$compose_file" run --rm --no-deps app node apps/api/dist/migrate.js
docker compose -f "$compose_file" start app >/dev/null
app_stopped=false
trap - EXIT HUP INT TERM

attempt=0
until docker compose -f "$compose_file" exec -T app \
  wget -qO- http://127.0.0.1:8080/ready >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "Database restored, but the application did not become healthy." >&2
    docker compose -f "$compose_file" ps >&2
    docker compose -f "$compose_file" logs --tail=50 app >&2
    exit 1
  fi
  sleep 2
done

echo "Database restored and application healthy: $backup_path"
