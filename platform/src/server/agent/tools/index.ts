import { searchKnowledgeTool } from '../knowledge/tool';
import type { AgentTool } from '../types';
import { candidateWebSearch } from '../web-search/tool';
import { askUser } from './ask_user';
import { catalogSearch } from './catalog_search';
import { explainEvidence } from './explain_evidence';
import { fetchProfileTool } from './fetch_profile';
import { fetchUrlTool } from './fetch_url';
import { getInvitations } from './get_invitations';
import { getOnboardingStatus } from './get_onboarding_status';
import { getProfileTool } from './get_profile';
import { getTestStatus } from './get_test_status';
import { proposeClaimsTool } from './propose_claims';
import { readUpload } from './read_upload';
import { explainInvitationTool, getGapMap, recommendTargetsTool, recommendTasksTool, recommendTestTool } from './recommend';
import { renderProfilePdf } from './render_profile_pdf';
import { startVerification } from './start_verification';

/**
 * Реестр инструментов консультанта: 14 по ТЗ § 4.1 + 4 только на чтение для
 * «ведёт по платформе» (E-02): get_onboarding_status, get_test_status,
 * get_invitations, explain_evidence; + search_knowledge (база знаний) и web_search (Яндекс,
 * крайний случай, решения владельца 09.10). Все 20 — чтение или предложение.
 * Записывающих в профиль, откликающихся и пишущих письма инструментов здесь
 * нет и быть не должно (ТЗ § 2) — тест tools.test.ts проверяет список.
 */
// Разнотипные инструменты в одном списке: вход/выход проверяются Zod-схемой каждого.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const tools: AgentTool<any, any>[] = [
  getOnboardingStatus,
  searchKnowledgeTool,
  readUpload,
  fetchUrlTool,
  fetchProfileTool,
  catalogSearch,
  proposeClaimsTool,
  getProfileTool,
  explainEvidence,
  getGapMap,
  getTestStatus,
  recommendTestTool,
  recommendTasksTool,
  recommendTargetsTool,
  getInvitations,
  explainInvitationTool,
  startVerification,
  renderProfilePdf,
  candidateWebSearch,
  askUser,
];

export const TOOL_NAMES = tools.map((t) => t.name);
