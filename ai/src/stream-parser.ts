import { ApiError } from './security.js';

/** Parses complete JSON blocks incrementally. Never exposes partial JSON or unvalidated tokens. */
export class BlockParser {
  private buffer = '';
  private index = 0;
  private started = false;
  private closed = false;
  private inString = false;
  private escaped = false;
  private depth = 0;
  private blockStart = -1;
  private count = 0;
  push(text: string): unknown[] {
    this.buffer += text;
    if (this.buffer.length > 20000) throw new ApiError('UNAVAILABLE', 503);
    if (!this.started) {
      const prefix = this.buffer.match(/^\s*\{\s*"blocks"\s*:\s*\[/);
      if (!prefix) {
        if (this.buffer.includes('[') || this.buffer.length > 64) throw new ApiError('UNAVAILABLE', 503);
        return [];
      }
      this.started = true; this.index = prefix[0].length;
    }
    const result: unknown[] = [];
    for (; this.index < this.buffer.length && !this.closed; this.index++) {
      const character = this.buffer[this.index];
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (character === '\\') this.escaped = true;
        else if (character === '"') this.inString = false;
        continue;
      }
      if (character === '"') { this.inString = true; continue; }
      if (character === '{') { if (this.depth === 0) this.blockStart = this.index; this.depth++; }
      else if (character === '}') {
        if (--this.depth < 0) throw new ApiError('UNAVAILABLE', 503);
        if (this.depth === 0) {
          if (++this.count > 4 || this.blockStart < 0) throw new ApiError('UNAVAILABLE', 503);
          result.push(JSON.parse(this.buffer.slice(this.blockStart, this.index + 1)));
          this.blockStart = -1;
        }
      } else if (character === ']' && this.depth === 0) this.closed = true;
    }
    return result;
  }
  finish(): unknown[] {
    const result: unknown = JSON.parse(this.buffer);
    if (!result || typeof result !== 'object' || Object.keys(result).join(',') !== 'blocks') throw new ApiError('UNAVAILABLE', 503);
    const blocks = (result as { blocks: unknown }).blocks;
    if (!Array.isArray(blocks) || !blocks.length || blocks.length !== this.count || blocks.length > 4) throw new ApiError('UNAVAILABLE', 503);
    return blocks;
  }
}
