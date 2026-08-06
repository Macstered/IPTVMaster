# Security audit — August 2026

Pre-open-source audit of the application code (`apps/`, `packages/`) and
deployment scaffolding (`compose.yaml`, `Dockerfile`, `deploy/`, `scripts/`).
Reconnaissance mapped the attack surface, then five specialists audited
clustered vulnerability classes against it.

Threat models used, in order of realism:

1. **A compromised or malicious provider.** Its feed reaches the parser, the
   database, the published output, and the administrator's browser, and it is
   fetched on a schedule with no human present. Needs no credentials.
2. **An unauthenticated attacker on the same LAN.**
3. **Someone holding a leaked output token.**
4. The administrator crossing internal boundaries (lowest value: single-admin
   application).

## Findings and status

| Sev    | Class                    | Issue                                                                                                                                                  | Status                                                                                                                                          |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| High   | ReDoS                    | M3U attribute regex backtracked quadratically; one crafted line blocked the event loop (160 KB = 17.9 s measured, 1 MB ≈ 11 min) on every refresh      | Fixed — anchored pattern, now ~1 ms for 1 MB, plus a 16 KB line cap                                                                             |
| High   | SSRF                     | Feed URLs fetched with only a scheme check and `redirect: follow`, so a feed could redirect the server into the operator's network                     | Fixed — undici connector rejects private/loopback/link-local/reserved addresses per hop, opt-in via `IPTVMASTER_ALLOW_PRIVATE_SOURCE_ADDRESSES` |
| Medium | Information disclosure   | No error handler, so Fastify returned raw `error.message` (including PostgreSQL auth failures and decryption errors) to unauthenticated callers        | Fixed — client errors keep their message, server errors log and return a generic 500                                                            |
| Medium | Race condition           | Login throttle counted failures _after_ the slow scrypt verification, so a concurrent burst bypassed the limit and monopolized the thread pool         | Fixed — the attempt is counted before verification and released on success                                                                      |
| Medium | CSRF                     | `developmentMode` defaulted on whenever `NODE_ENV` was unset, relaxing CORS and the origin check; a missing `Origin` header was treated as same-origin | Fixed — development mode requires `NODE_ENV=development`, origins compare normalized, absent `Origin` is rejected                               |
| Medium | Crypto                   | `decodeKey` accepted non-canonical base64, so a 43-character passphrase passed validation as a "32-byte key"; GCM tag length unchecked                 | Fixed — canonical base64 round-trip required, tag and IV lengths enforced                                                                       |
| Medium | Request forgery (client) | Provider-supplied logo URLs were rendered as `<img src>`, so a feed could make the administrator's browser request arbitrary LAN addresses             | Fixed — only public HTTP(S) hosts render, others fall back to the letter tile                                                                   |
| Low    | Deployment               | `.env.example` shipped a working `POSTGRES_PASSWORD=change-me`                                                                                         | Fixed — ships empty, compose refuses to start without a value                                                                                   |
| Low    | Robustness               | Draft state maps keyed by provider group names inherited `Object.prototype`, so a group named `constructor` crashed the editor                         | Fixed — null-prototype maps                                                                                                                     |
| Low    | Information disclosure   | `/health` exposes version and revision; `/ready` and `/api/v1/auth/status` expose `administratorSetupRequired`                                         | Accepted — the UI needs setup state, and the deployment is LAN-only. Revisit if ever exposed publicly                                           |
| Low    | Availability             | No rate limiting on the tokenized output endpoints; each request assembles a full playlist                                                             | Open — acceptable on a LAN, worth adding before any wider exposure                                                                              |
| Low    | Shell quoting            | `scripts/deploy-remote.sh` interpolates a `git describe` tag into a remote command                                                                     | Open — only affects someone deploying a fork with a hostile tag                                                                                 |

### Verified as not vulnerable

Traced and confirmed clean, not assumed:

- **SQL injection.** Every dynamic fragment is a hardcoded column name or a
  `$N` placeholder index; all values bind as parameters.
- **XXE and entity expansion.** `saxes` performs no I/O, ignores DTD entity
  declarations, and resolves only the five predefined XML entities.
- **Access control.** Every mutation scopes by owner; the auth hook cannot be
  bypassed with encoded or absolute-form paths (probed over raw sockets).
- **Mass assignment.** Updates are built from an explicit column allowlist; no
  request body is spread into SQL.
- **Prototype pollution.** Feed attribute maps cannot pollute (`__proto__`
  assignment with a string value is a no-op), and reads use spread.
- **XSS.** No `dangerouslySetInnerHTML` or equivalent; XMLTV output escapes.
- **Header injection, open redirect, path traversal, file uploads, RCE.** No
  reachable sink exists.
- **Output tokens in logs.** Verified redacted (`"url":"[redacted]"`).
- **Secrets at rest.** AES-256-GCM with a fresh 12-byte nonce per encryption
  and verified auth tags; no credential reaches logs, responses, or the stored
  `safe_error` column.

## Notes for future work

- The login throttle and refresh coordination are per-process, so running more
  than one application container would weaken both. The current deployment is
  a single container.
- `searchEpgChannels` intentionally ignores its `sourceId` argument because the
  guide pool is shared. Revisit if per-provider isolation is ever required.
- A regression from this audit is worth remembering: an initial fix restricted
  outbound ports, which broke a real provider on port 2095. IPTV providers
  commonly use non-standard ports, and address filtering — not port
  filtering — is what prevents reaching internal services.
