// RAG по контракту (contract.md).
import type { LlmClient } from './llm';

export interface Doc {
  id: string;
  text: string;
}

export interface Chunk {
  chunkId: string;
  docId: string;
  text: string;
}

export interface Index {
  chunks: Chunk[];
}

export interface Hit extends Chunk {
  score: number;
}

export function chunkText(text: string, opts: { size?: number; overlap?: number } = {}): string[] {
  void text;
  void opts;
  throw new Error('not implemented');
}

export async function loadCorpus(dir: string): Promise<Doc[]> {
  void dir;
  throw new Error('not implemented');
}

export function buildIndex(docs: Doc[], opts: { size?: number; overlap?: number } = {}): Index {
  void docs;
  void opts;
  throw new Error('not implemented');
}

export function retrieve(index: Index, query: string, k = 3): Hit[] {
  void index;
  void query;
  void k;
  throw new Error('not implemented');
}

export async function answer(
  question: string,
  opts: { index: Index; llm: LlmClient; k?: number; maxContextChars?: number },
): Promise<{ answer: string; citations: string[]; refused: boolean }> {
  void question;
  void opts;
  throw new Error('not implemented');
}
