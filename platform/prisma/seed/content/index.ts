import { COMPANIES } from './companies';
import { EXISTING_PROJECTS } from './existing-projects';
import type { CompanyContent, VacancyContent } from './types';
import { VACANCIES_AI } from './vacancies-ai';
import { VACANCIES_BACKEND } from './vacancies-backend';
import { VACANCIES_ENGINEERING } from './vacancies-engineering';
import { VACANCIES_FRONTEND } from './vacancies-frontend';

export const ALL_COMPANIES: CompanyContent[] = COMPANIES;
export const ALL_VACANCIES: VacancyContent[] = [...VACANCIES_BACKEND, ...VACANCIES_FRONTEND, ...VACANCIES_AI, ...VACANCIES_ENGINEERING];
export { EXISTING_PROJECTS };
