import type { AgentTool } from '../types';
import { askUser } from './ask_user';
import { catalogSearch } from './catalog_search';
import { fetchProfileTool } from './fetch_profile';
import { fetchUrlTool } from './fetch_url';
import { getProfileTool } from './get_profile';
import { proposeClaimsTool } from './propose_claims';
import { readUpload } from './read_upload';
import { explainInvitationTool, getGapMap, recommendTargetsTool, recommendTasksTool, recommendTestTool } from './recommend';
import { renderProfilePdf } from './render_profile_pdf';
import { startVerification } from './start_verification';

/**
 * Реестр инструментов консультанта (ТЗ § 4.1, 14 штук).
 * Записывающих в профиль, откликающихся и пишущих письма инструментов здесь
 * нет и быть не должно (ТЗ § 2) — тест tools.test.ts проверяет список.
 */
// Разнотипные инструменты в одном списке: вход/выход проверяются Zod-схемой каждого.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const tools: AgentTool<any, any>[] = [
  readUpload,
  fetchUrlTool,
  fetchProfileTool,
  catalogSearch,
  proposeClaimsTool,
  getProfileTool,
  getGapMap,
  recommendTestTool,
  recommendTasksTool,
  recommendTargetsTool,
  explainInvitationTool,
  startVerification,
  renderProfilePdf,
  askUser,
];

export const TOOL_NAMES = tools.map((t) => t.name);
