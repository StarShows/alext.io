import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';

export interface Config {
  origin: string;
  publicHost: string;
  host: string;
  port: number;
  trustedProxy: string;
  ollamaUrl: string;
  model: string;
  modelDigest: string;
  turnstileSecret: string;
  concurrency: number;
  queueSize: number;
  queueWaitMs: number;
  requestTimeoutMs: number;
  sessionTtlMs: number;
  sessionCapacity: number;
  maxTurns: number;
  maxOutputTokens: number;
  contextTokens: number;
  logLevel: 'info' | 'warn' | 'error';
}
function integer(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number) {
  const value = env[key] === undefined ? fallback : Number(env[key]);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
  return value;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const native = env.AI_RUNTIME === 'native-approved';
  if (native && env.NATIVE_RUNTIME_APPROVED !== 'true')
    throw new Error('Native runtime needs approval');
  const ollamaUrl = env.OLLAMA_URL ?? (native ? 'http://127.0.0.1:11434' : 'http://ollama:11434');
  const expected = native ? 'http://127.0.0.1:11434' : 'http://ollama:11434';
  if (ollamaUrl !== expected)
    throw new Error('Only the fixed private inference address is allowed');
  const model = env.OLLAMA_MODEL ?? '';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{1,79}$/.test(model) || /cloud/i.test(model))
    throw new Error('Set a local model');
  const modelDigest = env.OLLAMA_MODEL_DIGEST ?? '';
  if (!/^(sha256:)?[a-f0-9]{64}$/.test(modelDigest))
    throw new Error('Pin the approved model digest');
  const secretPath = env.TURNSTILE_SECRET_FILE;
  if (!secretPath) throw new Error('TURNSTILE_SECRET_FILE is required');
  const turnstileSecret = readFileSync(secretPath, 'utf8').trim();
  if (
    turnstileSecret.length < 20 ||
    turnstileSecret.length > 256 ||
    /[\r\n]/.test(turnstileSecret) ||
    turnstileSecret.startsWith('1x000') ||
    turnstileSecret.startsWith('2x000') ||
    turnstileSecret.startsWith('3x000')
  )
    throw new Error('A production Turnstile secret is required');
  const trustedProxy = env.TRUSTED_TUNNEL_IP ?? (native ? '127.0.0.1' : '10.97.0.2');
  if (!isIP(trustedProxy)) throw new Error('Use one exact trusted connector IP');
  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!['info', 'warn', 'error'].includes(logLevel)) throw new Error('Invalid log level');
  return {
    origin: 'https://alext.io',
    publicHost: 'ai.alext.io',
    host: native ? '127.0.0.1' : '0.0.0.0',
    port: integer(env, 'PORT', 18080, 1024, 65535),
    trustedProxy,
    ollamaUrl,
    model,
    modelDigest,
    turnstileSecret,
    concurrency: integer(env, 'INFERENCE_CONCURRENCY', 1, 1, 2),
    queueSize: integer(env, 'INFERENCE_QUEUE_SIZE', 2, 0, 4),
    queueWaitMs: integer(env, 'QUEUE_WAIT_MS', 5000, 500, 10000),
    requestTimeoutMs: integer(env, 'REQUEST_TIMEOUT_MS', 60000, 10000, 90000),
    sessionTtlMs: 15 * 60 * 1000,
    sessionCapacity: 1000,
    maxTurns: 20,
    maxOutputTokens: integer(env, 'MAX_OUTPUT_TOKENS', 600, 128, 1200),
    contextTokens: integer(env, 'CONTEXT_TOKENS', 8192, 4096, 8192),
    logLevel: logLevel as Config['logLevel'],
  };
}
