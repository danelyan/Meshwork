/** Presentation aliases only; stored company IDs, vacancies and contacts stay unchanged. */
const ALIASES: Record<string, string> = {
  'Северный Поток': 'Т-Банк',
  'Гранит Софт': 'Ozon',
  'Лабиринт Медиа': 'VK',
};

const LOGOS: Record<string, string> = {
  'Яндекс': 'yandex.png', 'Т-Банк': 'tbank.svg', 'Авито': 'avito.svg',
  'Ozon': 'ozon.png', 'Сбер': 'sber.jpg', 'VK': 'vk.png',
  'МТС': 'mts.svg', 'Альфа-Банк': 'alfa.png',
};

export function companyDisplayName(name: string): string {
  return Object.entries(ALIASES).reduce((text, [oldName, brand]) => text.replaceAll(oldName, brand), name);
}

export function companyLogoSrc(name: string): string | undefined {
  const logo = LOGOS[companyDisplayName(name)];
  return logo ? `/assets/companies/${logo}` : undefined;
}

export function companyDisplayDescription(name: string, description: string | null): string | null {
  if (!description?.includes('Вымышлен')) return description;
  const descriptions: Record<string, string> = {
    'Северный Поток': 'Финансовые технологии и цифровые банковские сервисы',
    'Гранит Софт': 'Электронная коммерция, маркетплейс и технологии доставки',
    'Лабиринт Медиа': 'Социальные сервисы, коммуникации и медиапродукты',
  };
  return descriptions[name] ?? description;
}
