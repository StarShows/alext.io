import { ApiError } from './security.js';
interface Waiter { resolve: (release: () => void) => void; reject: (error: Error) => void; cleanup: () => void }
export class InferenceGate {
  private active = 0;
  private closed = false;
  private readonly waiting: Waiter[] = [];
  constructor(private readonly maximum: number, private readonly queueMaximum: number, private readonly waitMs: number) {}
  get metrics() { return { active: this.active, queued: this.waiting.length }; }
  async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (this.closed) throw new ApiError('UNAVAILABLE', 503);
    if (this.active < this.maximum) { this.active++; return this.releaseOnce(); }
    if (this.waiting.length >= this.queueMaximum) throw new ApiError('BUSY', 503);
    return new Promise<() => void>((resolve, reject) => {
      const rejectAndRemove = (error: Error) => {
        const index = this.waiting.indexOf(waiter);
        if (index < 0) return;
        this.waiting.splice(index, 1); waiter.cleanup(); reject(error);
      };
      const abort = () => rejectAndRemove(new ApiError('CANCELLED', 499));
      const timer = setTimeout(() => rejectAndRemove(new ApiError('BUSY', 503)), this.waitMs);
      const waiter: Waiter = { resolve, reject, cleanup: () => { clearTimeout(timer); signal.removeEventListener('abort', abort); } };
      this.waiting.push(waiter); signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  private releaseOnce() {
    let released = false;
    return () => {
      if (released) return; released = true; this.active--;
      const next = this.waiting.shift();
      if (next) { next.cleanup(); this.active++; next.resolve(this.releaseOnce()); }
    };
  }
  close() {
    this.closed = true;
    for (const waiter of this.waiting.splice(0)) { waiter.cleanup(); waiter.reject(new ApiError('UNAVAILABLE', 503)); }
  }
}
