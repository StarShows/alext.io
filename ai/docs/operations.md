# Deployment and operational runbook

This is an operator reference, not a request to execute every step now. Human setup is guided one verified action at a time. Nothing here has already changed the Mac, DNS or production website.

## Initial installation gates

Record actual hardware and existing services before installing or starting anything. Approve model downloads, disk/RAM/CPU budgets and proposed Docker subnets. Resolve and record immutable Node, Ollama and cloudflared image digests. Keep secrets in the local ignored 0700 directory and verify non-root container readability. Render the tunnel config locally, but do not start it until the hostname/routing change is approved.

The `maintenance` profile is deliberately excluded from normal startup. Its volume initializer changes ownership only on the project model volume, not a host directory. Its separate downloader is the only model component that needs internet access. Download only the selected approved model, record its full digest, then serve from the read-only model volume on the isolated inference network. Do not run the initializer against an unrelated or pre-existing volume without inspection.

`scripts/preflight.mjs` checks configuration, fixed image/model identities and a local explicit approval record. `scripts/start-approved.sh` also requires `AI_START_APPROVED=yes`. Approval fields are evidence references supplied by the operator, not a substitute for actual tests. The script does not create secrets, change DNS, enable router forwarding, change sleep settings or install software.

Required local `ops/approval.json` fields are `hardwareReviewed`, `networkRangesReviewed`, `containerRuntimeApproved`, `memoryBudgetReviewed`, `localModelEvaluated`, and `ingressApproved`, all true only after the corresponding review. Add dates and links to locally retained evidence. This file is ignored and must never contain credentials.

## Website activation

The existing Namecheap workflow is unchanged and remains the only established production website deployment path. The widget builder writes an integrated homepage under `ai/release/` and validates that removing its inserted block restores the original homepage exactly. It does not overwrite the working root homepage.

After real Mac/tunnel/Turnstile tests and explicit activation approval, prepare the generated homepage as a dedicated reviewed commit and deploy through the established Namecheap workflow. A build artifact alone does not activate the widget. Confirm the public Turnstile site key is production-valid, the generated manifest matches the tested commit, the target is `/home/realtorstudio/alext.io`, and the existing backup/atomic-replace behavior is preserved.

Before that activation commit is merged, adapt the release builder for subsequent regeneration of the embedded widget and test the resulting workflow integration. Do not deploy a separate widget-only artifact and assume the current workflow uploads it; it uploads only `index.html`. This last production activation adaptation remains intentionally gated, not claimed as complete.

## Gateway updates without public SSH

Use an owner-approved pull-based deployment on the Mac: fetch the exact approved repository revision, verify its CI result and review status, install from the integrity lockfile, build a versioned image with pinned inputs, then replace only the gateway service. Keep the previous image and configuration for rollback. No model service, unrelated container, DNS record or production workflow should be changed during an ordinary gateway update.

The current implementation provides configuration validation, startup and monitoring scripts. A persistent unattended Mac deployment agent is not installed. Do not run untrusted pull-request code on a privileged self-hosted runner. Any later pull agent must restrict itself to approved main-branch releases and fail closed when provenance or required checks cannot be verified.

## Restart and power behavior

Compose services have restart policies and shutdown grace periods. The gateway stops accepting work, aborts active requests, releases queues and clears temporary sessions. Restart policies only work while Docker Desktop's engine is running; they do not prove recovery before a user logs in after a Mac reboot.

With owner approval, configure Docker Desktop login startup or a reviewed dedicated service arrangement. Verify FileVault/login behavior, power restoration and wake/sleep behavior on the actual Mac. Do not disable sleep or alter power settings automatically. If native Ollama is approved, configure its loopback-only environment and managed launchd lifecycle, then verify restart/logging/resource behavior separately. No native launchd installation is claimed in this repository.

## Monitoring

Run `scripts/monitor-local.mjs` from the approved project directory. It reads project container state, host disk capacity, macOS memory pressure and private gateway counters. It reports alerts and exits nonzero when checks fail. The gateway exposes no public diagnostic endpoint. For detailed resource evidence, collect project-scoped `docker stats` and container restart counts using selected fields only; never dump full container environments.

Review request/error/rate-limit counts, first validated block and completion latency, queue depth, active inference, model availability, RSS, host memory pressure and free disk. Confirm tunnel connectivity independently with the provider dashboard or connector's private metrics plus an external health request. A running connector process alone is not proof of a connected tunnel. Scheduling or external notifications require separate owner approval and are not configured yet.

## Failure handling

**Assistant offline:** the existing website remains available and the widget shows a bounded error with GitHub/email links. Check power, Docker engine, model digest/readiness and tunnel state locally. Do not switch to a paid inference provider.

**Overload:** preserve the concurrency cap and bounded queue. Investigate aggregate quotas and host pressure. Do not solve abuse by increasing parallel model calls or weakening Turnstile. Temporary 429/503 responses are preferable to making the Mac unusable.

**Suspected credential compromise:** stop only the affected gateway/tunnel, revoke the corresponding provider credential, rotate it through secure interfaces, clear sessions and re-run the acceptance tests. Never request tokens in a screenshot or chat message.

**Bad gateway release:** restore the previously recorded image and reviewed configuration, recreate only that service, and verify readiness plus real chat. Rollback is manual until an explicit safe automatic rollback predicate is approved. Do not use `docker compose down -v`; it would delete the model volume.

**Bad website release:** the existing Namecheap deploy creates a uniquely named prior-homepage backup before atomic replacement. Verify the desired backup's hash and restore it atomically through the approved deployment process. Do not alter DNS to roll back a frontend widget problem.

**DNS incident:** use the separately approved DNS rollback plan and full zone export. Reverting nameservers or DS records blindly can make the problem worse; coordinate TTL and DNSSEC state.

## Release evidence

For every activation/update, record source commit, CI run, Node/dependency lock identity, image/model digests, knowledge revision, homepage SHA-256, secret identifiers without values, environment, deployment result and observed acceptance outcomes. Retain synthetic test reports, not visitor transcripts. Do not mark a release production-verified on the strength of a green fixture suite or health status alone.
