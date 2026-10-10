import type { LandingData } from './types';

/** Public company examples. Sources: docs/sources/company-logos.md. No imported vacancies or partnership claims. */
export const SHOWCASE: LandingData = {
  companies: [
    { id: 'yandex', name: 'Яндекс', focus: 'Поиск и цифровые сервисы', description: 'Продукты для людей и бизнеса', logoSrc: '/assets/companies/yandex.png', careersUrl: 'https://yandex.ru/jobs/' },
    { id: 'tbank', name: 'Т-Банк', focus: 'Финансовые технологии', description: 'Цифровые продукты и банковские сервисы', logoSrc: '/assets/companies/tbank.svg', careersUrl: 'https://www.tbank.ru/career/' },
    { id: 'avito', name: 'Авито', focus: 'Продуктовая разработка', description: 'Платформа объявлений и услуг', logoSrc: '/assets/companies/avito.svg', careersUrl: 'https://career.avito.com/' },
    { id: 'ozon', name: 'Ozon', focus: 'Электронная коммерция', description: 'Маркетплейс и технологии доставки', logoSrc: '/assets/companies/ozon.png', careersUrl: 'https://hh.ru/employer/2180' },
    { id: 'sber', name: 'Сбер', focus: 'Банкинг и технологии', description: 'Финансовые и цифровые сервисы', logoSrc: '/assets/companies/sber.jpg', careersUrl: 'https://rabota.sber.ru/' },
    { id: 'vk', name: 'VK', focus: 'Социальные и цифровые сервисы', description: 'Коммуникации, контент и технологии', logoSrc: '/assets/companies/vk.png', careersUrl: 'https://team.vk.company/' },
    { id: 'mts', name: 'МТС', focus: 'Связь и цифровая экосистема', description: 'Телекоммуникации и ИТ-продукты', logoSrc: '/assets/companies/mts.svg', careersUrl: 'https://job.mts.ru/' },
    { id: 'alfa', name: 'Альфа-Банк', focus: 'Финансовые технологии', description: 'Банковские продукты и сервисы', logoSrc: '/assets/companies/alfa.png', careersUrl: 'https://hh.ru/employer/80' },
  ],
};
