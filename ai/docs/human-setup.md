# One-action-at-a-time setup record

The assistant should request one action, explain its purpose briefly, and wait for redacted direct evidence before advancing. Never ask for a password, token, private key, recovery code or full environment dump.

| Area | State | Evidence needed before advancing |
| --- | --- | --- |
| Public repo structure and current deployment | Verified | Base commit and existing successful deployment run recorded |
| Dedicated implementation branch and draft PR | Created | PR #6 and exact commit evidence |
| Gateway, browser and fixture-based tests | Passing baseline | CI run linked in verification report |
| Mac hardware, local services and network resources | Next human action | Read-only discovery output from the actual Mac mini |
| Container model download and benchmark | Blocked | Hardware budget and owner approval |
| Native Metal alternative | Not approved | Failed container targets, comparison evidence and explicit approval |
| Current authoritative DNS and email records | Blocked | Provider export and reviewed record inventory |
| Cloudflare plan, Tunnel and Turnstile | Blocked | Provider access/secure setup and redacted status evidence |
| Secrets and local runtime configuration | Blocked | Secure local entry and non-secret validation output |
| Real local-model quality and performance | Pending | Actual benchmark/evaluation reports, not fixtures |
| External security and end-to-end browser tests | Pending | Direct HTTP/browser and local-runtime evidence |
| Public widget activation | Not performed | Explicit activation approval, tested artifact and rollback path |
| Reboot/power/monitoring configuration | Pending | Owner approval and observed recovery test |

## Current next action

Run the read-only Mac discovery script on the Mac mini intended to host the service. It reports hardware, macOS, disk availability, Docker/Ollama status, selected listening ports, candidate network ranges and existing sleep settings. It does not install anything, stop containers, change settings or read credential files.

Review the output before sharing it. Redact any unexpected private identifiers, service names, keys or tokens. A screenshot is acceptable when readable, but copied non-secret terminal output is more useful for exact version and resource checks.

The next action after discovery is selected from the evidence. Do not ask the owner to create accounts, migrate DNS, download a model and change power settings in one batch.
