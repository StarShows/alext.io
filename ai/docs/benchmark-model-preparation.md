# Approved isolated benchmark: model preparation

The owner approved a container-only exploratory test using `qwen3.5:2b-q4_K_M`,
4 GiB / 4 CPU equivalents for Ollama, 512 MiB / 1 CPU for the subsequent runner,
one generation at a time, 4096 context tokens and a 256 output-token cap.
This is not native-runtime or production activation approval.

## Current stage

The owner supplied a successful pinned ARM64 image-preparation report.
The six approved model/config files passed an owner-run offline checksum check.
The compatibility manifest has one additional reference to the original registry
manifest. Complete provenance and active model-name verification still need an
owner-run report. Inference, performance and answer quality remain unverified.
Do not publish private screenshots, machine paths or transcripts in this repository.

`scripts/prepare-benchmark-model.mjs --verify` is the next single owner action on
the Mac mini, after retrieving this script from the reviewed commit and checking
its SHA-256. No npm packages, additional images, API keys or account login are required.

The script uses only the already-prepared image
`ollama/ollama@sha256:9413eb2a9419819146397b9393c7a645d44753317c1b0e3a76ab45671adc2d7c`.
It does not use the native Ollama binary, home directory, listener or model store.

## Recovering the manifest comparison failure

Ollama 0.40.4's `WriteLegacyAnchor` appends a reference to the original manifest
for older-daemon compatibility. The original validator compared that entire legacy
file to the registry object, incorrectly reporting a tag change. It also recorded
the legacy-file hash rather than the active v2 model digest. Both are corrected.

`--verify` uses only the already-installed image and existing owned model volume.
It performs no registry request, image/model pull, volume creation, CHOWN initializer
or outbound network creation. One temporary non-root container starts offline with
the volume read-only, verifies the original manifest blob, the exact compatibility
manifest, the active v2 name, all six content files and local GGUF configuration,
then is removed. The existing 4 GiB / 4 CPU ceilings remain in force. No inference.
A private report records `verificationOnly: true`, `downloadPerformed: false`,
`activeManifestVerified: true` and the separate manifest digests on success.

The additional test fixtures reproduce both observed manifest hashes and reject
changed config/layers, extra references, wrong sizes, metadata changes, a corrupted
original blob and an incorrect active model link. Mocked Docker command responses
are not proof of the owner's actual files. Complete the local verification before
benchmarking. The older empty-store ARM64 smoke is still not a real-model test.

Upstream implementation: https://github.com/ollama/ollama/blob/v0.40.4/manifest/manifest.go
(`WriteLegacyAnchor`) and `manifest/paths.go` (`V2PathForName`).

## Boundaries and verification

- A dedicated named volume `alext-ai-benchmark-qwen35-2b` stores the model. An existing
  volume must have the expected ownership label, local driver without mount options,
  and no attached containers. Only its top-level ownership is initialized, in a
  network-disabled temporary container with only CHOWN added. No host paths are mounted.
- The non-root downloader has a read-only root filesystem, one writable model volume,
  a bounded temporary filesystem, fixed CPU/RAM/process limits and no published ports.
  Its Ollama API listens only on container loopback. A separate temporary bridge permits
  outbound model-registry traffic during download. This is not an egress allowlist.
- The image is never repulled. The fixed model manifest is retrieved over HTTPS with
  redirects disabled, validated and limited to 3 GiB of listed content. The stored
  manifest must match it exactly, except for the one documented legacy compatibility
  layer naming that same pinned manifest with its exact byte size. Other metadata,
  field, ordering or content changes fail. Every downloaded file is still checked
  by size and SHA-256.
  The original manifest blob must also match the pinned registry digest. The active
  v2 name must resolve to that blob and pass the same checksum; this digest is recorded
  for gateway pinning. The legacy compatibility-file checksum is recorded separately.
- After download, the temporary downloader and bridge are removed. A second non-root
  server starts with networking disabled and the model volume read-only. Only list/ps
  commands and file verification are used; no model is loaded and no inference occurs.
- Only containers created in this invocation are removed. Model data is retained on
  errors so an interrupted download can be retried. No global cleanup, model deletion,
  Docker settings, native service, DNS or website changes are performed.

The Mac preflight requires a 12 GiB reserve plus twice the model's listed size and
1 GiB overhead. Free space is also checked inside the Docker VM. A download watchdog
checks Mac space every three seconds and cancels below the 12 GiB reserve. This is
not a hard disk quota and other concurrent applications can consume disk space.
Equal Docker memory and memory-swap limits forbid guest-container swap, not macOS
swapping its VM. Memory pressure under real inference still requires measurement.

## Evidence and next gate

The preparation report is saved with private file permissions in the owner's Downloads
folder. Ask for its `Model preparation summary`, not raw environment dumps or secrets.
A successful report proves downloaded-file checks and offline startup only. It is not
a performance result, proof of local generation, or a production security audit.

The isolated GitHub-hosted ARM64 smoke test uses an empty volume, runs no inference,
and downloads no model. Fixture unit tests cover bounds and container validation.
After this stage is verified on the actual Mac, proceed to the approved bounded
real-model benchmark and the portfolio quality dataset. Keep the public tunnel off.

References: https://docs.ollama.com/faq and
https://docs.docker.com/engine/containers/resource_constraints/.
