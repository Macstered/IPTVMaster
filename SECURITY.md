# Security policy

## Subscription credentials

Provider URLs commonly contain usernames and passwords in query strings and stream paths. Treat the complete URL as a secret.

- Never commit provider URLs, playlists, XMLTV files, database dumps, or application logs.
- Never place production provider credentials in GitHub Actions.
- Use synthetic fixtures for tests.
- Redact query strings and stream paths before logging errors.
- Rotate a provider credential if it is accidentally committed or shared publicly.

## Deployment

IPTVMaster is intended for trusted-LAN access only. Do not expose the application, database, or generated playlist endpoints directly to the public internet.

The application must not be used to relay or redistribute streams. Playback should go directly from the authorized player to the configured provider.

## Reporting a vulnerability

Do not include credentials or playable URLs in a report. In a private personal repository, open a private security advisory or contact the repository owner directly.
