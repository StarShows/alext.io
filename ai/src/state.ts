import { randomBytes } from 'node:crypto';
import { ApiError, digest } from './security.js';
import type { Session, Message } from './types.js';

export class RateLimiter {
  private readonly buckets = new Map<string, { count: number; reset: number }>();
  constructor(
    private readonly capacity = 10000,
    private readonly now = Date.now,
  ) {}
  take(key: string, limit: number, windowMs: number) {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.reset <= now) {
      if (this.buckets.size >= this.capacity) this.sweep();
      if (!this.buckets.has(key) && this.buckets.size >= this.capacity)
        throw new ApiError('RATE_LIMITED', 429);
      bucket = { count: 0, reset: now + windowMs };
      this.buckets.set(key, bucket);
    }
    if (++bucket.count > limit) throw new ApiError('RATE_LIMITED', 429);
  }
  sweep() {
    for (const [key, bucket] of this.buckets)
      if (bucket.reset <= this.now()) this.buckets.delete(key);
  }
  clear() {
    this.buckets.clear();
  }
  get size() {
    return this.buckets.size;
  }
}
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  constructor(
    private readonly ttlMs: number,
    private readonly capacity: number,
    private readonly now = Date.now,
  ) {}
  create(identity: string, origin: string) {
    this.sweep();
    if (this.sessions.size >= this.capacity) throw new ApiError('BUSY', 503);
    const token = randomBytes(32).toString('base64url');
    const session: Session = {
      identity,
      origin,
      expiresAt: this.now() + this.ttlMs,
      turns: 0,
      busy: false,
      history: [],
    };
    this.sessions.set(digest(token), session);
    return { token, expiresAt: session.expiresAt };
  }
  get(token: string, identity: string, origin: string): Session {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError('SESSION_REQUIRED', 401);
    const key = digest(token);
    const session = this.sessions.get(key);
    if (
      !session ||
      session.expiresAt <= this.now() ||
      session.identity !== identity ||
      session.origin !== origin
    ) {
      if (session && session.expiresAt <= this.now()) this.sessions.delete(key);
      throw new ApiError('SESSION_REQUIRED', 401);
    }
    return session;
  }
  delete(token: string) {
    this.sessions.delete(digest(token));
  }
  sweep() {
    for (const [key, value] of this.sessions)
      if (value.expiresAt <= this.now()) {
        value.history.length = 0;
        this.sessions.delete(key);
      }
  }
  clear() {
    for (const session of this.sessions.values()) session.history.length = 0;
    this.sessions.clear();
  }
  get size() {
    return this.sessions.size;
  }
}
export function remember(session: Session, question: string, answer: string) {
  const messages: Message[] = [
    ...session.history,
    { role: 'user', content: question },
    { role: 'assistant', content: answer.slice(0, 3000) },
  ];
  // At most three complete turns and 7,000 characters. No client-supplied history.
  while (
    messages.length > 6 ||
    messages.reduce((size, item) => size + item.content.length, 0) > 7000
  )
    messages.splice(0, 2);
  session.history = messages;
}
