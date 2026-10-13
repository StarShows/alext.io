# alext.io local AI engineering assistant

An isolated TypeScript/Fastify gateway, local Ollama adapter, evidence-constrained portfolio retrieval and a small static-site widget. This is an implemented, tested release candidate, **not an activated production deployment**.

The public homepage and `.github/workflows/deploy-namecheap.yml` remain unchanged. Draft PR #6 contains the implementation. Production activation is blocked until Mac discovery, real-model quality/performance tests, network configuration, privacy review and explicit owner approval are complete.

## What is implemented

- Versioned anonymous session, JSON chat, validated SSE chat, session deletion and minimal health endpoints.
- Server-side Turnstile verification, short-lived bearer sessions, exact Origin checks, trusted connector peer validation, bounded queues, rate limits, cancellation and graceful shutdown.
- In-memory conversation context with no application transcript persistence. No database, Redis, vector database, model tools or paid inference.
- A 14-fact curated public portfolio knowledge base with source links. Evidence answers are reconstructed from approved facts instead of generated claims. Hypothetical advice is separately labeled and validated.
- A matching dark/cyan static widget with native dialog accessibility, explicit consent, safe Markdown subset, stop/restart/copy, citations and offline contact links.
- Unit/API/real-socket transport tests, Chromium/WebKit browser tests, axe accessibility checks and a 56-case real-model evaluation dataset.
- Container and tunnel configuration, operator scripts, benchmark harness and documentation.

## Local development

From this directory with Node 24.20.0:

```sh
npm ci --ignore-scripts
npm test
npm run lint
npx playwright install chromium webkit
npm run test:browser
npm run build:site -- --test
```

The test model and Turnstile verifier are dependency-injected fixtures, never an environment-controlled production auth bypass. The test homepage is written to `release/index.html`; it must not be deployed with a Turnstile test key. The default site build is disabled and reproduces the current homepage byte for byte.

Real evaluation requires an approved local model, its exact digest, local configuration and the actual runtime. `npm run evaluate` and `npm run benchmark` deliberately have no mock mode. Generated reports stay local in the ignored `reports/` directory.

## Documentation

- [Architecture decisions and diagram](docs/architecture.md)
- [API and streaming contract](docs/api.md)
- [Threat model and residual risks](docs/security.md)
- [Knowledge curation and recruiting quality](docs/knowledge.md)
- [Mac model selection and benchmark protocol](docs/performance.md)
- [DNS and tunnel change control](docs/networking.md)
- [Deployment, recovery and operations](docs/operations.md)
- [One-step-at-a-time human setup](docs/human-setup.md)
- [Verification status and release gates](docs/verification.md)

Never place secrets in this repository, screenshots, issue comments or chat. The `secrets/` directory is ignored. Do not start the public tunnel before the recorded safety gates are complete.
