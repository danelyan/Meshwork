import type { ExtractedDoc, ProfileKind } from './types';

/** github / codeforces / stackoverflow / fsp (демо-мок). */
export async function fetchProfile(kind: ProfileKind, handle: string): Promise<ExtractedDoc> {
  void kind;
  void handle;
  throw new Error('not implemented: collector');
}
