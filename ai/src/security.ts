import { createHmac, randomBytes, createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { Config } from './config.js';
import type { VerifyHuman } from './types.js';

const messages = {
  INVALID_REQUEST: 'Please send a shorter, valid message.',
  FORBIDDEN: 'This request is not permitted.',
  SESSION_REQUIRED: 'Please start a new verified conversation.',
  RATE_LIMITED: 'Please pause before sending another message.',
  BUSY: 'The assistant is busy. Please try again shortly.',
  UNAVAILABLE:
    "The assistant is temporarily unavailable. Alex's projects and contact links are still available.",
  NOT_FOUND: 'This endpoint is not available.',
  CANCELLED: 'The response was stopped.',
} as const;
export class ApiError extends Error {
  constructor(
    public readonly code: keyof typeof messages,
    public readonly status: number,
  ) {
    super(messages[code]);
  }
}
export function safeError(error: unknown) {
  if (error instanceof ApiError) return error;
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
    return new ApiError('UNAVAILABLE', 503);
  return new ApiError('UNAVAILABLE', 503);
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function normalizeInput(input: string): string {
  const value = input.normalize('NFKC').trim();
  if (
    !value ||
    value.length > 2000 ||
    Buffer.byteLength(value) > 6000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)
  )
    throw new ApiError('INVALID_REQUEST', 400);
  return value;
}
export function canonicalIp(ip: string): string {
  if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) return ip.slice(7);
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) !== 6) throw new ApiError('FORBIDDEN', 403);
  // Group IPv6 clients by /64 so address rotation does not mint fresh quotas.
  let normalized = ip.toLowerCase();
  if (normalized.includes('.')) {
    const last = normalized.lastIndexOf(':');
    const octets = normalized
      .slice(last + 1)
      .split('.')
      .map(Number);
    normalized =
      normalized.slice(0, last + 1) +
      (((octets[0] ?? 0) << 8) + (octets[1] ?? 0)).toString(16) +
      ':' +
      (((octets[2] ?? 0) << 8) + (octets[3] ?? 0)).toString(16);
  }
  const halves = normalized.split('::');
  const left = (halves[0] ?? '').split(':').filter(Boolean);
  const right = (halves[1] ?? '').split(':').filter(Boolean);
  const parts =
    halves.length === 2
      ? [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right]
      : left;
  return (
    parts
      .slice(0, 4)
      .map((part) => part.padStart(4, '0'))
      .join(':') + '::/64'
  );
}
export function identityHasher() {
  const salt = randomBytes(32);
  return (ip: string) => createHmac('sha256', salt).update(canonicalIp(ip)).digest('hex');
}
export function peerMatches(peer: string | undefined, expected: string) {
  return (peer?.replace(/^::ffff:/, '') ?? '') === expected;
}
export function hardRefusal(question: string): boolean {
  return [
    /(?:ignore|override|disregard).{0,35}(?:previous|system|instructions|rules)/i,
    /(?:reveal|print|dump|show|repeat|encode).{0,50}(?:system prompt|hidden instructions|secret keys|private keys|environment variables|internal knowledge files)/i,
    /(?:write|compose).{0,15}(?:college essay|bedtime story|erotic|poem)/i,
    /(?:complete|entire|full).{0,12}(?:unrelated application|homework assignment)/i,
    /(?:alex.{0,30}(?:home address|medical history|sexual orientation|salary)|(?:home address|medical history|sexual orientation).{0,30}alex)/i,
    /(?:steal credentials|deploy malware|exfiltrat|scan (?:your|the home) network)/i,
    /<\|(?:system|assistant|im_start)|\[INST\]|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/i,
  ].some((pattern) => pattern.test(question));
}
export function unsupportedAchievement(question: string) {
  return /(?:certifications?|certified|ph\.?d|college degree|how many years|\d+\s*(?:million|billion|percent|%)|guarantee.{0,15}(?:hiring|savings|roi))/i.test(
    question,
  );
}
export function makeTurnstileVerifier(config: Config, request: typeof fetch = fetch): VerifyHuman {
  const used = new Map<string, number>();
  return async (token, ip, signal) => {
    const now = Date.now();
    for (const [key, expires] of used) if (expires <= now) used.delete(key);
    const key = digest(token);
    if (!token || token.length > 2048 || used.has(key) || used.size >= 2000) return false;
    // Reserve before the network call. Concurrent replays fail closed.
    used.set(key, now + 300000);
    try {
      const response = await request('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: config.turnstileSecret, response: token, remoteip: ip }),
      });
      if (!response.ok || !response.body) return false;
      let text = '';
      const reader = response.body.getReader();
      try {
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          text += new TextDecoder().decode(item.value);
          if (text.length > 8192) {
            await reader.cancel();
            return false;
          }
        }
      } finally {
        reader.releaseLock();
      }
      const result = JSON.parse(text) as Record<string, unknown>;
      const when = typeof result.challenge_ts === 'string' ? Date.parse(result.challenge_ts) : NaN;
      return (
        result.success === true &&
        result.hostname === new URL(config.origin).hostname &&
        result.action === 'portfolio_session' &&
        Number.isFinite(when) &&
        now - when <= 300000 &&
        when - now <= 30000
      );
    } catch {
      return false;
    }
  };
}
