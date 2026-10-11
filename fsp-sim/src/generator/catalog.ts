import type { Discipline, DisciplineCode, Partner, Region } from '../types.js';

/** Пять дисциплин ФСП с сайта федерации (docs/fsp-overview.md). Критерии — условные названия. */
export const DISCIPLINES: Discipline[] = [
  {
    code: 'product',
    name: 'Продуктовое программирование',
    short_name: 'продуктовое программирование',
    entrant_type: 'team',
    description: 'Командная разработка прикладного решения по задаче партнёра и его защита перед жюри.',
    criteria: ['Решение задачи', 'Архитектура', 'Качество кода', 'Интерфейс', 'Защита проекта', 'Работа команды'],
  },
  {
    code: 'algorithmic',
    name: 'Алгоритмическое программирование',
    short_name: 'алгоритмическое программирование',
    entrant_type: 'individual',
    description: 'Личное решение алгоритмических задач с автоматической проверкой; зачёт по числу задач и штрафному времени.',
    criteria: null,
  },
  {
    code: 'infosec',
    name: 'Программирование систем информационной безопасности',
    short_name: 'информационная безопасность',
    entrant_type: 'team',
    description: 'Командные соревнования формата CTF: задания по защите и анализу систем, зачёт по баллам.',
    criteria: null,
  },
  {
    code: 'robotics',
    name: 'Программирование робототехники',
    short_name: 'робототехника',
    entrant_type: 'team',
    description: 'Командное программирование роботов для выполнения полигонного задания.',
    criteria: ['Автономность', 'Точность выполнения', 'Время', 'Надёжность'],
  },
  {
    code: 'drones',
    name: 'Программирование беспилотных авиационных систем',
    short_name: 'программирование БАС',
    entrant_type: 'team',
    description: 'Командное программирование полётного задания беспилотника на симуляторе и полигоне.',
    criteria: ['Полётное задание', 'Автономная навигация', 'Время', 'Штрафы'],
  },
];

export const DISCIPLINE_BY_CODE: Record<DisciplineCode, Discipline> = Object.fromEntries(
  DISCIPLINES.map((d) => [d.code, d]),
) as Record<DisciplineCode, Discipline>;

/** Регионы с кодами субъектов РФ; веса — доля спортсменов в синтетическом наборе. */
export const REGIONS: Array<Region & { weight: number }> = [
  { code: '77', name: 'Москва', city: 'Москва', weight: 18 },
  { code: '78', name: 'Санкт-Петербург', city: 'Санкт-Петербург', weight: 12 },
  { code: '16', name: 'Республика Татарстан', city: 'Казань', weight: 8 },
  { code: '66', name: 'Свердловская область', city: 'Екатеринбург', weight: 7 },
  { code: '54', name: 'Новосибирская область', city: 'Новосибирск', weight: 7 },
  { code: '52', name: 'Нижегородская область', city: 'Нижний Новгород', weight: 5 },
  { code: '63', name: 'Самарская область', city: 'Самара', weight: 4 },
  { code: '23', name: 'Краснодарский край', city: 'Краснодар', weight: 5 },
  { code: '02', name: 'Республика Башкортостан', city: 'Уфа', weight: 4 },
  { code: '59', name: 'Пермский край', city: 'Пермь', weight: 4 },
  { code: '70', name: 'Томская область', city: 'Томск', weight: 4 },
  { code: '61', name: 'Ростовская область', city: 'Ростов-на-Дону', weight: 4 },
  { code: '74', name: 'Челябинская область', city: 'Челябинск', weight: 4 },
  { code: '24', name: 'Красноярский край', city: 'Красноярск', weight: 3 },
  { code: '36', name: 'Воронежская область', city: 'Воронеж', weight: 3 },
  { code: '50', name: 'Московская область', city: 'Долгопрудный', weight: 5 },
];

export const PARTNERS: Partner[] = [
  {
    client_id: 'fsp-career',
    name: 'ФСП Карьера',
    description: 'Карьерная платформа команды (ЛЦТ 2026): связь профиля с ФСП ID и чтение достижений с согласия спортсмена.',
  },
  {
    client_id: 'fsp-partner-demo',
    name: 'Демо-партнёр',
    description: 'Открытый демонстрационный клиент для проверки модели согласий: доступ только к спортсменам, давшим согласие.',
  },
];

export const HACKATHON_THEMES = ['Цифровой регион', 'Умный город', 'Открытые данные', 'Технологии для спорта'];
export const FINAL_CITIES = ['Москва', 'Казань', 'Санкт-Петербург', 'Екатеринбург', 'Новосибирск'];
