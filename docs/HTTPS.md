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

## Keeping players working during the switch

Output URLs are served by the same application, so once the overlay is in
place they move from `http://<address>:8080/m/<token>` to
`https://<hostname>/m/<token>`. Many IPTV players refuse a privately issued
certificate, and some ignore custom DNS, so a player can stop working the
moment the plain port disappears.

To avoid that, set `IPTVMASTER_PLAIN_OUTPUT_PATHS` while migrating:

```sh
IPTVMASTER_PLAIN_OUTPUT_PATHS=/m/* /e/* /p/*
```

The editor, its session cookie, and the whole API then remain HTTPS-only,
while the tokenized playlist and guide continue to answer over plain HTTP on
port 80 at whatever address the player already uses. Those URLs are bearer
tokens, so this is a trusted-network trade-off, not a permanent posture: once
the player is happy with HTTPS, remove the setting and everything is
redirected.

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
- Recreate your output URLs and update your players, then revoke the old
  ones. Addresses embed the origin used when creating them, so a URL created
  over HTTP still says `http`. If a player cannot use HTTPS, keep
  `IPTVMASTER_PLAIN_OUTPUT_PATHS` set rather than reverting the whole
  deployment.
- Verify HSTS is present: `curl -sI https://<hostname> | grep -i strict`.
- Keep the service off the public internet regardless. TLS protects the
  connection; it is not an argument for exposing the application.

## Reverting

Bring the stack up from the base file alone and the application publishes its
port again:

```sh
docker compose -f compose.yaml up -d --remove-orphans
```
