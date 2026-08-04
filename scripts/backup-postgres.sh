#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
backup_dir=${IPTVMASTER_BACKUP_DIR:-"$project_dir/backups"}
retention_days=${IPTVMASTER_BACKUP_RETENTION_DAYS:-14}

case "$retention_days" in
  ''|*[!0-9]*)
    echo "IPTVMASTER_BACKUP_RETENTION_DAYS must be a non-negative integer." >&2
    exit 2
    ;;
esac

mkdir -p -- "$backup_dir"
backup_dir=$(CDPATH= cd -- "$backup_dir" && pwd)

if [ "$backup_dir" = / ]; then
  echo "Refusing to use the filesystem root as the backup directory." >&2
  exit 2
fi

umask 077
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
final_path="$backup_dir/iptvmaster-$timestamp.dump"
temporary_path="$backup_dir/.iptvmaster-$timestamp.dump.tmp"
compose_file="$project_dir/compose.yaml"

if [ -e "$final_path" ] || [ -e "$temporary_path" ]; then
  echo "A backup for timestamp $timestamp already exists; retry in one second." >&2
  exit 1
fi

cleanup() {
  rm -f -- "$temporary_path"
}
trap cleanup EXIT HUP INT TERM

docker compose -f "$compose_file" exec -T postgres sh -c \
  'exec pg_dump --format=custom --no-owner --no-privileges --username="$POSTGRES_USER" "$POSTGRES_DB"' \
  >"$temporary_path"

if [ ! -s "$temporary_path" ]; then
  echo "PostgreSQL produced an empty backup." >&2
  exit 1
fi

docker compose -f "$compose_file" exec -T postgres pg_restore --list \
  <"$temporary_path" >/dev/null

mv -- "$temporary_path" "$final_path"
(
  cd -- "$backup_dir"
  sha256sum "$(basename -- "$final_path")" >"$(basename -- "$final_path").sha256"
)

find "$backup_dir" -maxdepth 1 -type f \
  \( -name 'iptvmaster-*.dump' -o -name 'iptvmaster-*.dump.sha256' \) \
  -mtime "+$retention_days" -delete

trap - EXIT HUP INT TERM
echo "Backup created and verified: $final_path"
