import { request } from './api';
import type { CareerVacanciesView } from '@/server/recommend/career';

export const getCareerVacancies = (savedOnly = false) => request<CareerVacanciesView>(`/api/career/vacancies${savedOnly ? '?saved=true' : ''}`);
