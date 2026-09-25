import type { FundingNeed, FundingProfile, FundingMatch } from '../funding-catalog/types';

export const aiTasks = ['chat', 'intake', 'search', 'analysis', 'strategy', 'review', 'draft', 'changes', 'workspace'] as const;
export type AITask = typeof aiTasks[number];
export type AIMessage = { role: 'user' | 'assistant'; text: string };
export type AIDocument = { id: string; name: string; pages: { page: number; text: string }[] };
export const workspacePages = ['home', 'programs', 'applications', 'calendar', 'assistant'] as const;
export const workspaceActions = ['programs', 'funding', 'applications', 'profile', 'assistant', 'calendar'] as const;
export type WorkspaceInsight = { title: string; text: string; action: typeof workspaceActions[number] };
export type AIPersonalization = {
  summary: string; sections: Record<typeof workspacePages[number], WorkspaceInsight>;
  priorities: { programId: string; reason: string }[];
};
export type AIRequest = {
  task: AITask; question: string; history?: AIMessage[];
  context: {
    profile?: FundingProfile; need?: FundingNeed; programId?: string; page?: string;
    project?: string; budget?: number | null; draft?: string; draftKind?: string;
    preparedDocuments?: string[]; documents?: AIDocument[];
    identifiers?: Record<string, string>;
    workspace?: { savedIds: string[]; applications: { programId: string; project: string; budget: number | null; preparedDocuments: string[]; hasDraft: boolean; reviewConfirmed: boolean }[] };
  };
};
export type AIEvidence = { id: string; title: string; text: string; url?: string; checkedAt?: string; page?: number; documentId?: string; opportunityId?: string };
export type AIAction = { type: 'open_program' | 'prepare_application' | 'open_funding'; label: string; programId?: string };
export type AIFinding = { title: string; detail: string; severity: 'check' | 'warning'; evidenceId?: string; quote?: string };
export type AIResult = {
  mode: 'llm' | 'local'; answer: string; followups: string[]; citations: AIEvidence[]; actions: AIAction[];
  proposedNeed?: FundingNeed; proposedProfile?: FundingProfile; draft?: string; findings: AIFinding[];
  matches: { id: string; title: string; status: FundingMatch['status']; score: number; explanation: string }[];
  scenarios: { label: string; need: FundingNeed; matches: { id: string; title: string; status: string; score: number }[] }[];
  tools: string[]; notice?: string; usage?: { calls: number; tokens: number; durationMs: number };
  personalization?: AIPersonalization;
  providerFailure?: string;
};
