# Serving IPTVMaster over HTTPS

Over plain HTTP, everything that matters travels in the clear on your network:
the administrator password at sign-in, the session cookie on every request,
provider URLs — which contain your subscription credentials — while you manage
a source, and the output URLs, which are bearer tokens that grant the full
playlist to anyone holding them. Anyone able to observe the network, including
a compromised device on the same Wi-Fi, can collect all of it.

The application warns on its overview page when it is reached over plain HTTP.

## What the overlay does

`compose.https.yaml` adds a Caddy reverse proxy and stops publishing the
application port. Caddy becomes the only thing listening on the host, HTTP is
redirected to HTTPS, HSTS is sent, and the application is told it sits behind
TLS so its session cookies are marked `Secure`.

```sh
docker compose -f compose.yaml -f compose.https.yaml up -d
```

Set two values in `.env` first:

```sh
IPTVMASTER_HOSTNAME=iptv.home.arpa
IPTVMASTER_TLS=internal
```

`IPTVMASTER_HTTP_PORT` and `IPTVMASTER_HTTPS_PORT` exist for hosts where 80
and 443 are taken. If you change them, browse to the HTTPS port directly: the
automatic redirect from HTTP points at the standard port, because the proxy
cannot know how the ports were remapped outside its container.

## Choosing a certificate

**A local certificate authority (`IPTVMASTER_TLS=internal`)** suits a home
network with no public DNS. Caddy issues its own certificate and acts as the
CA. Every device that opens the editor must trust Caddy's root once, otherwise
browsers show a warning:

```sh
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./root.crt
```

Install `root.crt` as a trusted root on each computer or phone you administer
from. Players fetching output URLs generally do not need it, since they are
usually given the address by IP or over plain HTTP on the LAN — but if a
player refuses the certificate, install the root there too.

**A real hostname with a publicly trusted certificate** is the smoothest
option if you own a domain. Point a DNS name at the machine and set
`IPTVMASTER_TLS=you@example.com`; Caddy obtains and renews a certificate
automatically. This needs the ACME challenge to reach the host, which usually
means either brief inbound access on port 80 or a DNS challenge — do not leave
IPTVMaster itself exposed to the internet afterwards.

**A certificate you already have** works too. Mount it into the Caddy service
and set `IPTVMASTER_TLS=/etc/caddy/cert.pem /etc/caddy/key.pem`.

**A private network such as Tailscale** avoids certificate management
entirely: `tailscale cert` issues a trusted certificate for your tailnet name,
and the machine is reachable only to your own devices. Mount that certificate
as above, or run `tailscale serve` in front of the plain-HTTP container and
skip this overlay.

## After switching

- Open the editor at `https://<hostname>` and confirm the plain-HTTP warning
  is gone.
- Sign in again. The old session cookie was issued without the `Secure` flag,
  so a fresh sign-in replaces it.
- Recreate your output URLs and update your players. The addresses embed the
  origin you used when creating them, so URLs made over HTTP still say `http`
  and will keep working — replace them, then revoke the old ones.
- Verify HSTS is present: `curl -sI https://<hostname> | grep -i strict`.
- Keep the service off the public internet regardless. TLS protects the
  connection; it is not an argument for exposing the application.

## Reverting

Bring the stack up from the base file alone and the application publishes its
port again:

```sh
docker compose -f compose.yaml up -d --remove-orphans
```
