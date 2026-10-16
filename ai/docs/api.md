# Public API v1

Production base: `https://ai.alext.io`. The connector routes only the paths below. The gateway independently rejects unknown methods, query strings, trailing-slash aliases and raw Ollama endpoints.

All non-health requests require `Origin: https://alext.io`. POST requests require `Content-Type: application/json`. Browser requests use `credentials: omit`. There are no session cookies and no frontend API secret.

## POST /v1/session

Request:

```json
{ "turnstileToken": "single-use human verification token", "consent": true }
```

Success: HTTP 201 with `token` (43-character random base64url bearer) and `expiresAt` (Unix milliseconds). Tokens expire after 15 minutes. The verification token must be accepted by Cloudflare Siteverify for hostname `alext.io`, action `portfolio_session` and a valid recent challenge timestamp. Official test secrets are rejected by production configuration.

Issuance is limited to three attempts per IP group per 15 minutes, 30 global attempts per minute, four concurrent verification requests and 1,000 stored sessions. A shared office/NAT may hit the same quota; this is an intentional conservative initial policy that can be adjusted after real traffic evidence.

## POST /v1/chat

Requires `Authorization: Bearer <session-token>`.

```json
{ "message": "What has Alex built with React?", "mode": "recruiter" }
```

Modes: `recruiter`, `hiring-manager`, `leadership`. Requests cannot supply history, tools, a model, system instructions or inference options. Maximum message length: 2,000 characters and 6,000 UTF-8 bytes after normalization. HTTP body limit: 8,192 bytes.

Success: HTTP 200 with `requestId`, `blocks` and `completed: true`. Each block has `id`, `kind`, `text` and `citations`. Kinds are `evidence`, `approach` or `notice`. Citations are server-approved objects containing `id`, `label` and `url`.

## POST /v1/chat/stream

Same request and authorization as JSON chat. Response is `text/event-stream; charset=utf-8`, `Cache-Control: no-store, no-transform`.

```text
event: meta
data: {"requestId":"server-generated-id","identity":"AI assistant for Alex","status":"working"}

event: block
data: {"id":"b0","kind":"evidence","text":"Approved fact text","citations":[]}

event: done
data: {"requestId":"server-generated-id","completed":true}
```

The sample empty citation array illustrates the wire shape only; actual evidence blocks require approved citations. The gateway streams complete validated blocks, not arbitrary token deltas. A comment heartbeat is sent every ten seconds while waiting. Backpressure waits for the response socket to drain.

An `error` event terminates a stream after headers have been sent. Its fields are `code`, `message` and `requestId`. HTTP status may already be 200, so clients must inspect the terminal SSE event. Missing `done` means incomplete. Earlier validated sections may remain visible but must be marked incomplete. The server stores history only after successful completion.

Abort the HTTP request to stop generation. A disconnect aborts the upstream Ollama request and releases the concurrency slot. There is no automatic replay or hidden retry of a generation.

## DELETE /v1/session

Requires the session bearer and exact Origin. No JSON body or Content-Type header is needed. Aborts active work, clears server-side context and revokes the token. Success: 204. When offline, deletion cannot be guaranteed immediately; server expiry still applies.

## GET /v1/health

Public output is only `{"status":"ok"}` or `{"status":"unavailable"}` with 200/503. Readiness is cached for up to 30 seconds and checks the pinned locally installed model. It does not perform a generation or reveal the model name, configuration, host, metrics or knowledge files. It is not by itself an end-to-end acceptance test.

## Resource budgets

One active generation per session. Default one global inference slot, two waiting requests, five-second queue timeout, 60-second total inference deadline, 20 generation attempts per session, six attempts per IP group/session per minute, 20 global attempts per minute and 120 per hour. Classification and response generation share the same inference slot. Default generation cap is 600 tokens with an 8,192-token model context. Context is bounded to three complete conversation turns and 7,000 characters, then conservatively reduced to fit the model prompt.

IP identity is an ephemeral salted HMAC. IPv6 addresses are grouped by /64 to reduce quota bypass through address rotation. Quota/session state is process-local and resets at service restart. Origin/CORS is not authentication for command-line clients; Turnstile, the random token and resource budgets provide independent controls.

## Errors

`INVALID_REQUEST`, `FORBIDDEN`, `SESSION_REQUIRED`, `RATE_LIMITED`, `BUSY`, `UNAVAILABLE`, `NOT_FOUND`, `CANCELLED`. Responses do not include stack traces, model text, secrets or upstream exception details. Rate-limit responses include `Retry-After: 60`.

## Private diagnostics

`127.0.0.1:19091/metrics` exists only inside the gateway runtime. It is not a path on the public listener. It reports aggregate counters, bounded latency samples, readiness, queue depth, active inference and process resource statistics. The tunnel must never route to this listener.
