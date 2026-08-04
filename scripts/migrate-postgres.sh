#!/bin/sh
set -eu

migrations_dir=${IPTVMASTER_MIGRATIONS_DIR:-/migrations}

if [ ! -d "$migrations_dir" ]; then
  echo "Migration directory does not exist: $migrations_dir" >&2
  exit 2
fi

psql -X --set ON_ERROR_STOP=1 --command='CREATE TABLE IF NOT EXISTS schema_migration (
  version TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);'

migration_count=0
for migration_path in "$migrations_dir"/*.sql; do
  if [ ! -f "$migration_path" ]; then
    echo "No SQL migrations found in $migrations_dir" >&2
    exit 2
  fi

  migration_name=$(basename -- "$migration_path" .sql)
  case "$migration_name" in
    [0-9][0-9][0-9]_*) ;;
    *)
      echo "Invalid migration filename: $(basename -- "$migration_path")" >&2
      exit 2
      ;;
  esac
  case "$migration_name" in
    *[!A-Za-z0-9_]*)
      echo "Unsafe migration filename: $(basename -- "$migration_path")" >&2
      exit 2
      ;;
  esac

  migration_count=$((migration_count + 1))
  expected_checksum=$(sha256sum "$migration_path" | awk '{ print $1 }')
  stored_checksum=$(psql -X --tuples-only --no-align \
    --set ON_ERROR_STOP=1 \
    --command="SELECT checksum FROM schema_migration WHERE version = '$migration_name';")

  if [ -n "$stored_checksum" ]; then
    if [ "$stored_checksum" != "$expected_checksum" ]; then
      echo "Checksum mismatch for applied migration $migration_name" >&2
      exit 1
    fi
    echo "Migration already applied: $migration_name"
    continue
  fi

  echo "Applying migration: $migration_name"
  psql -X --set ON_ERROR_STOP=1 --single-transaction \
    --file="$migration_path" \
    --command="INSERT INTO schema_migration (version, checksum) VALUES ('$migration_name', '$expected_checksum');"
done

echo "Database migrations verified: $migration_count"
