# Docker, Podman, and custom Compose installation

The supported installation is the repository's `compose.yaml` from the same
tag as the application image. It starts PostgreSQL and the public, prebuilt
IPTVMaster image. No Node.js toolchain or local image build is required.

## Docker Compose

```sh
git clone --branch v0.2.1 --depth 1 https://github.com/Macstered/IPTVMaster.git
cd IPTVMaster
cp .env.example .env
openssl rand -hex 32
openssl rand -base64 32
```

Put the first value in `POSTGRES_PASSWORD` and the second in
`IPTVMASTER_MASTER_KEY`, then start the stack:

```sh
docker compose pull
docker compose up -d --remove-orphans
docker compose ps
docker compose logs --tail=50 app
```

Open `http://HOST_ADDRESS:8080`. Keep `.env`, especially the master key, in a
separate backup.

## Rootless Podman

The same two-service file works with rootless Podman. Port 8080 is above the
privileged-port range, the database uses a named volume, and the application
image has no host-mounted migration files.

```sh
podman compose pull
podman compose up -d
podman compose ps
podman compose logs app
```

The app may start before PostgreSQL is ready on Compose providers that ignore
dependency conditions. This is safe: IPTVMaster retries the connection and
does not open port 8080 until every bundled migration has been verified. A
successful log contains `PostgreSQL schema verified before application
startup`.

Do not use `down -v` during an update: `-v` deletes the PostgreSQL volume.

## Custom stack or external PostgreSQL

The application is stateless outside PostgreSQL. A custom app-only service
must provide both of these variables:

```yaml
services:
  iptvmaster:
    image: ghcr.io/macstered/iptvmaster:0.2.1
    restart: unless-stopped
    environment:
      DATABASE_URL: ${DATABASE_URL:?Set an external PostgreSQL URL}
      IPTVMASTER_MASTER_KEY: ${IPTVMASTER_MASTER_KEY:?Set the master key}
      IPTVMASTER_SECURE_COOKIES: 'true'
      IPTVMASTER_BEHIND_TLS_PROXY: 'true'
```

The database must already exist, run PostgreSQL 17, and the configured role
must be allowed to create and alter objects in it. Percent-encode reserved
characters in the URL password. The image applies its schema automatically.

There is no SQLite database and `/app/data` is unused, so mounting that path
does not persist anything. With Traefik or another HTTPS proxy, keep the app on
the proxy's internal network, forward to port 8080, and set both TLS variables
shown above. Proxy authentication can be added, but it does not replace
IPTVMaster's own administrator account.

## Diagnosing startup

If the setup screen cannot connect, inspect only the application and database:

```sh
docker compose ps --all
docker compose logs --no-color --tail=100 app postgres
```

There is intentionally no separate `migrate` container from version 0.2.1
onward. A migration error keeps the web port closed instead of exposing a GUI
backed by missing tables.
