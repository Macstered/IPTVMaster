# Release, upgrade, and rollback runbook

IPTVMaster releases use one semantic version across the root package and all workspaces. A Git tag must be exactly `vVERSION`. The tag workflow validates this contract, runs the full verification suite, and publishes two private GitHub Container Registry tags:

- `ghcr.io/macstered/iptvmaster:VERSION`
- `ghcr.io/macstered/iptvmaster:sha-FULL_COMMIT_SHA`

No floating `latest` image is published. The application exposes the embedded version and revision at `/health`, and the image carries matching OCI labels.

## Prepare and publish a release

Do the version change through a pull request:

```sh
git switch -c release/v0.1.0
npm version 0.1.0 --workspaces --include-workspace-root --no-git-tag-version
npm run check
git add package.json package-lock.json apps/*/package.json packages/*/package.json
git commit -m "Prepare v0.1.0"
git push -u origin release/v0.1.0
```

After that pull request is merged and `main` is green, create the tag from the verified `main` commit:

```sh
git switch main
git pull --ff-only
npm run verify:version
git tag -a v0.1.0 -m "IPTVMaster v0.1.0"
git push origin v0.1.0
```

Do not move or reuse a release tag. The GitHub `Release image` workflow must pass before deploying it.

## Database migration contract

SQL files under `deploy/postgres/init` are ordered migrations, despite the historical directory name. The one-shot `migrate` Compose service:

1. waits for PostgreSQL readiness;
2. creates the `schema_migration` ledger when needed;
3. applies each missing migration in its own transaction;
4. records its SHA-256 checksum; and
5. blocks application startup if a migration fails or an applied file changed.

Never edit an applied migration. Add the next numbered file. Migrations are forward-only, so a pre-upgrade database backup is the rollback boundary for a schema-incompatible release.

## First pinned deployment

Check out the same release tag as the image. For a private GHCR package, sign Docker in with a personal access token (classic) limited to `read:packages`, then pin `.env`:

```sh
cd /opt/iptvmaster
git fetch --tags --force
git switch --detach v0.1.0
read -rsp 'GHCR token: ' CR_PAT
printf '%s' "$CR_PAT" | docker login ghcr.io --username YOUR_GITHUB_USERNAME --password-stdin
unset CR_PAT
```

Set this value in `/opt/iptvmaster/.env`:

```dotenv
IPTVMASTER_IMAGE=ghcr.io/macstered/iptvmaster:0.1.0
```

Then deploy without rebuilding:

```sh
docker compose pull app postgres migrate
docker compose up -d --no-build
docker compose ps --all
curl --fail http://127.0.0.1:8080/ready
curl --fail http://127.0.0.1:8080/health
docker compose exec -T postgres sh -c \
  'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version, applied_at FROM schema_migration ORDER BY version;"'
```

If GHCR access is not configured, build the checked-out tag locally with immutable metadata and use the resulting local image:

```sh
docker build \
  --build-arg IPTVMASTER_VERSION=0.1.0 \
  --build-arg IPTVMASTER_REVISION="$(git rev-parse HEAD)" \
  --tag iptvmaster:0.1.0 .
```

Set `IPTVMASTER_IMAGE=iptvmaster:0.1.0`, then run the same `docker compose up -d --no-build` and verification commands.

## Upgrade

Record the current `/health` response and image value first. Create both application and Proxmox backups before changing the checkout or image.

```sh
cd /opt/iptvmaster
./scripts/backup-postgres.sh
curl --fail http://127.0.0.1:8080/health
git fetch --tags --force
git switch --detach vNEW_VERSION
```

Set `IPTVMASTER_IMAGE=ghcr.io/macstered/iptvmaster:NEW_VERSION` in `.env`, then:

```sh
docker compose pull app postgres migrate
docker compose up -d --no-build
docker compose ps --all
curl --fail http://127.0.0.1:8080/ready
curl --fail http://127.0.0.1:8080/health
docker compose logs --no-color --tail=100 migrate app
```

Verify one manual source refresh, both tokenized outputs, and one player stream before accepting the upgrade.

## Roll back

For an application-only rollback where the release notes explicitly say the database remains backward compatible:

1. check out the prior release tag;
2. restore the prior `IPTVMASTER_IMAGE` value;
3. run `docker compose pull app` and `docker compose up -d --no-build`; and
4. repeat readiness, output, and playback checks.

If a migration was applied and backward compatibility is not explicit, restore the pre-upgrade database backup while the checkout and image are both pinned to the prior release:

```sh
cd /opt/iptvmaster
git switch --detach vPREVIOUS_VERSION
# Restore IPTVMASTER_IMAGE=ghcr.io/macstered/iptvmaster:PREVIOUS_VERSION in .env
docker compose pull app postgres migrate
docker compose up -d postgres
docker compose create --no-deps --force-recreate app
./scripts/restore-postgres.sh /var/backups/iptvmaster/PRE_UPGRADE_BACKUP.dump
curl --fail http://127.0.0.1:8080/ready
curl --fail http://127.0.0.1:8080/health
```

Run the restore script from the prior checkout. Running a newer restore script can reapply newer forward-only migrations and defeat the schema rollback.
