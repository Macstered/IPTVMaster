# Deploying to the LAN Docker host

Day-to-day deploys go from a workstation checkout straight to the Docker host over
SSH — no registry involved, nothing leaves the LAN, and secrets stay on the host.
Tagged GHCR releases (docs/RELEASES.md) remain the path for pinned production
releases; this flow exists so development iterations can reach the running
instance quickly.

## Prerequisites (one-time)

- SSH key access to the host for the deploying user. The workstation keeps the
  private key (default `~/.ssh/iptvmaster_deploy`); the host has the public key in
  `authorized_keys`.
- The compose project on the host at `/opt/iptvmaster` with its own `.env`
  (never copied or overwritten by deploys; only its `IPTVMASTER_IMAGE` line is
  rewritten, with a `.env.bak` backup).
- Docker + Compose on both ends. The workstation builds `linux/amd64` images.

Defaults target `root@<host>:/opt/iptvmaster` with health checks against
`http://<host>:8080`. Override with `IPTVMASTER_DEPLOY_HOST`,
`IPTVMASTER_DEPLOY_KEY`, `IPTVMASTER_DEPLOY_DIR`, `IPTVMASTER_DEPLOY_URL`.

## Deploy

```sh
scripts/deploy-remote.sh
```

What it does:

1. Refuses to run if tracked files have uncommitted changes (`--dirty` overrides;
   the image tag then carries a `-dirty` suffix).
2. Builds the image as `iptvmaster:<git describe>` with the version and revision
   embedded, so `/health` reports exactly what is running.
3. Streams the image over SSH (`docker save | gzip | docker load`).
4. Syncs `compose.yaml`, `deploy/` (SQL migrations), and `scripts/` to the host
   using `git archive HEAD` — committed content only, line endings normalized.
5. Records the currently active image in `.deploy-previous`, rewrites
   `IPTVMASTER_IMAGE` in the host `.env`, and runs
   `docker compose up -d --no-build`. The one-shot `migrate` service re-runs
   (idempotent, checksum-verified) before the app starts.
6. Waits until `/health` reports the deployed revision, then prunes host images
   older than current + previous.

Editor UI and output URLs blip for a few seconds during activation. TiviMate
playback is unaffected — streams go directly to the provider, never through
IPTVMaster.

## Roll back

```sh
scripts/deploy-remote.sh --rollback
```

Swaps `IPTVMASTER_IMAGE` with the value in `.deploy-previous` and restarts.
Running it twice returns to the newer image. Application-only rollback is safe
only while both releases run the same schema — SQL migrations are forward-only.
If the bad release introduced a migration, follow docs/PROXMOX_INSTALL.md
section 6 (prior checkout + database restore) instead.

## Troubleshooting

- **Health timeout** — inspect on the host:
  `cd /opt/iptvmaster && docker compose ps --all && docker compose logs --tail 50 app migrate`.
  A failed `migrate` leaves the previous app running; fix forward or restore.
- **Host key changed** — remove the old entry with
  `ssh-keygen -R <host>` and reconnect deliberately.
- **Git checkout drift on the host** — deploys overwrite `compose.yaml`,
  `deploy/`, and `scripts/` with committed content from the workstation, so the
  host's `git status` may show changes if its checked-out commit lags. Aligning
  it is cosmetic: `cd /opt/iptvmaster && git fetch && git checkout <deployed rev>`.
