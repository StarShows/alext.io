import Fastify from 'fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import type { Config } from './config.js';
import type { InferenceService, VerifyHuman, Mode, Session, Block, ModelStats } from './types.js';
import { ApiError, safeError, normalizeInput, identityHasher, peerMatches, digest } from './security.js';
import { RateLimiter, SessionStore, remember } from './state.js';
import { InferenceGate } from './queue.js';
import { AssistantEngine } from './engine.js';
import { Metrics } from './metrics.js';
import type { KnowledgeBase } from './knowledge.js';

const citationSchema = { type: 'object', additionalProperties: false, required: ['id', 'label', 'url'], properties: { id: { type: 'string' }, label: { type: 'string' }, url: { type: 'string' } } };
const blockSchema = { type: 'object', additionalProperties: false, required: ['id', 'kind', 'text', 'citations'], properties: { id: { type: 'string' }, kind: { type: 'string', enum: ['evidence', 'approach', 'notice'] }, text: { type: 'string' }, citations: { type: 'array', items: citationSchema } } };
const chatBodySchema = { type: 'object', additionalProperties: false, required: ['message', 'mode'], properties: { message: { type: 'string', minLength: 1, maxLength: 2000 }, mode: { type: 'string', enum: ['recruiter', 'hiring-manager', 'leadership'] } } };
const paths = new Map<string, Set<string>>([
  ['/v1/session', new Set(['POST', 'DELETE', 'OPTIONS'])], ['/v1/chat', new Set(['POST', 'OPTIONS'])], ['/v1/chat/stream', new Set(['POST', 'OPTIONS'])], ['/v1/health', new Set(['GET'])],
]);
interface Context { ip: string; identity: string; started: number }
export async function createApp(options: { config: Config; model: InferenceService; verify: VerifyHuman; knowledge: KnowledgeBase; logging?: boolean }) {
  const { config, model, verify, knowledge } = options;
  const app = Fastify({ logger: options.logging === false ? false : { level: config.logLevel, redact: ['req', 'res', 'headers', 'body', 'token', 'secret'] }, disableRequestLogging: true, requestIdHeader: false, genReqId: () => randomUUID(), bodyLimit: 8192, connectionTimeout: 10000, requestTimeout: 15000, keepAliveTimeout: 5000, maxRequestsPerSocket: 100, trustProxy: false, ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false, allErrors: false } } });
  const contexts = new WeakMap<FastifyRequest, Context>();
  const hasher = identityHasher(); const limiter = new RateLimiter();
  const sessions = new SessionStore(config.sessionTtlMs, config.sessionCapacity);
  const gate = new InferenceGate(config.concurrency, config.queueSize, config.queueWaitMs);
  const verifyGate = new InferenceGate(4, 0, 1000);
  const engine = new AssistantEngine(model, knowledge, gate); const metrics = new Metrics();
  const controllers = new Set<AbortController>(); const sessionControllers = new WeakMap<Session, AbortController>();
  let modelReady = false; let closing = false; let checking = false;
  async function readiness() {
    if (checking || closing) return; checking = true;
    try { modelReady = await model.ready(AbortSignal.timeout(5000)); if (!modelReady) metrics.increment('modelUnavailable'); }
    catch { modelReady = false; }
    finally { checking = false; }
  }
  await readiness();
  const sweeper = setInterval(() => { sessions.sweep(); limiter.sweep(); }, 15000); sweeper.unref();
  const healthTimer = setInterval(() => { void readiness(); }, 30000); healthTimer.unref();
  app.addHook('onRequest', async (request, reply) => {
    metrics.increment('requests');
    reply.header('cache-control', 'no-store').header('x-content-type-options', 'nosniff').header('referrer-policy', 'no-referrer').header('vary', 'Origin').header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    const path = request.raw.url ?? '';
    const methods = paths.get(path);
    if (!methods || !methods.has(request.method)) throw new ApiError('NOT_FOUND', 404);
    const peer = request.raw.socket.remoteAddress;
    // Container health checks are local and cannot inspect diagnostics or call chat.
    const localHealth = path === '/v1/health' && (peerMatches(peer, '127.0.0.1') || peer === '::1');
    if (!localHealth && (!peerMatches(peer, config.trustedProxy) || ![config.publicHost, `${config.publicHost}:443`].includes(request.headers.host ?? ''))) throw new ApiError('FORBIDDEN', 403);
    if (localHealth) return;
    const ip = request.headers['cf-connecting-ip'];
    if (typeof ip !== 'string' || ip.length > 45 || !isIP(ip)) throw new ApiError('FORBIDDEN', 403);
    const identity = hasher(ip); contexts.set(request, { ip, identity, started: performance.now() });
    limiter.take(`http:${identity}`, 40, 60000);
    if (path === '/v1/health') { limiter.take('health:global', 120, 60000); return; }
    if (request.headers.origin !== config.origin) throw new ApiError('FORBIDDEN', 403);
    reply.header('access-control-allow-origin', config.origin);
    if (request.method === 'OPTIONS') {
      const requested = request.headers['access-control-request-method'];
      const headers = String(request.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map((header) => header.trim()).filter(Boolean);
      if (typeof requested !== 'string' || !methods.has(requested) || requested === 'OPTIONS' || headers.some((header) => !['authorization', 'content-type'].includes(header))) throw new ApiError('FORBIDDEN', 403);
      return reply.header('access-control-allow-methods', 'POST, DELETE, OPTIONS').header('access-control-allow-headers', 'Authorization, Content-Type').header('access-control-max-age', '600').code(204).send();
    }
    if (closing) throw new ApiError('UNAVAILABLE', 503);
    if (request.method === 'POST' && !/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) throw new ApiError('INVALID_REQUEST', 400);
  });
  app.setErrorHandler((error, request, reply) => {
    const candidate = error as { validation?: unknown; statusCode?: number };
    const safe = candidate.validation || candidate.statusCode === 400 || candidate.statusCode === 413 || candidate.statusCode === 415 ? new ApiError('INVALID_REQUEST', candidate.statusCode === 413 ? 413 : 400) : safeError(error);
    metrics.increment('errors'); if (safe.status === 429) { metrics.increment('rateLimited'); reply.header('retry-after', '60'); }
    // Deliberately omit error objects, URL input, IP, headers, body and model text.
    request.log.warn({ event: 'request_rejected', requestId: request.id, code: safe.code, status: safe.status });
    return reply.code(safe.status === 499 ? 503 : safe.status).send({ error: { code: safe.code, message: safe.message }, requestId: request.id });
  });
  app.setNotFoundHandler(async () => { throw new ApiError('NOT_FOUND', 404); });
  app.addHook('onResponse', async (request, reply) => {
    const context = contexts.get(request);
    if (context) metrics.observe('requestMs', performance.now() - context.started);
    request.log.info({ event: 'request_complete', requestId: request.id, status: reply.statusCode });
  });
  function contextOf(request: FastifyRequest): Context { const context = contexts.get(request); if (!context) throw new ApiError('FORBIDDEN', 403); return context; }
  function sessionOf(request: FastifyRequest) {
    const auth = request.headers.authorization;
    if (typeof auth !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(auth)) throw new ApiError('SESSION_REQUIRED', 401);
    const token = auth.slice(7); const context = contextOf(request);
    return { token, context, session: sessions.get(token, context.identity, config.origin) };
  }
  app.get('/v1/health', { schema: { response: { 200: { type: 'object', additionalProperties: false, required: ['status'], properties: { status: { type: 'string', enum: ['ok', 'unavailable'] } } }, 503: { type: 'object', additionalProperties: false, required: ['status'], properties: { status: { type: 'string', enum: ['unavailable'] } } } } } }, async (_request, reply) => reply.code(modelReady && !closing ? 200 : 503).send({ status: modelReady && !closing ? 'ok' : 'unavailable' }));
  app.post<{ Body: { turnstileToken: string; consent: boolean } }>('/v1/session', { schema: {
    body: { type: 'object', additionalProperties: false, required: ['turnstileToken', 'consent'], properties: { turnstileToken: { type: 'string', minLength: 1, maxLength: 2048 }, consent: { type: 'boolean', const: true } } },
    response: { 201: { type: 'object', additionalProperties: false, required: ['token', 'expiresAt'], properties: { token: { type: 'string' }, expiresAt: { type: 'integer' } } } },
  } }, async (request, reply) => {
    const context = contextOf(request);
    limiter.take(`issue:${context.identity}`, 3, 900000); limiter.take('issue:global', 30, 60000);
    const controller = new AbortController(); controllers.add(controller);
    const abort = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.once('close', abort);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]);
    let release: (() => void) | undefined;
    try {
      release = await verifyGate.acquire(signal);
      if (!await verify(request.body.turnstileToken, context.ip, signal)) throw new ApiError('FORBIDDEN', 403);
      signal.throwIfAborted(); metrics.increment('sessions');
      return reply.code(201).send(sessions.create(context.identity, config.origin));
    } finally { release?.(); controllers.delete(controller); reply.raw.removeListener('close', abort); }
  });
  app.delete('/v1/session', async (request, reply) => { const { token, session } = sessionOf(request); sessionControllers.get(session)?.abort(); session.history.length = 0; sessions.delete(token); return reply.code(204).send(); });
  async function chat(request: FastifyRequest<{ Body: { message: string; mode: Mode } }>, reply: FastifyReply, streaming: boolean) {
    const { token, context, session } = sessionOf(request); const question = normalizeInput(request.body.message);
    if (session.busy) throw new ApiError('BUSY', 409);
    limiter.take(`chat-ip:${context.identity}`, 6, 60000); limiter.take(`chat-session:${digest(token)}`, 6, 60000); limiter.take('chat:global-minute', 20, 60000); limiter.take('chat:global-hour', 120, 3600000);
    if (session.turns >= config.maxTurns) throw new ApiError('SESSION_REQUIRED', 401);
    if (!modelReady) throw new ApiError('UNAVAILABLE', 503);
    session.busy = true; session.turns++;
    const controller = new AbortController(); controllers.add(controller); sessionControllers.set(session, controller);
    const remaining = Math.max(1, session.expiresAt - Date.now());
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(Math.min(config.requestTimeoutMs, remaining))]);
    const abort = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.once('close', abort);
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const blocks: Block[] = [];
    async function event(name: 'meta' | 'block' | 'done' | 'error', value: unknown) {
      signal.throwIfAborted();
      if (!reply.raw.write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`)) await once(reply.raw, 'drain', { signal });
    }
    try {
      if (streaming) {
        reply.hijack(); reply.raw.writeHead(200, { ...reply.getHeaders(), 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no' });
        reply.raw.flushHeaders();
        await event('meta', { requestId: request.id, identity: 'AI assistant for Alex', status: 'working' });
        heartbeat = setInterval(() => { if (!reply.raw.destroyed && !reply.raw.writableNeedDrain) reply.raw.write(': keepalive\n\n'); }, 10000);
      }
      for await (const block of engine.respond(question, request.body.mode, session, signal, (name, value) => {
        if (name === 'model') metrics.model(value as ModelStats); else metrics.observe('firstBlockMs', value as number);
      })) { blocks.push(block); if (streaming) await event('block', block); }
      signal.throwIfAborted();
      remember(session, question, blocks.map((block) => block.text).join('\n\n')); metrics.increment('completed');
      if (streaming) { await event('done', { requestId: request.id, completed: true }); reply.raw.end(); return; }
      return reply.send({ requestId: request.id, blocks, completed: true });
    } catch (error) {
      metrics.increment(controller.signal.aborted ? 'cancelled' : 'errors');
      if (!streaming) throw error;
      const safe = safeError(error);
      if (!reply.raw.destroyed && !reply.raw.writableEnded) { reply.raw.end(`event: error\ndata: ${JSON.stringify({ code: safe.code, message: safe.message, requestId: request.id })}\n\n`); }
    } finally {
      if (heartbeat) clearInterval(heartbeat); controller.abort(); controllers.delete(controller); sessionControllers.delete(session); session.busy = false; reply.raw.removeListener('close', abort);
    }
  }
  const responseSchema = { 200: { type: 'object', additionalProperties: false, required: ['requestId', 'blocks', 'completed'], properties: { requestId: { type: 'string' }, blocks: { type: 'array', items: blockSchema }, completed: { type: 'boolean', const: true } } } };
  app.post<{ Body: { message: string; mode: Mode } }>('/v1/chat', { schema: { body: chatBodySchema, response: responseSchema } }, async (request, reply) => chat(request, reply, false));
  app.post<{ Body: { message: string; mode: Mode } }>('/v1/chat/stream', { schema: { body: chatBodySchema } }, async (request, reply) => chat(request, reply, true));
  for (const path of ['/v1/session', '/v1/chat', '/v1/chat/stream']) app.options(path, async (_request, reply) => reply.code(204).send());
  app.addHook('preClose', async () => { closing = true; gate.close(); verifyGate.close(); for (const controller of controllers) controller.abort(); });
  app.addHook('onClose', async () => { clearInterval(sweeper); clearInterval(healthTimer); sessions.clear(); limiter.clear(); model.close(); });
  return { app, engine, metrics, sessions, snapshot: () => metrics.snapshot({ ready: modelReady, inference: gate.metrics, sessions: sessions.size, knowledgeRevision: knowledge.revision }) };
}
