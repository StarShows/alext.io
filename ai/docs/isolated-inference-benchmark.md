# First isolated inference benchmark

This stage measures the already-approved Qwen 3.5 2B Q4_K_M model on the owner's
Mac mini, using the existing pinned Linux ARM64 Ollama 0.40.4 image and named model
volume. Image and model installation, six content hashes, the original manifest,
the active v2 reference, and offline read-only startup were verified in owner
terminal output before this stage. No Mac benchmark numbers are supplied here.

## Operation

Fetch `benchmark-isolated.mjs` and `prepare-benchmark-model.mjs` from the same
reviewed commit into a fresh directory. Check their published SHA-256 hashes. Run
`node --max-old-space-size=128 benchmark-isolated.mjs --run` on the approved Mac.
The Node controller orchestrates Docker; it does not execute model inference.
This controller's heap limit is not an operating-system RSS or CPU quota. Its RSS
is monitored separately, with a 512 MiB stop guard.

Only one temporary, non-root Ollama container is started. Its approved hard limits
remain 4 GiB memory, no container swap, 4 CPU equivalents and 128 processes. Model
storage is read-only; the existing native Ollama service is never contacted. No
images, weights, packages, secrets, volumes or networks are downloaded or created.
The host creates a private JSON report and Docker creates its ephemeral container
metadata and bounded logs. Only that container is stopped and removed afterward;
model storage is retained. No unrelated container is stopped.

The container has `network=none`. Bash and cat relay HTTP requests to the
container's own loopback using Docker exec. No host ports or inference endpoint
are exposed, and no host filesystem or Docker socket is mounted. This deliberately
avoids downloading a separate client image for the first raw-runtime measurement.
The relay shares the same 4 GiB / 4 CPU container limits as inference. The 512 MiB
separate gateway-container budget remains unused in this stage.

After integrity checks and a verified empty residency list, the script issues one
unloaded-model request and 20 warm sequential requests. Each request fixes
`think=false`, 4096 context tokens, 256 output tokens, four inference threads, seed
42 and temperature zero. Prompts rotate across four realistic recruiting and
architecture questions with short, fixed public knowledge excerpts. The initial
model-load test is NOT a cold-disk-cache benchmark: hashing warms filesystem caches.
A token-limit stop is explicitly recorded as truncation, not answer completion.

Each generation has a 90-second deadline; the entire controller has a 20-minute
deadline. Ctrl+C cancels the test. Memory-pressure checks where available, a 12 GiB
host-disk reserve, cgroup OOM counters, bounded response sizes and RSS checks stop
rather than expand the approved budget. Every five seconds the controller samples
host and container memory. Measurements include some monitoring overhead. On
failure or cancellation it removes its own test container, terminating remaining
in-container requests. In an uncatchable controller or host crash, Docker restart
is disabled but a container may remain until the owner reviews it. Never use a
global prune to clean up this test.

## Evidence and limits

The private report in Downloads records answers for manual review, per-sample
latencies, Ollama token/duration counters, first-content timing, content-frame
counts, residency, container memory, host snapshots, checksums and cleanup status.
Ollama duration fields are nanoseconds; tokens/second uses `eval_count * 1e9 /
eval_duration`. Header/stream parsing rejects malformed, oversized, truncated or
unexpected encoded responses. HTTP/1.0 with connection-close avoids manual decoding
of HTTP/1.1 chunking. The exact relay is tested with real local sockets and in an
actual offline ARM64 Ollama container without loading a model in CI.

First-content timing includes Docker exec/pipe overhead and host scheduling. A
content frame is not necessarily one token. The warm median and nearest-rank p95
are exploratory summaries of 20 samples, not a production service-level guarantee.
Cgroup memory includes filesystem cache, Ollama and relay processes, not total Mac
memory or pure model working-set memory.

This stage is NOT a full gateway benchmark. Classification, retrieval, validated
SSE, public edge latency, concurrent visitor budgets, cancellation/recovery at the
application layer, and reviewed answer-quality evaluation still require separate
integration tests. Passing this test alone does not authorize native inference,
DNS changes, public ingress or deployment.
