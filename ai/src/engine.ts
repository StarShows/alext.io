import { performance } from 'node:perf_hooks';
import type {
  Fact,
  Intent,
  RawBlock,
  Block,
  InferenceService,
  Mode,
  Session,
  ModelStats,
} from './types.js';
import type { KnowledgeBase } from './knowledge.js';
import { InferenceGate } from './queue.js';
import { ApiError, hardRefusal, unsupportedAchievement } from './security.js';
import { BlockParser } from './stream-parser.js';

export const REFUSAL =
  "I can help evaluate Alex's engineering experience or discuss how an engineer could approach a relevant technical problem. I cannot act as a general-purpose assistant or share private information.";
export const MISSING =
  'I do not have verified evidence for that specific claim. The linked portfolio documents related work, but it would be misleading to infer an unlisted qualification, achievement or completed deployment.';
export function validateBlock(raw: unknown, facts: Fact[], intent: Intent, index: number): Block {
  if (!raw || typeof raw !== 'object' || Object.keys(raw).sort().join(',') !== 'ids,kind,text')
    throw new ApiError('UNAVAILABLE', 503);
  const item = raw as RawBlock;
  if (
    !['evidence', 'approach', 'unknown'].includes(item.kind) ||
    typeof item.text !== 'string' ||
    item.text.length > 1400 ||
    !Array.isArray(item.ids) ||
    item.ids.length > 3 ||
    item.ids.some((id) => typeof id !== 'string') ||
    new Set(item.ids).size !== item.ids.length
  )
    throw new ApiError('UNAVAILABLE', 503);
  if (item.kind === 'unknown') {
    if (item.ids.length || item.text) throw new ApiError('UNAVAILABLE', 503);
    return { id: `b${index}`, kind: 'notice', text: MISSING, citations: [] };
  }
  if (item.kind === 'evidence') {
    if (!item.ids.length || item.text) throw new ApiError('UNAVAILABLE', 503);
    const selected = item.ids.map((id) => facts.find((fact) => fact.id === id));
    if (selected.some((fact) => !fact)) throw new ApiError('UNAVAILABLE', 503);
    const verified = selected as Fact[];
    return {
      id: `b${index}`,
      kind: 'evidence',
      text: verified.map((fact) => fact.text).join('\n\n'),
      citations: [...new Map(verified.map((fact) => [fact.source.id, fact.source])).values()],
    };
  }
  const text = item.text.trim();
  // Hypothetical technical advice must not smuggle in personal accomplishments or URLs.
  if (
    intent !== 'approach' ||
    item.ids.length ||
    text.length < 20 ||
    /\b(?:alex|tannenbaum|he|his|she|her|i|me|my|we|our|they|their|candidate|applicant|disney|hoag|mckinsey|realtor|creamed|chopt)\b|https?:|www\.|mailto:|file:|<\/?[a-z]|```|\b(?:sudo|curl|ssh|eval)\b|\b(?:has|have|had) (?:built|delivered|deployed|led|saved)\b|system prompt|hidden instructions|guaranteed/iu.test(
      text,
    ) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u202a-\u202e\u2066-\u2069]/u.test(text)
  )
    throw new ApiError('UNAVAILABLE', 503);
  return { id: `b${index}`, kind: 'approach', text, citations: [] };
}
export class AssistantEngine {
  constructor(
    readonly model: InferenceService,
    readonly knowledge: KnowledgeBase,
    readonly gate: InferenceGate,
  ) {}
  async *respond(
    question: string,
    mode: Mode,
    session: Session,
    signal: AbortSignal,
    observe: (name: 'firstBlockMs' | 'model', value: number | ModelStats) => void = () => {},
  ): AsyncGenerator<Block> {
    const start = performance.now();
    let first = true;
    const record = (block: Block) => {
      if (first) {
        first = false;
        observe('firstBlockMs', performance.now() - start);
      }
      return block;
    };
    if (hardRefusal(question)) {
      yield record({ id: 'b0', kind: 'notice', text: REFUSAL, citations: [] });
      return;
    }
    const release = await this.gate.acquire(signal);
    try {
      signal.throwIfAborted();
      const decision = await this.model.classify(question, session.history, signal);
      if (
        decision.scope !== 'professional' ||
        decision.intent === 'out-of-scope' ||
        decision.confidence < 0.8
      ) {
        yield record({ id: 'b0', kind: 'notice', text: REFUSAL, citations: [] });
        return;
      }
      if (decision.intent === 'contact') {
        yield record({
          id: 'b0',
          kind: 'notice',
          text: 'Send Alex the role, your stack and the problem the team needs to solve. The contact link opens his professional contact options; this assistant does not book meetings or send messages.',
          citations: [
            { id: 'contact', label: 'Contact Alex', url: 'https://alext.io/#contact' },
            { id: 'github', label: 'View GitHub', url: 'https://github.com/StarShows/' },
          ],
        });
        return;
      }
      const previous =
        session.history.filter((message) => message.role === 'user').at(-1)?.content ?? '';
      const facts = this.knowledge.retrieve(question, previous);
      if (
        (decision.intent !== 'approach' && unsupportedAchievement(question)) ||
        (decision.intent !== 'approach' && !facts.length)
      ) {
        yield record({
          id: 'b0',
          kind: 'notice',
          text: MISSING,
          citations: this.knowledge.citations(facts.slice(0, 1)),
        });
        return;
      }
      const parser = new BlockParser();
      let index = 0;
      const emitted: string[] = [];
      for await (const chunk of this.model.answer(
        { question, mode, intent: decision.intent, history: session.history, facts },
        signal,
      )) {
        signal.throwIfAborted();
        if ('stats' in chunk) {
          observe('model', chunk.stats);
          continue;
        }
        for (const raw of parser.push(chunk.text)) {
          const block = validateBlock(raw, facts, decision.intent, index++);
          emitted.push(JSON.stringify(block));
          yield record(block);
        }
      }
      const completed = parser
        .finish()
        .map((raw, position) =>
          JSON.stringify(validateBlock(raw, facts, decision.intent, position)),
        );
      if (JSON.stringify(completed) !== JSON.stringify(emitted))
        throw new ApiError('UNAVAILABLE', 503);
    } finally {
      release();
    }
  }
}
