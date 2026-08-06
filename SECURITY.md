# Security policy

## Subscription credentials

Provider URLs commonly contain usernames and passwords in query strings and stream paths. Treat the complete URL as a secret.

- Never commit provider URLs, playlists, XMLTV files, database dumps, or application logs.
- Never place production provider credentials in GitHub Actions.
- Use synthetic fixtures for tests.
- Redact query strings and stream paths before logging errors.
- Rotate a provider credential if it is accidentally committed or shared publicly.

Database backups contain encrypted provider URLs and should be stored with restrictive permissions. Keep `IPTVMASTER_MASTER_KEY` in a separate secure backup: it is deliberately absent from database archives, and losing it makes restored provider secrets unreadable. Never upload an application backup to GitHub or attach it to an issue.

## Deployment

IPTVMaster is intended for trusted-LAN access only. Do not expose the application, database, or generated playlist endpoints directly to the public internet.

Plain HTTP exposes the administrator password, the session cookie, provider URLs, and the output tokens to anyone observing the network. The application warns when it is reached that way, and `docs/HTTPS.md` describes an optional reverse-proxy overlay that terminates TLS, redirects HTTP, and marks session cookies `Secure`.

The editor API requires the single local administrator session after first-run setup. Passwords are hashed with scrypt and a random salt. Session and CSRF tokens are stored only as SHA-256 hashes; the browser session cookie is `HttpOnly` and both cookies use `SameSite=Strict`. Enable `IPTVMASTER_SECURE_COOKIES=true` only when the browser always reaches the app through HTTPS. State-changing editor requests also require a same-origin CSRF header, and repeated failed logins are throttled.

Authentication is an additional layer, not permission to expose the service publicly. Playlist and EPG output endpoints deliberately do not use the browser session; their long random output token remains the access control and can be revoked independently.

The application must not be used to relay or redistribute streams. Playback should go directly from the authorized player to the configured provider.

## Feed handling

Provider playlists and XMLTV guides are untrusted input. A compromised or
malicious provider is treated as an attacker in this project's threat model,
because its feed reaches the parser, the database, the published output, and
the administrator's browser.

Outbound feed requests are followed hop by hop by the application rather than
by the HTTP client, and the destination is validated before every hop. This
matters because an HTTP client resolves a redirect target itself, and a hop to
a bare address literal performs no DNS lookup, so a connector-level guard alone
would not see it. Addresses are classified with a real IP parser, so
IPv4-mapped IPv6 forms such as `::ffff:7f00:1` and the whole `fe80::/10`
link-local range are refused like their obvious equivalents.

Only public unicast destinations are allowed by default. If you host a playlist
or XMLTV generator on your own network, name its network in
`IPTVMASTER_ALLOWED_SOURCE_CIDRS` (for example `192.168.1.0/24`). Loopback,
link-local — which carries the cloud metadata address — multicast, and reserved
ranges are refused even when a CIDR list is configured, because nothing
legitimate serves a feed from them.

Channel logos are served from this application rather than linked directly.
The browser sends only a channel identifier; the server looks up the stored
address, downloads it under the same address policy with a short timeout and a
size ceiling, and accepts a response only if its leading bytes are a real
raster image. SVG is refused because it can carry script, and the content
security policy consequently limits images to this origin. A feed therefore
cannot use a logo address to make the administrator's browser reach an
arbitrary host, and a channel with an unusable logo falls back to a letter
tile. Downloads are size- and
time-bounded, parsing is linear in input size, and channel logo URLs supplied
by a feed are only rendered when they point at public hosts.

## Reporting a vulnerability

Do not include credentials or playable URLs in a report. Open a private security advisory through the repository's Security tab rather than a public issue, and expect an initial response within a few days. This is a hobby project maintained in spare time: there is no paid support and no guaranteed patch window, but security reports are prioritized over features.
