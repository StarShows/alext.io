# Model selection and performance protocol

No Mac benchmark has been run. No model has been selected for production. All numeric targets below are provisional acceptance criteria, not results.

## Candidate selection

Discover chip, architecture, RAM, free disk, Docker VM resources, other workloads, installed models and current port bindings first. The current Ollama library includes Qwen 3.5 sizes such as 0.8B, 2B and 4B. Start with small locally available candidates and validate structured JSON output and `think:false` compatibility. A larger model is not automatically the better product. Do not download models or allocate memory until the owner approves resource use.

Source: https://ollama.com/library/qwen3.5

Reserve capacity for macOS and existing applications. Compare quantizations on the actual machine; model parameter count alone does not capture context/KV-cache and runtime overhead. Pin the complete model digest from `/api/tags`, not only a mutable tag or the shortened CLI display ID. Keep cloud features disabled and verify `ollama ps` reports the intended CPU/GPU execution.

## Controlled comparison

First benchmark the container-only setup with representative recruiting and architecture questions. Use the exact same model digest, prompt corpus, context length, output cap, temperature and concurrency in a native comparison. Native testing requires approval to relax containerization and must keep Ollama on loopback. Record Ollama, Docker, macOS and model versions, power conditions, background workload and Docker resource limits.

`scripts/benchmark.mjs` measures raw model TTFT, first validated block latency including classification, total completion time, load duration and generation throughput. It runs 20 warm sequential samples and bursts of two/four requests through the configured inference gate. It reports errors, rather than dropping failed requests from the raw data. Reports are written to ignored `reports/benchmark.json`.

The first call is labeled uncontrolled residency, not automatically cold. With separate owner approval, unload only the selected model before a cold test and record that evidence. Never stop unrelated models or containers. Capture `docker stats`, `ollama ps`, host memory pressure, CPU pressure and free disk alongside the benchmark. Gateway process RSS is not total model or Mac memory.

## Provisional user-experience targets

Aim for warm median first validated text at or below 4 seconds and p95 at or below 10 seconds, useful concise completion within 30 seconds at p95, and explicit busy feedback rather than unbounded queuing. These targets include policy classification for visible text; raw model TTFT alone would hide that cost. Keep the Mac responsive and avoid sustained memory pressure/swap growth. Actual hardware may require a smaller model, shorter responses or revised targets.

Default one inference slot with two queued requests protects the host. A burst of four should not mean four simultaneous model generations. Increase concurrency only after throughput, latency, memory and interactive host responsiveness improve measurably. The endpoint also has a global hourly budget.

For defensible p95 estimates, expand beyond the exploratory 20 warm samples and report sample count, errors and tail behavior. Include allowed questions, abstentions and long technical requests. Compare quality failures with speed; a faster model that misclassifies scope or emits invalid JSON is not acceptable.

## Remaining required measurements

| Measurement                                         | Status              |
| --------------------------------------------------- | ------------------- |
| Hardware/OS/Docker resource inventory               | Not available       |
| CPU-only container warm/cold latency and throughput | Not run             |
| Native Metal comparison                             | Not approved or run |
| Local model quality across 56 prompts               | Not run             |
| Model and host RAM/CPU pressure                     | Not measured        |
| Maximum sustainable visitor concurrency             | Not measured        |
| Public-edge streaming latency and cancellation      | Not verified        |
| Recovery after process/container/Mac restart        | Not verified        |

Retain the container-only architecture only if the actual measured quality and resource targets pass. Otherwise present the native evidence and obtain approval before changing the runtime.
