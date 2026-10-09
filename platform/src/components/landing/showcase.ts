import type { LandingData } from './types';

/*
 * ВИТРИНА, НЕ ДАННЫЕ СЕРВИСА. Всё на главной - вымышленные компании и правдоподобные
 * цифры для демонстрации; реальные данные платформы (компании, вакансии, кандидаты)
 * на публичной странице не показываем. Названия не совпадают с реальными брендами
 * и с сидом БД (prisma/seed). Узлы графа героя строятся из этих же компаний.
 */
export const SHOWCASE: LandingData = {
  companies: [
    { id: 'sc-1', name: 'Аврора Лабс', focus: 'Backend · Middle, Senior', description: 'Облачная платформа для логистики', vacancies: 4, maxSalary: 420000 },
    { id: 'sc-2', name: 'Кедр', focus: 'Frontend · Junior, Middle', description: 'Сервис электронных очередей', vacancies: 3, maxSalary: 260000 },
    { id: 'sc-3', name: 'Полюс Системс', focus: 'Backend, Data · Middle', description: 'Аналитика для промышленности', vacancies: 5, maxSalary: 380000 },
    { id: 'sc-4', name: 'Вектор Пэй', focus: 'Backend · Junior, Middle', description: 'Платёжный шлюз для малого бизнеса', vacancies: 2, maxSalary: 300000 },
    { id: 'sc-5', name: 'Маяк Мобайл', focus: 'Mobile · Middle, Senior', description: 'Приложения для ритейла', vacancies: 3, maxSalary: 400000 },
    { id: 'sc-6', name: 'Тундра Тех', focus: 'DevOps · Middle', description: 'Инфраструктура и мониторинг', vacancies: 2, maxSalary: 350000 },
    { id: 'sc-7', name: 'Ладога Софт', focus: 'Frontend, Backend · Junior', description: 'Образовательная платформа', vacancies: 4, maxSalary: 180000 },
    { id: 'sc-8', name: 'Квант Ривер', focus: 'ML, Backend · Senior', description: 'Рекомендательные системы', vacancies: 2, maxSalary: 480000 },
    { id: 'sc-9', name: 'Бирюза', focus: 'QA, Backend · Junior, Middle', description: 'Маркетплейс услуг', vacancies: 3, maxSalary: 240000 },
  ],
  stats: { companies: 9, vacancies: 28, categorized: 1240, maxSalary: 480000, responseRate: 86 },
};
