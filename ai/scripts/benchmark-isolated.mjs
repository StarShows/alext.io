import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import {
  approvedModelManifest,
  containerArgs,
  image,
  model,
  verifyContainer,
  verifyStoredModel,
  volume,
} from './prepare-benchmark-model.mjs';

// Operator-only raw-runtime benchmark. No website, gateway, tunnel or external inference.
// The shell relay runs INSIDE the same offline container as Ollama and shares its limits.
// The host Node controller never listens on a port and is not an inference runtime.
export const relay = 'exec 3<>/dev/tcp/127.0.0.1/11434; cat >&3; cat <&3';
const GiB = 1024 ** 3;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const questions = [
  'Why should a team evaluating React and Node.js engineers interview Alex?',
  'How would Alex approach a secure RAG assistant for internal company documents?',
  'Suggest a conditional first 90 days for Alex on a team adopting AI.',
  "How is Alex's documented cloud experience relevant to integrating business systems?",
];
// Fixed public excerpts from portfolio.json at 76d53c9. Not new claims or visitor data.
const context = [
  'You are an AI portfolio assistant, not Alex. Answer in 80-120 words.',
  'Use only the supplied facts for personal experience. Do not invent employers, years, results or metrics.',
  'Hypothetical engineering advice must be explicitly labeled as a suggested approach, not completed work.',
  '[fullstack] Alex builds full-stack applications with React, TypeScript, Node.js, Express, Python and SQL, with experience spanning enterprise applications, healthcare integrations and commerce.',
  "[cloud-stack] Alex's documented cloud stack includes AWS Lambda, API Gateway, S3, DynamoDB and Azure Functions. The portfolio connects this experience to application integrations and automation.",
  '[ai-method] Alex describes an AI engineering approach built around APIs, typed schemas, permissions, evaluations, observability, fallbacks and human review. This describes his published approach, not a verified result for an unnamed customer.',
  'Cite relevant fact IDs in square brackets. Admit missing evidence. No tools are available.',
].join('\n');
export function payload(index) {
  assert(Number.isSafeInteger(index) && index >= 0 && index <= 20);
  return {
    model,
    stream: true,
    think: false,
    keep_alive: '5m',
    messages: [
      { role: 'system', content: context },
      { role: 'user', content: questions[index % 4] },
    ],
    options: { num_ctx: 4096, num_predict: 256, num_thread: 4, temperature: 0, seed: 42 },
  };
}
export function wireRequest(path, body) {
  assert(
    ['/api/version', '/api/tags', '/api/ps', '/api/chat'].includes(path),
    'Unapproved API path',
  );
  assert((path === '/api/chat') === (body !== undefined), 'Incorrect request method');
  const data = body === undefined ? '' : JSON.stringify(body);
  assert(Buffer.byteLength(data) <= 16384, 'Request too large');
  return Buffer.from(
    `${body === undefined ? 'GET' : 'POST'} ${path} HTTP/1.0\r\nHost: 127.0.0.1:11434\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(data)}\r\n\r\n${data}`,
  );
}
// HTTP/1.0 explicitly avoids chunked encoding. Reject unsupported framing, not guess.
export class ResponseParser {
  constructor(onBody) {
    this.onBody = onBody;
    this.pending = Buffer.alloc(0);
    this.bytes = 0;
    this.headers = false;
    this.bodyBytes = 0;
  }
  push(chunk) {
    this.bytes += chunk.length;
    assert(this.bytes <= 524288, 'Response exceeded size limit');
    if (this.headers) {
      this.bodyBytes += chunk.length;
      this.onBody(chunk);
      return;
    }
    this.pending = Buffer.concat([this.pending, chunk]);
    const end = this.pending.indexOf('\r\n\r\n');
    if (end < 0) {
      assert(this.pending.length <= 16384, 'HTTP headers too large');
      return;
    }
    assert(end <= 16384, 'HTTP headers too large');
    const head = this.pending.subarray(0, end).toString('latin1');
    assert(/^HTTP\/1\.[01] 200(?: |\r\n)/.test(head), 'Ollama returned a non-200 HTTP response');
    assert(!/\r\n(?:transfer-encoding|content-encoding):/i.test(head), 'Unsupported HTTP encoding');
    const sizes = [...head.matchAll(/\r\ncontent-length:\s*(\d+)\s*(?=\r\n|$)/gi)];
    assert(sizes.length <= 1, 'Ambiguous content length');
    this.length = sizes.length ? Number(sizes[0][1]) : null;
    this.headers = true;
    const data = this.pending.subarray(end + 4);
    this.pending = Buffer.alloc(0);
    this.bodyBytes += data.length;
    if (data.length) this.onBody(data);
  }
  finish() {
    assert(this.headers, 'Incomplete HTTP response');
    if (this.length !== null) assert.equal(this.bodyBytes, this.length, 'Truncated HTTP body');
  }
}
export class ChatCollector {
  constructor(clock = () => performance.now()) {
    this.clock = clock;
    this.started = clock();
    this.pending = '';
    this.decoder = new TextDecoder('utf-8', { fatal: true });
    this.text = '';
    this.frames = 0;
    this.firstContentMs = null;
    this.done = null;
  }
  push(chunk) {
    this.pending += this.decoder.decode(chunk, { stream: true });
    let end;
    while ((end = this.pending.indexOf('\n')) >= 0) {
      const line = this.pending.slice(0, end).trim();
      this.pending = this.pending.slice(end + 1);
      if (!line) continue;
      assert(line.length <= 32768 && !this.done, 'Invalid stream framing');
      const row = JSON.parse(line);
      assert(
        row && typeof row === 'object' && !Array.isArray(row) && !row.error,
        'Invalid model response',
      );
      assert.equal(row.model, model, 'Unexpected response model');
      assert(
        !row.message?.tool_calls?.length && !row.message?.thinking,
        'Unexpected tools or thinking output',
      );
      const text = row.message?.content;
      assert(text === undefined || typeof text === 'string', 'Invalid text');
      if (text) {
        this.firstContentMs ??= this.clock() - this.started;
        this.text += text;
        this.frames++;
      }
      assert(this.text.length <= 16384, 'Generated text too large');
      if (row.done === true) {
        assert(['stop', 'length'].includes(row.done_reason), 'Unexpected completion reason');
        for (const key of [
          'total_duration',
          'load_duration',
          'prompt_eval_count',
          'prompt_eval_duration',
          'eval_count',
          'eval_duration',
        ])
          assert(Number.isSafeInteger(row[key]) && row[key] >= 0, 'Invalid timing or token metric');
        assert(
          row.eval_count <= 256 && row.prompt_eval_count <= 4096,
          'Requested token bounds not respected',
        );
        this.done = row;
      }
    }
    assert(this.pending.length <= 32768, 'Stream line too large');
  }
  finish() {
    this.pending += this.decoder.decode();
    assert(
      this.done && !this.pending.trim() && this.firstContentMs !== null,
      'Incomplete model response',
    );
    const d = this.done;
    return {
      firstContentMs: this.firstContentMs,
      completionMs: this.clock() - this.started,
      modelLoadMs: d.load_duration / 1e6,
      serverTotalMs: d.total_duration / 1e6,
      promptTokens: d.prompt_eval_count,
      promptEvalMs: d.prompt_eval_duration / 1e6,
      generatedTokens: d.eval_count,
      generationMs: d.eval_duration / 1e6,
      tokensPerSecond: d.eval_duration > 0 ? (d.eval_count * 1e9) / d.eval_duration : null,
      doneReason: d.done_reason,
      truncated: d.done_reason === 'length',
      contentFrames: this.frames,
      answer: this.text,
    };
  }
}
export async function exchange(command, args, request, onBody, signal) {
  signal.throwIfAborted();
  const parser = new ResponseParser(onBody);
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  const terminate = () => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  };
  const closed = new Promise((resolve) => child.once('close', (code) => resolve(code)));
  let failure;
  const abort = () => {
    failure ??= new Error('Request cancelled or deadline exceeded');
    terminate();
  };
  signal.addEventListener('abort', abort, { once: true });
  child.once('error', () => {
    failure ??= new Error('Request transport could not start');
  });
  child.stdin.on('error', () => {
    failure ??= new Error('Request transport closed early');
  });
  child.stderr.resume(); // No infrastructure logs or model output copied to the terminal.
  child.stdout.on('data', (chunk) => {
    try {
      parser.push(chunk);
    } catch (e) {
      failure ??= e;
      terminate();
    }
  });
  child.stdin.end(request);
  try {
    const code = await closed;
    if (failure) throw failure;
    assert.equal(code, 0, 'Request transport failed');
    parser.finish();
  } finally {
    signal.removeEventListener('abort', abort);
    terminate();
  }
}
export function distribution(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  const q = (p) => (v.length ? v[Math.ceil(v.length * p) - 1] : null);
  return { count: v.length, median: q(0.5), p95: q(0.95) };
}
function hostSnapshot() {
  const call = (file, args) => {
    try {
      return execFileSync(file, args, { encoding: 'utf8', timeout: 5000 }).trim();
    } catch {
      return null;
    }
  };
  const fs = statfsSync('/System/Volumes/Data', { bigint: true });
  return {
    recordedAt: new Date().toISOString(),
    freeDiskBytes: Number(fs.bavail * fs.bsize),
    pressureLevel: call('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level']),
    swap: call('/usr/sbin/sysctl', ['-n', 'vm.swapusage']),
    controllerRssBytes: process.memoryUsage().rss,
  };
}
function checkHost(snapshot) {
  assert(snapshot.freeDiskBytes >= 12 * GiB, 'Low disk reserve; test stopped');
  assert(snapshot.controllerRssBytes < 512 * 1024 ** 2, 'Controller memory guard reached');
  if (snapshot.pressureLevel !== null)
    assert.equal(snapshot.pressureLevel, '1', 'Memory pressure is not normal; test stopped');
}
export async function main({ smoke = false } = {}) {
  assert.equal(process.arch, 'arm64', 'Native ARM64 Node required');
  assert.equal(process.platform, smoke ? 'linux' : 'darwin', 'Incorrect benchmark host');
  if (smoke) assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Smoke is restricted to hosted CI');
  const invoke = (args, options = {}) =>
    execFileSync('docker', args, {
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 2 * 1024 ** 2,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    }).trim();
  const contextName = invoke(['context', 'show']);
  const endpoint = JSON.parse(invoke(['context', 'inspect', contextName]))[0].Endpoints?.docker
    ?.Host;
  assert(endpoint?.startsWith('unix:///'), 'Remote Docker endpoint refused');
  const run = (args, options) => invoke(['--context', contextName, ...args], options);
  assert(
    ['linux/aarch64', 'linux/arm64'].includes(
      run(['info', '--format', '{{.OSType}}/{{.Architecture}}']),
    ),
    'ARM64 Docker required',
  );
  const installed = JSON.parse(run(['image', 'inspect', image]))[0];
  assert(
    installed.Architecture === 'arm64' &&
      installed.Os === 'linux' &&
      installed.RepoDigests?.includes(image),
    'Pinned image required',
  );
  const storage = JSON.parse(run(['volume', 'inspect', volume]))[0];
  assert(
    storage.Labels?.['io.alext.benchmark'] === 'qwen35-2b-v1' &&
      storage.Driver === 'local' &&
      Object.keys(storage.Options ?? {}).length === 0,
    'Owned plain local model volume required',
  );
  assert.equal(run(['ps', '-aq', '--filter', `volume=${volume}`]), '', 'Model volume is in use');
  const report = {
    kind: 'raw-ollama-container-benchmark',
    model,
    modelDigest: approvedModelManifest,
    image,
    scriptSha256: createHash('sha256')
      .update(readFileSync(new URL(import.meta.url)))
      .digest('hex'),
    status: 'pending',
    inferenceAttempted: false,
    samples: [],
    hostSnapshots: [],
    memorySamples: [],
    limits: {
      memoryBytes: 4 * GiB,
      cpuEquivalents: 4,
      contextTokens: 4096,
      outputTokens: 256,
      simultaneousGenerations: 1,
    },
    limitations: [
      'Raw runtime only, not the production gateway, classification, retrieval, validated SSE or public edge.',
      'First-content and completion timing include Docker exec/pipe overhead and host scheduling. A content frame is not necessarily one token.',
      'First sample starts with no resident model. File caches are not flushed and hash verification warms the file cache.',
      'Twenty warm requests yield exploratory percentiles, not a production p95 guarantee. Prompt caching can benefit repeated prompts.',
      'Cgroup memory includes model, filesystem cache and relay processes, not total Mac RAM. Node controller RSS is separate.',
      'No concurrent visitor, overload, manual quality, UI, restart recovery or native Metal comparison is performed.',
    ],
  };
  if (!smoke) {
    report.hostSnapshots.push(hostSnapshot());
    checkHost(report.hostSnapshots[0]);
  }
  const controller = new AbortController();
  const interrupted = () => controller.abort();
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  const timeout = setTimeout(interrupted, 20 * 60 * 1000);
  let id;
  let watch;
  let watchError;
  let failure;
  const request = async (path, body, onBody) => {
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(path === '/api/chat' ? 90000 : 10000),
    ]);
    return exchange(
      'docker',
      ['--context', contextName, 'exec', '-i', id, '/bin/bash', '-ec', relay],
      wireRequest(path, body),
      onBody,
      signal,
    );
  };
  const json = async (path) => {
    const chunks = [];
    await request(path, undefined, (c) => chunks.push(c));
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  };
  const memory = () => {
    const text = run(
      [
        'exec',
        id,
        '/bin/sh',
        '-ec',
        "cat /sys/fs/cgroup/memory.current; cat /sys/fs/cgroup/memory.peak; cat /sys/fs/cgroup/memory.events; cat /sys/fs/cgroup/memory.stat | grep -E '^(anon|file) '",
      ],
      { timeout: 5000 },
    );
    const lines = text.split('\n');
    const fields = Object.fromEntries(
      lines
        .slice(2)
        .map((l) => l.split(/\s+/))
        .map(([k, v]) => [k, Number(v)]),
    );
    const value = {
      recordedAt: Date.now(),
      currentBytes: Number(lines[0]),
      peakBytes: Number(lines[1]),
      ...fields,
    };
    assert(
      Number.isSafeInteger(value.currentBytes) && Number.isSafeInteger(value.peakBytes),
      'Cgroup memory counters missing',
    );
    assert(!value.oom && !value.oom_kill, 'Container memory limit hit');
    report.memorySamples.push(value);
  };
  try {
    const args = containerArgs(`alext-bench-${randomUUID()}`, 'none', { readOnlyModels: true });
    id = run(args);
    assert(/^[a-f0-9]{64}$/.test(id), 'Invalid created container ID');
    verifyContainer(JSON.parse(run(['inspect', id]))[0], 'none', { readOnlyModels: true });
    run(['start', id]);
    let ready = false;
    for (let i = 0; i < 30; i++) {
      controller.signal.throwIfAborted();
      assert(
        JSON.parse(run(['inspect', id]))[0].State.Running,
        'Isolated Ollama exited before readiness',
      );
      try {
        run(['exec', id, '/bin/ollama', 'list'], { timeout: 2000 });
        ready = true;
        break;
      } catch {}
      await sleep(500);
    }
    assert(ready, 'Isolated Ollama readiness timed out');
    const version = await json('/api/version');
    assert.equal(version.version, '0.40.4', 'Unexpected Ollama version');
    assert.deepEqual(
      (await json('/api/ps')).models,
      [],
      'Expected empty model residency before first request',
    );
    if (smoke) {
      assert(Array.isArray((await json('/api/tags')).models));
      report.status = 'offline-http-smoke-passed';
    } else {
      report.integrity = verifyStoredModel(run, id);
      const target = (await json('/api/tags')).models?.find((m) => m.name === model);
      assert(
        target &&
          target.digest.replace(/^sha256:/, '') === approvedModelManifest &&
          !target.remote_host,
        'Active API model digest mismatch',
      );
      memory();
      console.log(
        'Running 1 unloaded-model request and 20 warm requests. Ctrl+C stops only this test.',
      );
      console.log(
        'Keep Activity Monitor visible. Stop with Ctrl+C if the Mac becomes uncomfortable to use.',
      );
      watch = setInterval(() => {
        try {
          const state = hostSnapshot();
          checkHost(state);
          report.hostSnapshots.push(state);
          memory();
        } catch (e) {
          watchError = e;
          controller.abort();
        }
      }, 5000);
      for (let index = 0; index <= 20; index++) {
        controller.signal.throwIfAborted();
        const state = hostSnapshot();
        checkHost(state);
        report.hostSnapshots.push(state);
        if (index > 0) {
          const resident = (await json('/api/ps')).models?.find(
            (m) => m.name === model || m.model === model,
          );
          assert(resident, 'Warm sample lost model residency');
          assert.equal(
            resident.digest.replace(/^sha256:/, ''),
            approvedModelManifest,
            'Resident model digest mismatch',
          );
          assert.equal(resident.size_vram, 0, 'Unexpected GPU execution');
          assert.equal(resident.context_length, 4096, 'Unexpected resident context length');
          report.residentModel = resident;
        }
        const collector = new ChatCollector();
        report.inferenceAttempted = true;
        await request('/api/chat', payload(index), (chunk) => collector.push(chunk));
        const sample = {
          index,
          phase: index === 0 ? 'unloaded-model' : 'warm',
          ...collector.finish(),
        };
        report.samples.push(sample);
        memory();
        console.log(
          JSON.stringify({
            sample: index + 1,
            total: 21,
            phase: sample.phase,
            firstContentMs: Math.round(sample.firstContentMs),
            completionMs: Math.round(sample.completionMs),
            tokensPerSecond: sample.tokensPerSecond,
            truncated: sample.truncated,
          }),
        );
      }
      report.status = 'benchmark-completed';
    }
  } catch (e) {
    failure = watchError ?? e;
    report.status = 'stopped';
    report.error =
      failure?.code === 'ERR_ASSERTION'
        ? failure.message.split('\n')[0]
        : 'Benchmark interrupted or failed; no production change';
  } finally {
    clearTimeout(timeout);
    clearInterval(watch);
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
    if (id && /^[a-f0-9]{64}$/.test(id)) {
      try {
        const current = JSON.parse(run(['inspect', id]))[0];
        report.oomKilled = current.State.OOMKilled;
        assert.equal(
          current.Config.Labels?.['io.alext.benchmark'],
          'qwen35-2b-v1',
          'Cleanup ownership mismatch',
        );
        try {
          run(['stop', '--time=5', id]);
        } catch {}
        run(['rm', '--force', id]);
        report.temporaryContainerRemoved = true;
      } catch {
        report.temporaryContainerRemoved = false;
        report.status = 'cleanup-needed';
        failure ??= new Error('Scoped cleanup failed');
      }
    }
  }
  const warm = report.samples.filter((s) => s.phase === 'warm');
  report.warm = {
    firstContentMs: distribution(warm.map((s) => s.firstContentMs)),
    completionMs: distribution(warm.map((s) => s.completionMs)),
    tokensPerSecond: distribution(warm.map((s) => s.tokensPerSecond)),
  };
  report.peakContainerMemoryBytes = report.memorySamples.length
    ? Math.max(...report.memorySamples.map((m) => m.peakBytes))
    : null;
  report.recordedAt = new Date().toISOString();
  if (!smoke) {
    report.hostSnapshots.push(hostSnapshot());
    const file = join(
      homedir(),
      'Downloads',
      `alext-inference-benchmark-${report.recordedAt.replace(/[:.]/g, '-')}.json`,
    );
    writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log(`Private detailed report: ${file}`);
  }
  console.log('\n== Isolated inference benchmark summary ==');
  console.log(
    JSON.stringify(
      {
        status: report.status,
        error: report.error,
        model,
        modelDigest: approvedModelManifest,
        inferenceAttempted: report.inferenceAttempted,
        completedSamples: report.samples.length,
        cold: report.samples[0] ? { ...report.samples[0], answer: undefined } : null,
        warm: report.warm,
        peakContainerMemoryBytes: report.peakContainerMemoryBytes,
        temporaryContainerRemoved: report.temporaryContainerRemoved,
        oomKilled: report.oomKilled,
        publicPortsPublished: false,
        nativeOllamaChanged: false,
      },
      null,
      2,
    ),
  );
  if (failure) throw new Error('Benchmark stopped; review the summary before continuing');
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert(['--run', '--smoke'].includes(process.argv[2]), 'Use --run on the approved Mac mini');
    await main({ smoke: process.argv[2] === '--smoke' });
  } catch (e) {
    console.error(
      `STOP: ${e?.code === 'ERR_ASSERTION' ? e.message.split('\n')[0] : 'Benchmark did not complete; retain the model volume and do not prune Docker.'}`,
    );
    process.exitCode = 1;
  }
}
