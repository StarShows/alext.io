import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../dist/app.js';
import { config, headers, fixtureModel, knowledge } from './helpers.mjs';
function request(port, path, body, authorization) {
  const data = JSON.stringify(body);
  const req = http.request({ hostname: '127.0.0.1', port, path, method: 'POST', headers: { ...headers, 'content-length': Buffer.byteLength(data), ...(authorization ? { authorization } : {}) } });
  const response = new Promise((resolve, reject) => { req.once('response', resolve); req.once('error', reject); });
  req.end(data); return { req, response };
}
test('real HTTP SSE sends a validated block before completion; disconnect cancels upstream and frees the slot', { timeout: 5000 }, async (t) => {
  let cancelled = false;
  const model = fixtureModel({ async *answer(input, signal) {
    yield { text: JSON.stringify({ blocks: [{ kind: 'evidence', ids: [input.facts[0].id], text: '' }] }).slice(0, -2) };
    try { await delay(10000, undefined, { signal }); } catch { cancelled = true; throw new DOMException('Stopped', 'AbortError'); }
    yield { text: ']}' };
  } });
  const service = await createApp({ config: { ...config, trustedProxy: '127.0.0.1' }, model, knowledge: knowledge(), verify: async () => true, logging: false });
  await service.app.listen({ host: '127.0.0.1', port: 0 }); t.after(() => service.app.close());
  const port = service.app.server.address().port;
  const issued = await request(port, '/v1/session', { consent: true, turnstileToken: 'fixture' }).response;
  assert.equal(issued.statusCode, 201); const chunks = []; for await (const chunk of issued) chunks.push(chunk);
  const token = JSON.parse(Buffer.concat(chunks)).token;
  const stream = request(port, '/v1/chat/stream', { message: 'React experience', mode: 'recruiter' }, `Bearer ${token}`);
  const response = await stream.response; assert.equal(response.statusCode, 200);
  let text = '';
  await new Promise((resolve, reject) => {
    response.on('data', (chunk) => { text += chunk.toString('utf8'); if (text.includes('event: block')) resolve(); });
    response.once('error', reject); response.once('end', () => reject(new Error('Stream ended before cancellation test')));
  });
  assert(!text.includes('event: done'));
  stream.req.destroy(); response.destroy();
  for (let index = 0; index < 50 && !cancelled; index++) await delay(10);
  assert.equal(cancelled, true); assert.deepEqual(service.engine.gate.metrics, { active: 0, queued: 0 });
});
