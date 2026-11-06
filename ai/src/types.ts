export type Mode = 'recruiter' | 'hiring-manager' | 'leadership';
export type Intent = 'experience' | 'project' | 'approach' | 'contact' | 'out-of-scope';
export interface Decision {
  scope: 'professional' | 'unrelated' | 'unsafe';
  intent: Intent;
  confidence: number;
}
export interface Citation {
  id: string;
  label: string;
  url: string;
}
export interface Fact {
  id: string;
  text: string;
  tags: string[];
  source: Citation;
  provenance: 'owner-published' | 'code-inspected';
}
export interface Block {
  id: string;
  kind: 'evidence' | 'approach' | 'notice';
  text: string;
  citations: Citation[];
}
export interface RawBlock {
  kind: 'evidence' | 'approach' | 'unknown';
  ids: string[];
  text: string;
}
export interface Message {
  role: 'user' | 'assistant';
  content: string;
}
export interface AnswerInput {
  question: string;
  mode: Mode;
  intent: Intent;
  history: Message[];
  facts: Fact[];
}
export interface ModelStats {
  firstTokenMs: number;
  totalMs: number;
  loadMs: number;
  generatedTokens: number;
  generationMs: number;
}
export type ModelChunk = { text: string } | { stats: ModelStats };
export interface InferenceService {
  classify(question: string, history: Message[], signal: AbortSignal): Promise<Decision>;
  answer(input: AnswerInput, signal: AbortSignal): AsyncIterable<ModelChunk>;
  ready(signal: AbortSignal): Promise<boolean>;
  close(): void;
}
export type VerifyHuman = (token: string, ip: string, signal: AbortSignal) => Promise<boolean>;
export interface Session {
  expiresAt: number;
  identity: string;
  origin: string;
  turns: number;
  busy: boolean;
  history: Message[];
}
