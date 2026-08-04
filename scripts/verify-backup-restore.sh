#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
project_name=${VERIFY_PROJECT_NAME:-iptvmaster-backup-test}
temporary_root=$(mktemp -d)
backup_dir="$temporary_root/backups"

export COMPOSE_PROJECT_NAME=$project_name
export POSTGRES_DB=iptvmaster
export POSTGRES_USER=iptvmaster
export POSTGRES_PASSWORD=synthetic-backup-test-only
export IPTVMASTER_MASTER_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
export IPTVMASTER_PORT=${VERIFY_PORT:-18087}
export PLAYLIST_REFRESH_ENABLED=false
export EPG_REFRESH_ENABLED=false
export IPTVMASTER_BACKUP_DIR=$backup_dir
export IPTVMASTER_BACKUP_RETENTION_DAYS=14

cleanup() {
  if [ "${VERIFY_KEEP_STACK:-false}" != true ]; then
    docker compose -f "$project_dir/compose.yaml" down -v >/dev/null 2>&1 || true
    case "$temporary_root" in
      "${TMPDIR:-/tmp}"/tmp.*) rm -rf -- "$temporary_root" ;;
      *) echo "Refusing to remove unexpected temporary path: $temporary_root" >&2 ;;
    esac
  else
    echo "Keeping Docker project $project_name and test files in $temporary_root" >&2
  fi
}
trap cleanup EXIT HUP INT TERM

if [ "${VERIFY_SKIP_BUILD:-false}" = true ]; then
  docker compose -f "$project_dir/compose.yaml" up -d --no-build
else
  docker compose -f "$project_dir/compose.yaml" up -d --build
fi

attempt=0
health_response=
until health_response=$(docker compose -f "$project_dir/compose.yaml" exec -T app \
  wget -qO- http://127.0.0.1:8080/health 2>/dev/null); do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "Application did not become healthy after migration." >&2
    docker compose -f "$project_dir/compose.yaml" ps --all >&2
    docker compose -f "$project_dir/compose.yaml" logs --tail=50 migrate app >&2
    exit 1
  fi
  sleep 2
done
if ! printf '%s' "$health_response" | grep -Eq '"version":"[^"]+"'; then
  echo "Health response does not include release version metadata." >&2
  exit 1
fi
if ! printf '%s' "$health_response" | grep -Eq '"revision":"[^"]+"'; then
  echo "Health response does not include release revision metadata." >&2
  exit 1
fi

expected_migration_count=$(find "$project_dir/deploy/postgres/init" \
  -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')
applied_migration_count=$(docker compose -f "$project_dir/compose.yaml" exec -T postgres \
  psql --username=iptvmaster --dbname=iptvmaster --tuples-only --no-align \
  --command='SELECT COUNT(*) FROM schema_migration;')
if [ "$applied_migration_count" != "$expected_migration_count" ]; then
  echo "Expected $expected_migration_count applied migrations, received $applied_migration_count." >&2
  exit 1
fi

docker compose -f "$project_dir/compose.yaml" run --rm migrate >/dev/null
first_migration=$(find "$project_dir/deploy/postgres/init" \
  -maxdepth 1 -type f -name '*.sql' | sort | head -n 1)
first_migration_name=$(basename -- "$first_migration" .sql)
first_migration_checksum=$(sha256sum "$first_migration" | awk '{ print $1 }')
docker compose -f "$project_dir/compose.yaml" exec -T postgres \
  psql --username=iptvmaster --dbname=iptvmaster --set ON_ERROR_STOP=1 \
  --command="UPDATE schema_migration SET checksum = repeat('0', 64) WHERE version = '$first_migration_name';" \
  >/dev/null
if docker compose -f "$project_dir/compose.yaml" run --rm migrate >/dev/null 2>&1; then
  echo "Migration verification accepted an altered applied checksum." >&2
  exit 1
fi
docker compose -f "$project_dir/compose.yaml" exec -T postgres \
  psql --username=iptvmaster --dbname=iptvmaster --set ON_ERROR_STOP=1 \
  --command="UPDATE schema_migration SET checksum = '$first_migration_checksum' WHERE version = '$first_migration_name';" \
  >/dev/null
docker compose -f "$project_dir/compose.yaml" run --rm migrate >/dev/null

docker compose -f "$project_dir/compose.yaml" exec -T postgres \
  psql --username=iptvmaster --dbname=iptvmaster --set ON_ERROR_STOP=1 \
  --command="CREATE TABLE backup_restore_probe (value TEXT NOT NULL); INSERT INTO backup_restore_probe (value) VALUES ('before-backup');"

"$script_dir/backup-postgres.sh"
backup_path=$(find "$backup_dir" -maxdepth 1 -type f -name 'iptvmaster-*.dump' | head -n 1)

if [ -z "$backup_path" ]; then
  echo "Backup verification did not produce an archive." >&2
  exit 1
fi

tampered_path="$backup_dir/iptvmaster-tampered.dump"
cp -- "$backup_path" "$tampered_path"
printf '%064d  %s\n' 0 "$(basename -- "$tampered_path")" >"$tampered_path.sha256"
if "$script_dir/restore-postgres.sh" --yes "$tampered_path" 2>/dev/null; then
  echo "Restore accepted a backup with an invalid checksum." >&2
  exit 1
fi
rm -f -- "$tampered_path" "$tampered_path.sha256"

docker compose -f "$project_dir/compose.yaml" exec -T postgres \
  psql --username=iptvmaster --dbname=iptvmaster --set ON_ERROR_STOP=1 \
  --command="UPDATE backup_restore_probe SET value = 'after-backup';"

"$script_dir/restore-postgres.sh" --yes "$backup_path"

restored_value=$(docker compose -f "$project_dir/compose.yaml" exec -T postgres \
  psql --username=iptvmaster --dbname=iptvmaster --tuples-only --no-align \
  --command="SELECT value FROM backup_restore_probe;")

if [ "$restored_value" != before-backup ]; then
  echo "Expected restored probe value 'before-backup', received '$restored_value'." >&2
  exit 1
fi

echo "Backup and clean-stack restore verification passed."
