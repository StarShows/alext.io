import http from 'node:http';
import { performance } from 'node:perf_hooks';
import type { Config } from './config.js';
import type { AnswerInput, Decision, InferenceService, Message, ModelChunk } from './types.js';
import { ApiError } from './security.js';
import { ANSWER_PROMPT, CLASSIFIER_PROMPT, answerSchema, decisionSchema } from './prompts.js';

export function validateDecision(value: unknown): Decision {
  if (!value || typeof value !== 'object') throw new ApiError('UNAVAILABLE', 503);
  const item = value as Decision;
  if (
    Object.keys(item).sort().join(',') !== 'confidence,intent,scope' ||
    !['professional', 'unrelated', 'unsafe'].includes(item.scope) ||
    !['experience', 'project', 'approach', 'contact', 'out-of-scope'].includes(item.intent) ||
    typeof item.confidence !== 'number' ||
    !Number.isFinite(item.confidence) ||
    item.confidence < 0 ||
    item.confidence > 1
  )
    throw new ApiError('UNAVAILABLE', 503);
  return item;
}
export class OllamaService implements InferenceService {
  private readonly agent: http.Agent;
  constructor(private readonly config: Config) {
    this.agent = new http.Agent({
      keepAlive: true,
      maxSockets: config.concurrency + 1,
      maxFreeSockets: 2,
      timeout: 10000,
    });
  }
  private async request(
    path: '/api/chat' | '/api/tags',
    body: unknown | undefined,
    signal: AbortSignal,
  ) {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const url = new URL(path, this.config.ollamaUrl);
    return new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.request(
        url,
        {
          method: data ? 'POST' : 'GET',
          agent: this.agent,
          signal,
          headers: data
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
            : {},
        },
        (response) => {
          if (response.statusCode !== 200) {
            response.destroy();
            reject(new ApiError('UNAVAILABLE', 503));
            return;
          }
          resolve(response);
        },
      );
      req.once('error', reject);
      req.end(data);
    });
  }
  private async json(
    path: '/api/chat' | '/api/tags',
    body: unknown | undefined,
    signal: AbortSignal,
    limit = 131072,
  ): Promise<Record<string, unknown>> {
    const response = await this.request(path, body, signal);
    let size = 0;
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of response) {
        const buffer = Buffer.from(chunk as Uint8Array);
        size += buffer.length;
        if (size > limit) throw new ApiError('UNAVAILABLE', 503);
        chunks.push(buffer);
      }
      const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!result || typeof result !== 'object' || Array.isArray(result))
        throw new ApiError('UNAVAILABLE', 503);
      return result as Record<string, unknown>;
    } finally {
      response.destroy();
    }
  }
  private payload(
    system: string,
    content: unknown,
    schema: object,
    stream: boolean,
    tokens: number,
  ) {
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(content) },
    ];
    // Conservative byte-based token upper bound; never silently truncate system policy.
    if (Buffer.byteLength(JSON.stringify(messages)) > this.config.contextTokens - tokens - 768)
      throw new ApiError('INVALID_REQUEST', 400);
    return {
      model: this.config.model,
      messages,
      stream,
      format: schema,
      think: false,
      keep_alive: '5m',
      options: {
        temperature: 0,
        num_predict: tokens,
        num_ctx: this.config.contextTokens,
        seed: 42,
      },
    };
  }
  async classify(question: string, history: Message[], signal: AbortSignal) {
    const previous = history
      .filter((item) => item.role === 'user')
      .slice(-1)
      .map((item) => item.content.slice(0, 600));
    const result = await this.json(
      '/api/chat',
      this.payload(CLASSIFIER_PROMPT, { question, previous }, decisionSchema, false, 96),
      signal,
      16384,
    );
    if (result.done !== true || result.done_reason === 'length')
      throw new ApiError('UNAVAILABLE', 503);
    const message = result.message as { content?: unknown } | undefined;
    if (typeof message?.content !== 'string' || message.content.length > 1000)
      throw new ApiError('UNAVAILABLE', 503);
    return validateDecision(JSON.parse(message.content));
  }
  async *answer(input: AnswerInput, signal: AbortSignal): AsyncGenerator<ModelChunk> {
    const content = {
      ...input,
      facts: input.facts.map(({ id, text, provenance }) => ({ id, text, provenance })),
      history: [...input.history],
    };
    let body: ReturnType<OllamaService['payload']>;
    while (true) {
      try {
        body = this.payload(
          ANSWER_PROMPT,
          content,
          answerSchema,
          true,
          this.config.maxOutputTokens,
        );
        break;
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'INVALID_REQUEST') throw error;
        if (content.history.length) content.history.splice(0, 2);
        else if (content.facts.length > 1) content.facts.pop();
        else throw error;
      }
    }
    const start = performance.now();
    let firstTokenMs = -1;
    let bytes = 0;
    let pending = '';
    let finished = false;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const response = await this.request('/api/chat', body, signal);
    try {
      for await (const chunk of response) {
        const buffer = Buffer.from(chunk as Uint8Array);
        bytes += buffer.length;
        if (bytes > 262144) throw new ApiError('UNAVAILABLE', 503);
        pending += decoder.decode(buffer, { stream: true });
        if (pending.length > 32768) throw new ApiError('UNAVAILABLE', 503);
        let newline: number;
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline).trim();
          pending = pending.slice(newline + 1);
          if (!line) continue;
          if (finished) throw new ApiError('UNAVAILABLE', 503);
          const item = JSON.parse(line) as Record<string, unknown>;
          if (item.error) throw new ApiError('UNAVAILABLE', 503);
          const message = item.message as { content?: unknown; tool_calls?: unknown } | undefined;
          if (message?.tool_calls) throw new ApiError('UNAVAILABLE', 503);
          if (typeof message?.content === 'string' && message.content) {
            if (firstTokenMs < 0) firstTokenMs = performance.now() - start;
            yield { text: message.content };
          }
          if (item.done === true) {
            if (item.done_reason !== 'stop') throw new ApiError('UNAVAILABLE', 503);
            finished = true;
            const number = (key: string) =>
              typeof item[key] === 'number' && Number.isFinite(item[key])
                ? Math.max(0, item[key] as number)
                : 0;
            yield {
              stats: {
                firstTokenMs: Math.max(firstTokenMs, 0),
                totalMs: performance.now() - start,
                loadMs: number('load_duration') / 1e6,
                generatedTokens: number('eval_count'),
                generationMs: number('eval_duration') / 1e6,
              },
            };
          }
        }
      }
      pending += decoder.decode();
      if (!finished || pending.trim()) throw new ApiError('UNAVAILABLE', 503);
    } finally {
      response.destroy();
    }
  }
  async ready(signal: AbortSignal) {
    try {
      const result = await this.json('/api/tags', undefined, signal);
      if (!Array.isArray(result.models)) return false;
      const target = result.models.find(
        (item: unknown) =>
          !!item &&
          typeof item === 'object' &&
          (item as Record<string, unknown>).name === this.config.model,
      ) as Record<string, unknown> | undefined;
      return (
        !!target &&
        !target.remote_host &&
        !target.remote_model &&
        String(target.digest).replace(/^sha256:/, '') ===
          this.config.modelDigest.replace(/^sha256:/, '')
      );
    } catch {
      return false;
    }
  }
  close() {
    this.agent.destroy();
  }
}
