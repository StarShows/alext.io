# Verification record

## Status

Implemented application release candidate. **Not deployed and not production-verified.** No claim is made that a visitor can currently use this assistant on the live website.

## Observed repository evidence

- Existing website base: `18ee50adfa63008b9727d39842cf5a674d1924ea`.
- Existing Namecheap production run: `38328359388`, successful before this implementation. It deployed the original website, not the assistant.
- Implementation branch: `feat/local-ai-assistant`.
- Draft pull request: https://github.com/StarShows/alext.io/pull/6
- Passing application/browser baseline run: https://github.com/StarShows/alext.io/actions/runs/38335209357
- Source checked out for that run: `69e43c3f13dcccea8a34965347cf824e6a65c995`.
- That run applied explicit source corrections and formatting before testing. Its tested normalized files and dependency lock were then committed as `45d872703dd4d393f3db0008079a1287fe2c8731`.
- A final read-only CI run against the eventual exact head is required after the operational configuration changes. Record its SHA and run in the PR completion comment rather than presenting the earlier baseline as a test of later changes.

## What the passing baseline actually tested

TypeScript strict compilation; schema validation; exact CORS/Origin and connector-peer enforcement; Turnstile verifier behavior against controlled HTTP responses; bearer/session expiry/binding and quotas; bounded retrieval/history; evidence reconstruction and disallowed output; JSON and SSE endpoints; real HTTP socket cancellation and model-adapter protocol behavior; website byte-preserving integration; desktop Chromium and mobile WebKit rendering; restricted Markdown safety; offline recovery; native dialog focus and automated WCAG-tagged axe checks. Dependency audit reported no vulnerabilities at that run's time.

The model responses and browser-side Turnstile/API responses in these tests are fixtures. Actual HTTP sockets were used for transport tests, but no real Ollama model was running on the Mac. Browser tests served the real homepage plus widget with controlled external requests. They do not prove that every existing external analytics/asset integration remains functional in production.

## Unverified deployment requirements

| Requirement | Status |
| --- | --- |
| Mac model/chip/RAM/OS and available resources | Not inspected |
| Docker/Metal performance comparison | Not run |
| Real local Ollama response and 56-case answer quality | Not run |
| Production Turnstile account/site key/secret | Not configured |
| Cloudflare account, authoritative DNS and complete mail records | Not inspected |
| Tunnel credentials and public route | Not configured |
| Container networking and secret permissions on Mac | Not verified |
| No public model/admin/router exposure | Intended by configuration, not externally verified |
| Production stream/cancellation/quotas from a real browser | Not verified |
| Current resume download and booking link | Deliberately disabled |
| Google Tag Manager form/session-replay privacy audit | Pending |
| Namecheap assistant activation | Not performed |
| Mac reboot, login, power and outage recovery | Not tested |
| Persistent monitoring/alert delivery | Not installed |

## Definition-of-done gate

Do not merge for production activation or declare completion until real local inference, network isolation, human verification, scoped grounded answers, sustained streaming, host responsiveness, existing-site regression checks, secret/privacy review and restart recovery have direct evidence. A health response, dashboard screenshot, successful build or fixture suite alone does not satisfy the definition of done.
