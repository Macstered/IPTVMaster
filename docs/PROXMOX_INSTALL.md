# Proxmox installation runbook

This is the target production procedure once a tagged IPTVMaster release is available. Do not use real provider credentials until the application setup flow and secret storage are complete.

## 1. Create the VM

Create a minimal supported Debian VM with:

- 2 vCPU
- 4 GB RAM
- 32 GB disk on reliable storage
- VirtIO disk and network devices
- QEMU guest agent enabled
- A DHCP reservation or stable address on the trusted LAN

Use a normal VM rather than Docker inside an LXC for straightforward isolation, Docker compatibility, backup, and rollback behavior.

## 2. Prepare Debian

1. Install security updates.
2. Set the system timezone to `Europe/Helsinki`; application data remains UTC.
3. Install and enable the QEMU guest agent.
4. Create a non-root administrator and install an SSH public key.
5. Disable password-based remote root login.
6. Install Docker Engine and the Compose plugin from Docker's official Debian repository.

Use the currently supported official Debian and Docker instructions during deployment rather than copying unversioned installation scripts into this repository.

## 3. Deploy

Create `/opt/iptvmaster`, check out a pinned release tag, and copy `.env.example` to `.env`. Replace the database password with a long random value, generate `IPTVMASTER_MASTER_KEY` using `openssl rand -base64 32`, and restrict the file to the administrator/root account. Back up the master key securely and separately; losing it makes stored provider credentials unrecoverable. Set `IPTVMASTER_IMAGE` to the matching numbered GHCR image, or build that checked-out tag locally with the same numbered image tag. Never deploy `latest`.

The default playlist refresh interval is 120 minutes and the XMLTV interval is 720 minutes. Keep those provider-friendly defaults initially; change them only after observing how often the provider's daily event groups and guide actually change. Transient downloads use at most three attempts with short bounded backoff; `401`, `403`, `404`, malformed responses, and unsafe snapshots are not retried. Daily maintenance removes expired browser sessions without deleting retained playlist rollback history.

```sh
cd /opt/iptvmaster
docker compose pull app postgres migrate
docker compose up -d --no-build
docker compose ps --all
```

The one-shot `migrate` service must exit successfully before the app starts. It records applied SQL checksums and safely does nothing on repeat startup. See [RELEASES.md](./RELEASES.md) for GHCR authentication, local pinned builds, version creation, and exact rollback commands.

The app is initially published on TCP port 8080. Restrict it to trusted LAN clients using the Proxmox firewall, guest firewall, or both. Do not forward the port on the internet router.

On the first browser visit, create the single local administrator account. Store that password in the same private password manager used for the VM administration credentials. Sessions last seven days by default; adjust `IPTVMASTER_SESSION_HOURS` if needed. Leave `IPTVMASTER_SECURE_COOKIES=false` for direct LAN HTTP. Set it to `true` only after an HTTPS reverse proxy is in place and HTTP access is no longer used.

Prefer a DHCP reservation and a `home.arpa` DNS name. A stable IP address can be used directly in the player if local DNS is unavailable.

## 4. Verify

- `http://VM_ADDRESS:8080/health` reports healthy.
- The health response reports the expected pinned version and Git revision.
- `http://VM_ADDRESS:8080/ready` reports ready and shows whether first-run administrator setup is still required.
- The browser UI loads from a trusted LAN computer.
- Unauthenticated editor API requests return `401`, while a signed-in administrator can complete the workflow.
- The container and VM recover after separate reboots.
- The provider secret does not appear in container logs.
- A generated M3U URL loads from another trusted LAN device and stops loading after revocation.
- The paired XMLTV URL loads in an IPTV player, contains guide programmes, and is also blocked by the same revocation.
- A test playlist refresh does not relay playback through the VM.

When creating output URLs, open the setup UI using the VM's stable LAN hostname or address, not `localhost`. The generated address uses the browser origin and must be reachable from your playback devices.

## 5. Back up

Use two backup layers:

1. Daily application-level PostgreSQL backups with tested restore instructions.
2. Regular Proxmox VM backups to storage outside the VM disk.

Do not assume a VM snapshot on the same physical disk is a sufficient backup. Test at least one restore before making IPTVMaster the primary playlist source.

The repository includes a daily systemd timer. Install it after choosing storage outside the application checkout:

```sh
sudo install -d -m 0700 /var/backups/iptvmaster
sudo install -m 0644 deploy/systemd/iptvmaster-backup.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/iptvmaster-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now iptvmaster-backup.timer
sudo systemctl start iptvmaster-backup.service
sudo systemctl status iptvmaster-backup.service
```

The supplied unit assumes the checkout is `/opt/iptvmaster`, writes to `/var/backups/iptvmaster`, runs at about 03:30 local time with a randomized delay, and keeps 14 days. Use `systemctl edit iptvmaster-backup.service` to override the directory or retention. Copy completed archives and their `.sha256` files to storage outside the VM disk.

Backups include encrypted provider data but do not include `.env` or `IPTVMASTER_MASTER_KEY`. Store the production `.env` or at minimum the master key in a separate secure location.

Rehearse a restore before depending on the service:

```sh
cd /opt/iptvmaster
./scripts/restore-postgres.sh /var/backups/iptvmaster/iptvmaster-YYYYMMDDTHHMMSSZ.dump
docker compose ps
curl --fail http://127.0.0.1:8080/health
```

The restore command requires the exact word `RESTORE`, validates the sidecar checksum and archive, stops the application, restores in one transaction, restarts it, and waits for health. A failed transactional restore leaves the pre-restore database intact. Do not use the non-interactive `--yes` option outside disposable automated tests.

## 6. Upgrade and roll back

Before upgrading:

1. Create an application backup.
2. Verify a recent Proxmox backup.
3. Record the current Git/container release tag.
4. Deploy the new pinned tag.
5. Verify health, source import, artifact generation, and one player playback.

If verification fails, use the application-only rollback only when the prior release is explicitly compatible with the migrated schema. Otherwise check out the prior release and restore the pre-upgrade database backup. SQL migrations are forward-only. Follow [RELEASES.md](./RELEASES.md), and run its restore command from the prior checkout so newer migrations are not reapplied.
