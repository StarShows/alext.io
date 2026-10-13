# Local AI assistant for alext.io

Implementation branch. Not deployed and not production verified.

The existing static homepage and Namecheap deployment workflow are unchanged.
This service will use a separate Fastify gateway, curated evidence, bounded anonymous sessions, Cloudflare Turnstile and an outbound-only tunnel. Ollama will never have a public route.

Runtime selection is pending actual Mac mini hardware discovery and CPU-container versus native-Metal benchmarks. Native inference requires owner approval. DNS, secrets, power settings, and production activation are approval-gated.

The initial CI run resolves pinned dependencies in an unprivileged GitHub-hosted runner without deployment secrets. It does not deploy anything. A reproducible lockfile and implementation tests follow in this pull request.
