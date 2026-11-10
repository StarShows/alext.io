import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Fact, Citation } from './types.js';

const origins = new Set([
  'https://alext.io',
  'https://github.com',
  'https://www.realtor-studio.com',
  'https://www.justgetcreamed.com',
  'https://www.choptsalad.com',
]);
export function safePublicLink(link: string) {
  try {
    const url = new URL(link);
    return (
      origins.has(url.origin) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !/[%\\]/.test(url.pathname) &&
      (url.hostname !== 'github.com' || /^\/StarShows(?:\/|$)/.test(url.pathname))
    );
  } catch {
    return false;
  }
}
export function validateFacts(input: unknown): Fact[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100)
    throw new Error('Invalid knowledge collection');
  const ids = new Set<string>();
  return input.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid fact');
    const fact = raw as Fact;
    if (!/^[a-z][a-z0-9-]{1,48}$/.test(fact.id) || ids.has(fact.id))
      throw new Error('Invalid fact ID');
    ids.add(fact.id);
    if (
      typeof fact.text !== 'string' ||
      fact.text.length < 10 ||
      fact.text.length > 600 ||
      /[<>\u0000-\u001f]|ignore.{0,20}instructions|system prompt|\[INST\]/i.test(fact.text)
    )
      throw new Error('Invalid fact text');
    if (
      !Array.isArray(fact.tags) ||
      fact.tags.length > 24 ||
      fact.tags.some((tag) => typeof tag !== 'string' || !/^[a-z0-9+.# -]{1,40}$/.test(tag))
    )
      throw new Error('Invalid tags');
    const source = fact.source;
    if (
      !source ||
      !/^[a-z][a-z0-9-]{1,48}$/.test(source.id) ||
      typeof source.label !== 'string' ||
      source.label.length > 80 ||
      typeof source.url !== 'string' ||
      !safePublicLink(source.url)
    )
      throw new Error('Invalid source');
    if (!['owner-published', 'code-inspected'].includes(fact.provenance))
      throw new Error('Invalid provenance');
    return {
      id: fact.id,
      text: fact.text,
      tags: [...fact.tags],
      source: { id: source.id, label: source.label, url: source.url },
      provenance: fact.provenance,
    };
  });
}
const stop = new Set(
  'the a an is are was were of to and or for with on in at it that this me you your his he alex tannenbaum would could should does have has what how tell about built build show makes strong'.split(
    ' ',
  ),
);
const synonyms: Record<string, string[]> = {
  hiring: ['engineer', 'experience'],
  hire: ['engineer', 'experience'],
  candidate: ['engineer', 'experience'],
  frontend: ['react', 'typescript'],
  backend: ['node', 'api'],
  fullstack: ['react', 'node'],
  cloud: ['aws', 'azure'],
  ai: ['llm', 'mcp'],
  rag: ['retrieval', 'ai'],
  integrations: ['api', 'integration'],
  security: ['secure', 'authentication'],
  projects: ['project', 'portfolio'],
  work: ['experience', 'project'],
  best: ['project'],
};
function terms(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/node\.js/g, 'node')
      .replace(/full[- ]stack/g, 'fullstack')
      .match(/[a-z0-9+#]+/g)
      ?.filter((term) => !stop.has(term)) ?? []
  );
}
export class KnowledgeBase {
  readonly facts: Fact[];
  readonly revision: string;
  private readonly documents: string[][];
  constructor(raw: unknown) {
    this.facts = validateFacts(raw);
    this.revision = createHash('sha256').update(JSON.stringify(this.facts)).digest('hex');
    this.documents = this.facts.map((fact) =>
      terms(fact.text + ' ' + fact.tags.join(' ') + ' ' + fact.tags.join(' ')),
    );
  }
  retrieve(question: string, previousQuestion = '', maximum = 6): Fact[] {
    const ownTerms = terms(question);
    const followup =
      /^(?:and |what about |how about |tell me more|go deeper|why|how so|can you expand|which of those)/i.test(
        question,
      );
    const query = new Set(ownTerms.flatMap((term) => [term, ...(synonyms[term] ?? [])]));
    if (followup) for (const term of terms(previousQuestion).slice(0, 20)) query.add(term);
    const average =
      this.documents.reduce((sum, doc) => sum + doc.length, 0) / this.documents.length;
    const scores = this.documents.map((doc, index) => {
      let score = 0;
      for (const term of query) {
        const frequency = doc.filter((word) => word === term).length;
        if (!frequency) continue;
        const count = this.documents.filter((other) => other.includes(term)).length;
        const idf = Math.log(1 + (this.documents.length - count + 0.5) / (count + 0.5));
        score +=
          (idf * frequency * 2.2) / (frequency + 1.2 * (0.25 + (0.75 * doc.length) / average));
      }
      return { index, score };
    });
    return scores
      .filter((item) => item.score > 0.35)
      .sort((a, b) => b.score - a.score)
      .slice(0, maximum)
      .map((item) => this.facts[item.index]!);
  }
  citations(facts: Fact[]): Citation[] {
    return [...new Map(facts.map((fact) => [fact.source.id, fact.source])).values()];
  }
}
export function loadKnowledge(path = new URL('../knowledge/portfolio.json', import.meta.url)) {
  const data = JSON.parse(readFileSync(path, 'utf8')) as { facts: unknown };
  return new KnowledgeBase(data.facts);
}
