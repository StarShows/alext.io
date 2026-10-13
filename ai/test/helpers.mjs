import { loadKnowledge } from '../dist/knowledge.js';
export const config = {
  origin: 'https://alext.io', publicHost: 'ai.alext.io', host: '127.0.0.1', port: 18080,
  trustedProxy: '10.97.0.2', ollamaUrl: 'http://ollama:11434', model: 'fixture:1b', modelDigest: 'a'.repeat(64),
  turnstileSecret: 'fixture-secret-never-used-in-production', concurrency: 1, queueSize: 2, queueWaitMs: 100,
  requestTimeoutMs: 10000, sessionTtlMs: 900000, sessionCapacity: 1000, maxTurns: 20, maxOutputTokens: 600, contextTokens: 8192, logLevel: 'error',
};
export const headers = { host: config.publicHost, origin: config.origin, 'cf-connecting-ip': '203.0.113.7', 'content-type': 'application/json' };
export const knowledge = () => loadKnowledge();
export function fixtureModel(overrides = {}) {
  return {
    async ready() { return true; },
    async classify(question) { return { scope: 'professional', intent: /architect|would|90.day|adopt|moderniz/i.test(question) ? 'approach' : /contact|interview/i.test(question) ? 'contact' : 'experience', confidence: 0.99 }; },
    async *answer(input) {
      const blocks = input.intent === 'approach'
        ? [{ kind: 'approach', ids: [], text: 'Start with one bounded workflow. Measure retrieval accuracy, permission failures and latency before expanding access. Keep a human approval step for consequential actions.' }]
        : [{ kind: 'evidence', ids: [input.facts[0].id], text: '' }];
      const result = JSON.stringify({ blocks });
      for (let index = 0; index < result.length; index += 7) yield { text: result.slice(index, index + 7) };
      yield { stats: { firstTokenMs: 1, totalMs: 2, loadMs: 0, generatedTokens: 30, generationMs: 1 } };
    },
    close() {}, ...overrides,
  };
}
export function inject(app, options) {
  const normalized = Object.fromEntries(Object.entries(options.headers ?? headers).filter(([, value]) => value !== undefined));
  if (options.method === 'DELETE' && options.payload === undefined) delete normalized['content-type'];
  return app.inject({ remoteAddress: config.trustedProxy, ...options, headers: normalized });
}
export async function sessionToken(app, extra = {}) {
  const response = await inject(app, { method: 'POST', url: '/v1/session', payload: { consent: true, turnstileToken: 'fixture-token' }, ...extra });
  if (response.statusCode !== 201) throw new Error(`Fixture session failed: ${response.body}`);
  return response.json().token;
}
