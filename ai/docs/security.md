# Security threat model

## Assets and boundaries

Protect Mac availability, the home network, credentials, professional credibility, visitor privacy and the existing website. The browser, arbitrary HTTP clients, prompts, model output and retrieved text are untrusted. Only reviewed public portfolio facts and operator configuration are trusted inputs. The public repository intentionally contains prompts and curated knowledge; these are not secrets. The API does not provide a prompt-dump or raw-file endpoint.

The edge terminates HTTPS, an authenticated tunnel reaches only the gateway, the gateway calls fixed local Ollama routes, and Ollama has no model tools or network-fetch capability. The standard inference container has no external network, no published port, no Docker socket, no home-directory mount and a read-only model volume. Maintenance model downloads use a separate explicit profile and are not part of normal serving.

## Controls and limits

| Threat                       | Implemented controls                                                                                                  | Remaining validation or risk                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Raw model/API exposure       | No Compose ports; isolated inference network; exact tunnel hostname/path rules; gateway route allowlist               | External scan and actual Mac firewall/router checks still required                                                |
| Forged client IP             | Exact connector socket peer; strict `CF-Connecting-IP` parsing; host check; framework proxy trust disabled            | Verify tunnel source address on the Mac; no unreviewed Worker or proxy routes                                     |
| Automated abuse              | Mandatory server-side Turnstile; session entropy; per-IP/session/global budgets; queue and concurrency limits         | Bot farms/shared NAT/edge plan limits; memory state resets on restart                                             |
| Prompt injection             | Hard policy checks, contextual classifier, bounded retrieval, strict output schema and evidence-ID reconstruction     | Classifier and hypothetical advice remain probabilistic; real-model adversarial evaluation required               |
| Fabricated resume claims     | Only server-authored facts become evidence; unknown achievements abstain; advice labeled hypothetical                 | Human curation and source freshness are still required                                                            |
| XSS                          | DOM text nodes; raw HTML disabled; no image rendering; narrow Markdown; citation URL allowlist                        | Existing site scripts and Tag Manager are outside the widget's security boundary                                  |
| CSRF/token theft             | No cookies; memory-only bearer; exact Origin; custom Authorization header; short TTL                                  | Any same-origin compromised script could read the open page's state; a Shadow DOM is not a security sandbox       |
| SSRF/local-network discovery | No user-supplied upstream URLs; fixed HTTP endpoints; redirects rejected; no model tools                              | Gateway/connector need outbound networking. A full container RCE is not claimed to be contained by URL validation |
| Resource exhaustion          | Body/context/output limits, one model slot, bounded queue/cache/history, HTTP/deadline limits and abort propagation   | Real Mac memory/CPU budgets, slow clients and distributed edge attacks need measured validation                   |
| Secret disclosure            | File-based secrets, no browser secret, safe fixed error messages, no request/body/header logging                      | Host/root/Docker administrators can access secrets; provider and OS retention must be reviewed                    |
| Supply chain                 | Exact npm dependencies and committed integrity lockfile, pinned Actions, digest-gated production images, read-only CI | Registries and upstream maintainers remain trust dependencies; audit and update deliberately                      |
| Unsafe deployment            | Dedicated branch, draft PR, preserved existing workflow, exact revision evidence and approval-gated operator scripts  | Main protections/environment approvals must be verified before activation; no untrusted self-hosted PR runner     |

## Secrets

Use the local ignored `secrets/` directory with parent permissions 0700. Docker Compose file-backed secrets may not honor requested ownership/mode remapping. Verify readability inside each non-root container instead of assuming it. When file binds need mode 0444, retain a 0700 parent directory so other host users cannot traverse it. Only the service that needs a secret receives its mount. Never mount an account-wide Cloudflare certificate into the connector; use that tunnel's limited credential JSON.

Turnstile rotation: create the replacement using Cloudflare's secure interface, update the local secret file, restart only the gateway, verify challenge validation, then revoke the old secret according to the provider's rotation process. All sessions should be invalidated during an abuse-related rotation. Tunnel compromise: disable the connector/route first, revoke the affected tunnel credential, create a replacement through the provider UI, validate the limited ingress configuration and re-enable only after approval. GitHub deployment credentials stay in GitHub/Namecheap's existing workflow and are not sent to the Mac model.

## Logging and privacy

The application does not persist prompts or replies. Context resides in memory for a fixed session lifetime and is purged on expiry within the normal 15-second sweep interval. A stalled process or OS swap can extend physical data remnants; no cryptographic secure-erasure guarantee is made. Disable core dumps where supported, keep FileVault enabled, and review the host's backup/swap policy.

Logs contain server-generated request IDs, status codes and fixed event names, not IPs, headers or prompt content. Detailed diagnostics are loopback-only. Docker logs have size/rotation limits. Review actual Ollama and cloudflared logs before launch; never enable verbose/debug logging in production without a scoped incident plan. Cloudflare may retain separate network/security telemetry under account settings. Existing Google Tag Manager must be inspected for form capture/session replay before launch. The widget does not emit analytics events or send visitor contact details anywhere automatically.

## Output streaming tradeoff

Validated blocks can be emitted before the final enclosing model JSON is complete. A later malformed tail terminates with an error and no history update. This does not invalidate the approved text of earlier evidence blocks, but the browser marks the overall answer incomplete. Raw tokens, hidden chain-of-thought, model metadata and unapproved links are never intentionally forwarded.

## Release acceptance

Run the deterministic security tests and the real-model adversarial dataset. Then verify from an external connection that `/api/tags`, `/api/chat`, `/metrics`, `/.env`, arbitrary methods and malformed paths are unavailable, invalid human tokens fail, quotas work, streams stop upstream on disconnect, and local model/admin ports are not internet reachable. A passing mock suite is not evidence that any of these deployed network properties are already true.
