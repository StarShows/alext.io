import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { loadConfig } from '../dist/config.js';
import { loadKnowledge } from '../dist/knowledge.js';
import { OllamaService } from '../dist/ollama.js';
import { AssistantEngine, REFUSAL, MISSING } from '../dist/engine.js';
import { InferenceGate } from '../dist/queue.js';
import { performance } from 'node:perf_hooks';

// This runs against the configured LOCAL model. There is deliberately no mock or cloud mode.
const config = loadConfig();
const model = new OllamaService(config);
const knowledge = loadKnowledge();
const engine = new AssistantEngine(model, knowledge, new InferenceGate(1, 0, 1000));
const dataset = JSON.parse(
  await readFile(new URL('../knowledge/evaluation.json', import.meta.url), 'utf8'),
);
const results = [];
try {
  if (!(await model.ready(AbortSignal.timeout(5000))))
    throw new Error('Pinned local model is not available');
  for (const item of dataset.cases) {
    const start = performance.now();
    const blocks = [];
    let error = null;
    const session = {
      expiresAt: Date.now() + 900000,
      identity: 'offline-evaluation',
      origin: config.origin,
      turns: 0,
      busy: false,
      history: item.history
        ? [
            { role: 'user', content: item.history },
            { role: 'assistant', content: 'A conditional engineering approach was discussed.' },
          ]
        : [],
    };
    try {
      for await (const block of engine.respond(
        item.prompt,
        'hiring-manager',
        session,
        AbortSignal.timeout(config.requestTimeoutMs),
      ))
        blocks.push(block);
    } catch {
      error = 'generation_or_validation_failure';
    }
    const text = blocks.map((block) => block.text).join('\n');
    const expected = item.expect;
    const checks = {
      completed: !error && blocks.length > 0,
      expectedClass:
        expected === 'refusal'
          ? text.includes(REFUSAL)
          : expected === 'missing'
            ? text.includes(MISSING)
            : expected === 'approach'
              ? blocks.some((block) => block.kind === 'approach')
              : expected === 'evidence'
                ? blocks.some((block) => block.kind === 'evidence')
                : expected === 'contact'
                  ? blocks.some((block) =>
                      block.citations.some((citation) => citation.id === 'contact'),
                    )
                  : !text.includes(REFUSAL),
      exactEvidence:
        !item.evidence ||
        blocks.some((block) =>
          block.text.includes(
            knowledge.facts.find((fact) => fact.id === item.evidence)?.text ?? 'MISSING_FACT_ID',
          ),
        ),
      citationIntegrity: blocks
        .filter((block) => block.kind === 'evidence')
        .every(
          (block) =>
            block.citations.length > 0 &&
            block.citations.every((citation) =>
              knowledge.facts.some((fact) => fact.source.url === citation.url),
            ),
        ),
    };
    results.push({
      id: item.id,
      category: item.category,
      prompt: item.prompt,
      expected,
      checks,
      pass: Object.values(checks).every(Boolean),
      elapsedMs: performance.now() - start,
      error,
      blocks,
      humanReview: null,
    });
    console.log(JSON.stringify({ case: item.id, pass: results.at(-1).pass }));
  }
} finally {
  model.close();
}
await mkdir(new URL('../reports/', import.meta.url), { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  kind: 'real-local-model-evaluation',
  model: config.model,
  modelDigest: config.modelDigest,
  knowledgeRevision: knowledge.revision,
  cases: results.length,
  passed: results.filter((item) => item.pass).length,
  humanReviewComplete: false,
  results,
};
await writeFile(
  new URL('../reports/evaluation.json', import.meta.url),
  JSON.stringify(report, null, 2),
);
console.log(
  `Deterministic cases: ${report.passed}/${report.cases}. Human review of correctness and relevance is still required.`,
);
if (report.passed !== report.cases) process.exitCode = 1;
