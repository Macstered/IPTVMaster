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

Create `/opt/iptvmaster`, check out a pinned release tag, and copy `.env.example` to `.env`. Replace the database password with a long random value, generate `IPTVMASTER_MASTER_KEY` using `openssl rand -base64 32`, and restrict the file to the administrator/root account. Back up the master key securely and separately; losing it makes stored provider credentials unrecoverable.

The default playlist refresh interval is 120 minutes and the XMLTV interval is 720 minutes. Keep those provider-friendly defaults initially; change them only after observing how often the provider's daily event groups and guide actually change.

```sh
cd /opt/iptvmaster
docker compose build
docker compose up -d
docker compose ps
```

The app is initially published on TCP port 8080. Restrict it to trusted LAN clients using the Proxmox firewall, guest firewall, or both. Do not forward the port on the internet router.

Prefer a DHCP reservation and a `home.arpa` DNS name. A stable IP address can be used directly in TiviMate if local DNS is unavailable.

## 4. Verify

- `http://VM_ADDRESS:8080/health` reports healthy.
- The browser UI loads from a trusted LAN computer.
- The container and VM recover after separate reboots.
- The provider secret does not appear in container logs.
- A generated M3U URL loads from another trusted LAN device and stops loading after revocation.
- The paired XMLTV URL loads in TiviMate, contains guide programmes, and is also blocked by the same revocation.
- A test playlist refresh does not relay playback through the VM.

When creating a TiviMate URL, open the setup UI using the VM's stable LAN hostname or address, not `localhost`. The generated address uses the browser origin and must be reachable from the Nvidia Shield.

## 5. Back up

Use two backup layers:

1. Daily application-level PostgreSQL backups with tested restore instructions.
2. Regular Proxmox VM backups to storage outside the VM disk.

Do not assume a VM snapshot on the same physical disk is a sufficient backup. Test at least one restore before making IPTVMaster the primary TiviMate source.

## 6. Upgrade and roll back

Before upgrading:

1. Create an application backup.
2. Verify a recent Proxmox backup.
3. Record the current Git/container release tag.
4. Deploy the new pinned tag.
5. Verify health, source import, artifact generation, and one TiviMate playback.

If verification fails, restore the prior image tag. Restore the database only if a migration cannot be rolled back safely.
