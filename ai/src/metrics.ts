import type { ModelStats } from './types.js';
export class Metrics {
  private readonly counts: Record<string, number> = Object.create(null) as Record<string, number>;
  private readonly samples = new Map<string, number[]>();
  increment(
    name:
      | 'requests'
      | 'errors'
      | 'rateLimited'
      | 'sessions'
      | 'completed'
      | 'cancelled'
      | 'modelUnavailable',
  ) {
    this.counts[name] = (this.counts[name] ?? 0) + 1;
  }
  observe(
    name:
      | 'requestMs'
      | 'firstBlockMs'
      | 'firstTokenMs'
      | 'completionMs'
      | 'loadMs'
      | 'tokensPerSecond',
    value: number,
  ) {
    if (!Number.isFinite(value) || value < 0) return;
    const values = this.samples.get(name) ?? [];
    values.push(value);
    if (values.length > 256) values.shift();
    this.samples.set(name, values);
  }
  model(stats: ModelStats) {
    this.observe('firstTokenMs', stats.firstTokenMs);
    this.observe('completionMs', stats.totalMs);
    this.observe('loadMs', stats.loadMs);
    if (stats.generationMs > 0)
      this.observe('tokensPerSecond', (1000 * stats.generatedTokens) / stats.generationMs);
  }
  snapshot(extra: object = {}) {
    const distributions = Object.fromEntries(
      [...this.samples].map(([name, values]) => {
        const sorted = [...values].sort((a, b) => a - b);
        const percentile = (fraction: number) =>
          sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
        return [name, { samples: sorted.length, median: percentile(0.5), p95: percentile(0.95) }];
      }),
    );
    return {
      counters: { ...this.counts },
      distributions,
      process: {
        uptimeSeconds: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
      },
      ...extra,
    };
  }
}
