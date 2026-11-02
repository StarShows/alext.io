import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { OllamaService } from '../dist/ollama.js';
import { createApp } from '../dist/app.js';
import { config, headers, fixtureModel, knowledge } from './helpers.mjs';
async function origin(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}
const input = () => ({
  question: 'What is Alex React experience?',
  mode: 'recruiter',
  intent: 'experience',
  history: [],
  facts: knowledge().retrieve('React experience').slice(0, 2),
});
test('real HTTP Ollama adapter fixes model parameters and parses split UTF-8 NDJSON', async (t) => {
  const payloads = [];
  const url = await origin(t, async (req, res) => {
    if (req.url === '/api/tags') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ models: [{ name: config.model, digest: config.modelDigest }] }));
      return;
    }
    const pieces = [];
    for await (const chunk of req) pieces.push(chunk);
    const body = JSON.parse(Buffer.concat(pieces));
    payloads.push(body);
    if (!body.stream) {
      res.end(
        JSON.stringify({
          done: true,
          done_reason: 'stop',
          message: {
            content: JSON.stringify({
              scope: 'professional',
              intent: 'experience',
              confidence: 0.95,
            }),
          },
        }),
      );
      return;
    }
    res.setHeader('content-type', 'application/x-ndjson');
    const text =
      JSON.stringify({ message: { content: 'caf\u00e9' }, done: false }) +
      '\n' +
      JSON.stringify({
        message: { content: '' },
        done: true,
        done_reason: 'stop',
        load_duration: 1000000,
        eval_count: 2,
        eval_duration: 2000000,
      }) +
      '\n';
    const bytes = Buffer.from(text);
    const split = bytes.indexOf(Buffer.from('\u00e9')) + 1;
    res.write(bytes.subarray(0, split));
    await delay(10);
    res.end(bytes.subarray(split));
  });
  const model = new OllamaService({ ...config, ollamaUrl: url });
  t.after(() => model.close());
  assert.equal(await model.ready(AbortSignal.timeout(1000)), true);
  assert.equal(
    (await model.classify('React experience', [], AbortSignal.timeout(1000))).intent,
    'experience',
  );
  const chunks = [];
  for await (const chunk of model.answer(input(), AbortSignal.timeout(1000))) chunks.push(chunk);
  assert.equal(
    chunks
      .filter((chunk) => 'text' in chunk)
      .map((chunk) => chunk.text)
      .join(''),
    'caf\u00e9',
  );
  assert.equal(chunks.at(-1).stats.generatedTokens, 2);
  for (const body of payloads) {
    assert.equal(body.model, config.model);
    assert.equal(body.think, false);
    assert.equal(body.options.temperature, 0);
    assert.equal(body.options.num_ctx, 8192);
    assert.equal(body.tools, undefined);
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.format.type, 'object');
  }
});
test('model readiness rejects missing, altered or remote models', async (t) => {
  let entry = { name: config.model, digest: 'b'.repeat(64) };
  const url = await origin(t, (_req, res) => res.end(JSON.stringify({ models: [entry] })));
  const model = new OllamaService({ ...config, ollamaUrl: url });
  t.after(() => model.close());
  assert.equal(await model.ready(AbortSignal.timeout(1000)), false);
  entry = { name: config.model, digest: config.modelDigest, remote_host: 'https://cloud.example' };
  assert.equal(await model.ready(AbortSignal.timeout(1000)), false);
  entry = { name: 'different', digest: config.modelDigest };
  assert.equal(await model.ready(AbortSignal.timeout(1000)), false);
});
test('Ollama transport rejects redirects, missing terminal records, tools and upstream errors', async (t) => {
  for (const variant of ['redirect', 'truncated', 'tool', 'error']) {
    const url = await origin(t, async (req, res) => {
      for await (const _chunk of req) {
        /* Drain bounded fixture request. */
      }
      if (variant === 'redirect') {
        res.writeHead(302, { location: 'http://127.0.0.1:1/private' }).end();
        return;
      }
      if (variant === 'truncated')
        res.end(JSON.stringify({ message: { content: 'partial' } }) + '\n');
      if (variant === 'tool')
        res.end(
          JSON.stringify({ message: { tool_calls: [{ function: { name: 'shell' } }] } }) + '\n',
        );
      if (variant === 'error')
        res.end(JSON.stringify({ error: 'sensitive upstream exception' }) + '\n');
    });
    const model = new OllamaService({ ...config, ollamaUrl: url });
    await assert.rejects(async () => {
      for await (const _chunk of model.answer(input(), AbortSignal.timeout(1000))) {
        /* Consume fixture output. */
      }
    });
    model.close();
  }
});
test('aborting local inference closes the real upstream request', async (t) => {
  let disconnected = false;
  const url = await origin(t, async (req, res) => {
    for await (const _chunk of req) {
      /* Drain. */
    }
    res.on('close', () => {
      disconnected = true;
    });
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.write('{"message":{"content":"x"},"done":false}\n');
  });
  const model = new OllamaService({ ...config, ollamaUrl: url });
  t.after(() => model.close());
  const controller = new AbortController();
  await assert.rejects(async () => {
    for await (const _chunk of model.answer(input(), controller.signal)) controller.abort();
  });
  for (let i = 0; i < 20 && !disconnected; i++) await delay(10);
  assert.equal(disconnected, true);
});
