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

The editor API requires the single local administrator session after first-run setup. Passwords are hashed with scrypt and a random salt. Session and CSRF tokens are stored only as SHA-256 hashes; the browser session cookie is `HttpOnly` and both cookies use `SameSite=Strict`. Enable `IPTVMASTER_SECURE_COOKIES=true` only when the browser always reaches the app through HTTPS. State-changing editor requests also require a same-origin CSRF header, and repeated failed logins are throttled.

Authentication is an additional layer, not permission to expose the service publicly. Playlist and EPG output endpoints deliberately do not use the browser session; their long random output token remains the access control and can be revoked independently.

The application must not be used to relay or redistribute streams. Playback should go directly from the authorized player to the configured provider.

## Reporting a vulnerability

Do not include credentials or playable URLs in a report. In a private personal repository, open a private security advisory or contact the repository owner directly.
