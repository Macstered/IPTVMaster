# Running on a Synology NAS

IPTVMaster runs on Synology DSM through **Container Manager**, which is
Synology's packaging of Docker. There is no separate install to build: the
published images and the project's own `compose.yaml` are what you use.

## Will your model work

Container Manager needs DSM 7.2 or newer, and it is only offered on x86_64
models and the newer ARM64 ones (roughly DS223/DS423 and later). Older ARM
models and pre-2022 J-series never receive it, and no version of IPTVMaster
changes that — the limitation is in DSM.

Images are published for `linux/amd64` and `linux/arm64`, so both supported
CPU families are covered. If Package Center has no Container Manager entry,
your model cannot run this.

## Install

1. Install **Container Manager** from Package Center.
2. In File Station, create a folder for the project, for example
   `/docker/iptvmaster`.
3. Put a `compose.yaml` there. Start from the one in this repository and
   replace the `app` service's `build:` block with the published image:

   ```yaml
   app:
     image: ghcr.io/macstered/iptvmaster:0.2.0
   ```

   The image is public, so Container Manager pulls it without any registry
   sign-in. Pin a real version rather than tracking a moving tag, so an
   upgrade is something you choose — no `latest` is published. Available
   versions are listed on the repository's Packages page.

4. Create a `.env` beside it, following `.env.example`. Two values have no
   defaults and must be set:

   ```sh
   POSTGRES_PASSWORD=<a long random string>
   IPTVMASTER_MASTER_KEY=<openssl rand -base64 32>
   ```

   `IPTVMASTER_PORT` decides the port DSM publishes; pick one that does not
   collide with DSM's own services (5000, 5001, and anything already taken by
   another container).

5. In Container Manager, choose **Project → Create**, point it at the folder,
   and let it start the stack.

Open `http://<nas-address>:<port>` and create the administrator account.

## Notes specific to DSM

**Keep the master key.** Losing `IPTVMASTER_MASTER_KEY` makes stored provider
credentials unrecoverable. It lives in a file on the NAS, so it is only as
safe as your backup of that folder. Back it up somewhere else as well, and
exclude the folder from anything you share.

**The database is a volume, not a share.** The compose stack keeps PostgreSQL
data in a Docker volume managed by Container Manager. Synology's own backup
tools do not see inside it. Use the project's backup script, or dump the
database on a schedule, rather than assuming Hyper Backup covers it.

**Keep it off the internet.** The default deployment is plain HTTP with no
certificate, which is fine on a home LAN. Do not forward a port to it, and do
not expose it through QuickConnect or DSM's reverse proxy without reading
[SECURITY.md](../SECURITY.md) and [HTTPS.md](./HTTPS.md) first.

**Updating.** Change the pinned image version in `compose.yaml`, then use
Container Manager's project **Build** action. Schema migrations run
automatically on start; they are forward-only, so take a database backup
before a version jump.

## A native Package Center package

There is no SynoCommunity `.spk` for IPTVMaster, and none is planned right
now. Container Manager covers every model that could run one, and a native
package would add a second distribution channel to maintain for the same
result.
