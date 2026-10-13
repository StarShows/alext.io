import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { loadConfig } from '../dist/config.js';
import { loadKnowledge } from '../dist/knowledge.js';
import { OllamaService } from '../dist/ollama.js';
import { AssistantEngine } from '../dist/engine.js';
import { InferenceGate } from '../dist/queue.js';
const config = loadConfig(); const model = new OllamaService(config); const knowledge = loadKnowledge();
const engine = new AssistantEngine(model, knowledge, new InferenceGate(config.concurrency, config.queueSize, config.queueWaitMs));
const samples = [];
const prompts = ['Why should we hire Alex?', 'What AWS integrations has Alex built?', 'How would Alex implement secure RAG for company documents?', 'How would Alex approach his first 90 days on our engineering team?'];
async function sample(index, phase, concurrency) {
  const started = performance.now(); let firstBlockMs = null; let modelStats = null; let blocks = 0; let error = null;
  try {
    const session = { expiresAt: Date.now() + 900000, identity: `benchmark-${index}`, origin: config.origin, turns: 0, busy: false, history: [] };
    for await (const _block of engine.respond(prompts[index % prompts.length], 'hiring-manager', session, AbortSignal.timeout(config.requestTimeoutMs), (name, value) => { if (name === 'firstBlockMs') firstBlockMs = value; else modelStats = value; })) blocks++;
  } catch { error = 'bounded_rejection_or_generation_failure'; }
  const record = { index, phase, concurrency, blocks, firstBlockMs, totalMs: performance.now() - started, modelStats, error, gatewayProcessRssBytes: process.memoryUsage().rss }; samples.push(record);
  console.log(JSON.stringify({ phase, index, totalMs: record.totalMs, firstBlockMs, error }));
}
function distribution(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const q = (fraction) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
  return { samples: sorted.length, median: q(0.5), p95: q(0.95) };
}
try {
  if (!await model.ready(AbortSignal.timeout(5000))) throw new Error('Pinned local model is unavailable');
  // No automatic model unloading, system restart or power changes. Owner controls cold-start setup.
  await sample(0, 'first-call-uncontrolled-residency', 1);
  for (let index = 1; index <= 20; index++) await sample(index, 'warm-sequential', 1);
  for (const count of [2, 4]) for (let repetition = 0; repetition < 3; repetition++) await Promise.all(Array.from({ length: count }, (_, offset) => sample(100 + count * repetition + offset, `burst-${count}`, count)));
} finally { model.close(); }
const warm = samples.filter((sample) => sample.phase === 'warm-sequential' && !sample.error);
const report = {
  kind: 'real-local-model-benchmark', generatedAt: new Date().toISOString(), model: config.model, modelDigest: config.modelDigest, knowledgeRevision: knowledge.revision,
  runtime: process.env.AI_RUNTIME ?? 'container', rawFirstTokenMs: distribution(warm.map((sample) => sample.modelStats?.firstTokenMs)),
  validatedFirstBlockMs: distribution(warm.map((sample) => sample.firstBlockMs)), completionMs: distribution(warm.map((sample) => sample.totalMs)),
  tokensPerSecond: distribution(warm.map((sample) => sample.modelStats?.generationMs > 0 ? 1000 * sample.modelStats.generatedTokens / sample.modelStats.generationMs : NaN)),
  limitations: ['Raw first-token timing excludes the classification pass. Validated first-block timing includes classification and output checks.', 'First call is not proven cold without separate owner-controlled unload evidence.', 'Gateway RSS is not Mac total RAM or Ollama RAM. Record host memory pressure and docker stats separately.', 'No automatic restart test or public edge latency measurement is performed by this script.', 'Twenty warm samples are exploratory, not a statistically strong p95 guarantee.'], samples,
};
await mkdir(new URL('../reports/', import.meta.url), { recursive: true });
await writeFile(new URL('../reports/benchmark.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ rawFirstTokenMs: report.rawFirstTokenMs, validatedFirstBlockMs: report.validatedFirstBlockMs, completionMs: report.completionMs, tokensPerSecond: report.tokensPerSecond }, null, 2));
