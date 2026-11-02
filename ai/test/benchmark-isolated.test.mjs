import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  ChatCollector,
  ResponseParser,
  distribution,
  exchange,
  payload,
  relay,
  wireRequest,
} from '../scripts/benchmark-isolated.mjs';
import { model, containerArgs, verifyContainer } from '../scripts/prepare-benchmark-model.mjs';
const row = (content, end = false) => ({
  model,
  message: { role: 'assistant', content },
  done: end,
  ...(end
    ? {
        done_reason: 'stop',
        total_duration: 1000000000,
        load_duration: 10000000,
        prompt_eval_count: 300,
        prompt_eval_duration: 100000000,
        eval_count: 50,
        eval_duration: 500000000,
      }
    : {}),
});
const lines = (items) => Buffer.from(items.map((x) => JSON.stringify(x)).join('\n') + '\n');

test('benchmark fixes model, one stream, disabled thinking and bounded server-owned parameters', () => {
  for (let index = 0; index <= 20; index++) {
    const p = payload(index);
    assert.equal(p.model, model);
    assert.equal(p.stream, true);
    assert.equal(p.think, false);
    assert.equal(p.keep_alive, '5m');
    assert.equal(p.tools, undefined);
    assert.deepEqual(p.options, {
      num_ctx: 4096,
      num_predict: 256,
      num_thread: 4,
      temperature: 0,
      seed: 42,
    });
    assert(p.messages[0].content.includes('not completed work'));
  }
  assert.throws(() => payload(21));
  assert.throws(() => payload(-1));
});

test('HTTP request allows only local test paths, no injection or arbitrary host', () => {
  const request = wireRequest('/api/chat', payload(0)).toString();
  assert(request.startsWith('POST /api/chat HTTP/1.0\r\nHost: 127.0.0.1:11434'));
  const [head, body] = request.split('\r\n\r\n');
  assert.equal(Number(head.match(/Content-Length: (\d+)/)[1]), Buffer.byteLength(body));
  assert.throws(() => wireRequest('/api/pull', {}));
  assert.throws(() => wireRequest('/api/chat'));
  assert.throws(() => wireRequest('/api/tags', {}));
  assert.throws(() => wireRequest('/api/chat', { x: 'a'.repeat(20000) }));
});

test('HTTP parser supports fragmented headers and body and verifies content length', () => {
  const chunks = [];
  const p = new ResponseParser((c) => chunks.push(c));
  for (const byte of Buffer.from('HTTP/1.0 200 OK\r\nContent-Length: 5\r\n\r\nhello'))
    p.push(Buffer.from([byte]));
  p.finish();
  assert.equal(Buffer.concat(chunks).toString(), 'hello');
  const broken = new ResponseParser(() => {});
  broken.push(Buffer.from('HTTP/1.0 200 OK\r\nContent-Length: 6\r\n\r\nhello'));
  assert.throws(() => broken.finish());
});

test('HTTP parser fails closed for error status, chunked/compressed data and oversized output', () => {
  for (const head of [
    'HTTP/1.0 503 Busy',
    'HTTP/1.0 302 Moved',
    'HTTP/1.0 200 OK\r\nTransfer-Encoding: chunked',
    'HTTP/1.0 200 OK\r\nContent-Encoding: gzip',
    'HTTP/1.0 200 OK\r\nContent-Length: 1\r\nContent-Length: 2',
  ])
    assert.throws(() => new ResponseParser(() => {}).push(Buffer.from(head + '\r\n\r\n')));
  assert.throws(() => new ResponseParser(() => {}).push(Buffer.alloc(524289)));
  assert.throws(() => new ResponseParser(() => {}).push(Buffer.alloc(16385)));
  assert.throws(() => new ResponseParser(() => {}).finish());
});

test('collector handles fragmented UTF-8 and reports timing in correct units', () => {
  let clock = 0;
  const c = new ChatCollector(() => clock);
  clock = 100;
  for (const byte of lines([row('caf\u00e9 ')])) c.push(Buffer.from([byte]));
  clock = 300;
  c.push(lines([row('done'), row('', true)]));
  clock = 1000;
  const r = c.finish();
  assert.equal(r.answer, 'caf\u00e9 done');
  assert.equal(r.firstContentMs, 100);
  assert.equal(r.completionMs, 1000);
  assert.equal(r.tokensPerSecond, 100);
  assert.equal(r.modelLoadMs, 10);
  assert.equal(r.contentFrames, 2);
  assert.equal(r.truncated, false);
});

test('collector records token-limit truncation instead of calling it a full answer', () => {
  const last = row('bounded', true);
  last.done_reason = 'length';
  last.eval_count = 256;
  const c = new ChatCollector();
  c.push(lines([last]));
  assert.equal(c.finish().truncated, true);
});

test('collector rejects missing completion, corrupt data, wrong models, tools and excess tokens', () => {
  const mutations = [
    (x) => (x.model = 'cloud:other'),
    (x) => (x.message.tool_calls = [{}]),
    (x) => (x.message.thinking = 'hidden'),
    (x) => (x.error = 'failure'),
    (x) => (x.eval_count = 257),
    (x) => (x.prompt_eval_count = 4097),
    (x) => (x.eval_duration = -1),
    (x) => (x.done_reason = 'unexpected'),
  ];
  for (const mutate of mutations) {
    const x = row('hello', true);
    mutate(x);
    const c = new ChatCollector();
    assert.throws(() => c.push(lines([x])));
  }
  const c = new ChatCollector();
  c.push(lines([row('partial')]));
  assert.throws(() => c.finish());
  const done = new ChatCollector();
  assert.throws(() => done.push(lines([row('ok', true), row('extra')])));
  assert.throws(() => new ChatCollector().push(Buffer.from('{bad}\n')));
  assert.throws(() => new ChatCollector().push(Buffer.alloc(32769, 65)));
});

test('percentiles exclude missing values, expose sample count and use nearest rank', () => {
  assert.deepEqual(distribution([null, undefined, NaN]), { count: 0, median: null, p95: null });
  assert.deepEqual(distribution(Array.from({ length: 20 }, (_, i) => i + 1)), {
    count: 20,
    median: 10,
    p95: 19,
  });
});

test('exact Bash relay carries actual HTTP incrementally without host service exposure', async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.httpVersion, '1.0');
    let request = '';
    req.on('data', (c) => (request += c));
    req.on('end', () => {
      assert.equal(JSON.parse(request).model, model);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(lines([row('first ')]));
      setTimeout(() => res.end(lines([row('last', true)])), 100);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const c = new ChatCollector();
  let firstSeen;
  const start = performance.now();
  try {
    await exchange(
      '/bin/bash',
      ['-ec', relay.replace('11434', String(port))],
      wireRequest('/api/chat', payload(0)),
      (chunk) => {
        firstSeen ??= performance.now();
        c.push(chunk);
      },
      AbortSignal.timeout(5000),
    );
    const result = c.finish();
    assert.equal(result.answer, 'first last');
    assert(
      result.completionMs - (firstSeen - start) >= 60,
      'Response was not delivered incrementally',
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('request cancellation terminates the relay and rejects rather than reporting success', async () => {
  const server = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.flushHeaders();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const controller = new AbortController();
  const port = server.address().port;
  const timer = setTimeout(() => controller.abort(), 120);
  try {
    await assert.rejects(
      exchange(
        '/bin/bash',
        ['-ec', relay.replace('11434', String(port))],
        wireRequest('/api/chat', payload(0)),
        () => {},
        controller.signal,
      ),
    );
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('default CLI does not start Docker and benchmark only reuses an owned read-only model volume', () => {
  const cli = spawnSync(
    process.execPath,
    [new URL('../scripts/benchmark-isolated.mjs', import.meta.url).pathname],
    { encoding: 'utf8' },
  );
  assert.equal(cli.status, 1);
  assert(cli.stderr.includes('Use --run'));
  const text = readFileSync(new URL('../scripts/benchmark-isolated.mjs', import.meta.url), 'utf8');
  for (const dangerous of [
    "['pull'",
    "['volume', 'create'",
    "['network', 'create'",
    'host.docker.internal',
    '--privileged',
    '--publish',
    '/var/run/docker.sock',
  ])
    assert(!text.includes(dangerous));
  assert(text.includes("'none'"));
  assert(text.includes('verifyStoredModel(run, id)'));
  const args = containerArgs('alext-bench-abcdef', 'none', { readOnlyModels: true });
  assert(args.includes('--memory=4g'));
  assert(args.includes('--memory-swap=4g'));
  assert(args.includes('--cpus=4'));
  assert(args.some((x) => x.includes('volume-nocopy,readonly')));
  assert.equal(typeof verifyContainer, 'function');
});
