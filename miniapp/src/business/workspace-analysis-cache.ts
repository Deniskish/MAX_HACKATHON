import { renderableResult, type AIResult } from './ai-client';
import { workspaceActions, workspacePages, type AIPersonalization } from '../../api-server/ai/types';

export const analysisMaxAge = 4 * 60 * 60 * 1000;
export function validPersonalization(value: unknown): value is AIPersonalization {
  const data = value as AIPersonalization | null;
  return !!data && typeof data.summary === 'string' && !!data.summary.trim() && data.summary.length <= 700 && !!data.sections
    && workspacePages.every((p) => { const s = data.sections[p]; return s && typeof s.title === 'string' && !!s.title.trim() && s.title.length <= 60
      && typeof s.text === 'string' && !!s.text.trim() && s.text.length <= 300 && workspaceActions.includes(s.action); })
    && Array.isArray(data.priorities) && data.priorities.length <= 6
    && data.priorities.every((p) => p && typeof p.programId === 'string' && typeof p.reason === 'string' && p.reason.length <= 300);
}
export function reusableAnalysis(value: { data?: unknown; at?: unknown } | null | undefined, now = Date.now()): value is { data: AIResult; at: number } {
  return !!value && typeof value.at === 'number' && Number.isFinite(value.at) && now >= value.at && now - value.at < analysisMaxAge
    && renderableResult(value.data) && value.data.mode === 'llm' && validPersonalization(value.data.personalization);
}

// Persistent caching is optional: unavailable Web Crypto or storage must never prevent an AI request.
export async function analysisDigest(fingerprint: string): Promise<string | undefined> {
  try {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint)))].map((n) => n.toString(16).padStart(2, '0')).join('');
  } catch { return undefined; }
}
