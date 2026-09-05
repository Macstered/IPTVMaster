# Proxmox installation runbook

This is the target production procedure once a tagged IPTVMaster release is available. Do not use real provider credentials until the application setup flow and secret storage are complete.

## 1. Create the guest

Create a minimal Debian guest with:

- 2 vCPU
- 4 GB RAM
- 32 GB disk on SSD-backed storage. The database is latency-bound; a guest disk on a spinning drive makes every refresh and page slow (see docs/CONTAINER_INSTALL.md, Storage and PostgreSQL tuning)
- A DHCP reservation or stable address on the trusted LAN

Either guest type works, and the rest of this runbook applies to both.

A **VM** is the simpler choice: Docker is supported without qualification, and the guest is isolated by its own kernel. Use VirtIO disk and network devices and enable the QEMU guest agent.

An **LXC container** is lighter and starts faster, at the cost of sharing the host kernel, so it isolates the workload less than a VM does. Docker inside LXC needs `nesting=1` on the container, and `keyctl=1` as well if the container is unprivileged. Both are set in the container's options on the Proxmox host, not inside the guest.

To confirm which one you are on, run `systemd-detect-virt` inside the guest: a VM reports `kvm` or `qemu`, a container reports `lxc`.

## 2. Prepare Debian

1. Install security updates.
2. Set the system timezone to `Europe/Helsinki`; application data remains UTC.
3. On a VM, install and enable the QEMU guest agent. An LXC container does not use it.
4. Create a non-root administrator and install an SSH public key.
5. Disable password-based remote root login.
6. Install Docker Engine and the Compose plugin from Docker's official Debian repository.

Use the currently supported official Debian and Docker instructions during deployment rather than copying unversioned installation scripts into this repository.

## 3. Deploy

Create `/opt/iptvmaster`, check out a pinned release tag, and copy `.env.example` to `.env`. Replace the database password with a long random value, generate `IPTVMASTER_MASTER_KEY` using `openssl rand -base64 32`, and restrict the file to the administrator/root account. Back up the master key securely and separately; losing it makes stored provider credentials unrecoverable. Set `IPTVMASTER_IMAGE` to the matching numbered GHCR image, or build that checked-out tag locally with the same numbered image tag. Never deploy `latest`.

The default playlist refresh interval is 120 minutes and the XMLTV interval is 720 minutes. Keep those provider-friendly defaults initially; change them only after observing how often the provider's daily event groups and guide actually change. Transient downloads use at most three attempts with short bounded backoff; `401`, `403`, `404`, malformed responses, and unsafe snapshots are not retried. Daily maintenance removes expired browser sessions without deleting retained playlist rollback history.

```sh
cd /opt/iptvmaster
docker compose pull app postgres
docker compose up -d --no-build --remove-orphans
docker compose ps --all
```

The application image includes every SQL migration. It waits for PostgreSQL, takes a database migration lock, verifies applied checksums, and applies any missing migrations before opening port 8080. A clean installation therefore cannot serve the setup UI against an incomplete schema. `--remove-orphans` also removes the obsolete one-shot `migrate` container from releases older than 0.2.1. See [RELEASES.md](./RELEASES.md) for pinned images and rollback.

The app is initially published on TCP port 8080. Restrict it to trusted LAN clients using the Proxmox firewall, guest firewall, or both. Do not forward the port on the internet router.

On the first browser visit, create the single local administrator account. Store that password in the same private password manager used for the guest's administration credentials. Sessions last seven days by default; adjust `IPTVMASTER_SESSION_HOURS` if needed. Leave `IPTVMASTER_SECURE_COOKIES=false` for direct LAN HTTP. Set it to `true` only after an HTTPS reverse proxy is in place and HTTP access is no longer used.

Prefer a DHCP reservation and a `home.arpa` DNS name. A stable IP address can be used directly in the player if local DNS is unavailable.

## 4. Verify

- `http://VM_ADDRESS:8080/health` reports healthy.
- The health response reports the expected pinned version and Git revision.
- `http://GUEST_ADDRESS:8080/ready` reports ready and shows whether first-run administrator setup is still required.
- The browser UI loads from a trusted LAN computer.
- Unauthenticated editor API requests return `401`, while a signed-in administrator can complete the workflow.
- The Docker containers and the guest itself recover after separate reboots.
- The provider secret does not appear in container logs.
- A generated M3U URL loads from another trusted LAN device and stops loading after revocation.
- The paired XMLTV URL loads in an IPTV player, contains guide programmes, and is also blocked by the same revocation.
- A test playlist refresh does not relay playback through the guest.

When creating output URLs, open the setup UI using the guest's stable LAN hostname or address, not `localhost`. The generated address uses the browser origin and must be reachable from your playback devices.

## 5. Back up

Use two backup layers:

1. Daily application-level PostgreSQL backups with tested restore instructions.
2. Regular Proxmox backups of the guest, to storage outside the guest's own disk. `vzdump` covers both VMs and LXC containers.

Do not assume a snapshot on the same physical disk is a sufficient backup. Test at least one restore before making IPTVMaster the primary playlist source.

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

The supplied unit assumes the checkout is `/opt/iptvmaster`, writes to `/var/backups/iptvmaster`, runs at about 03:30 local time with a randomized delay, and keeps 14 days. Use `systemctl edit iptvmaster-backup.service` to override the directory or retention. Copy completed archives and their `.sha256` files to storage outside the guest's disk.

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
