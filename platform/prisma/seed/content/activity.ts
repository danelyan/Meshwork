import type { ActivityContent } from './types';

/**
 * Отклики и приглашения вокруг новых компаний (1–2 на компанию), чтобы кабинеты работодателей и страницы
 * вакансий не были пустыми. Кандидаты – из пула подборки (demo-pool-*, demo-cat-*, demo-ai-*), не персоны пути
 * /demo: их статусы зафиксированы сценариями. Даты считаются от «сегодня» при сиде.
 */
export const ACTIVITY: ActivityContent[] = [
  // Ясень Ритейл
  { kind: 'application', id: 'demo-app-yasen-retail-1', vacancyId: 'demo-vac-yasen-retail-1', candidateId: 'demo-pool-be-j-3', status: 'viewed', ageDays: 3,
    message: 'Здравствуйте! Прошёл тест на Junior backend, делал кеш и очереди в учебных проектах. Хочу попробовать себя в нагрузке перед распродажами.' },
  { kind: 'invitation', id: 'demo-inv-yasen-retail-1', vacancyId: 'demo-vac-yasen-retail-11', candidateId: 'demo-pool-fe-m-3', status: 'sent', salaryFrom: 220000, salaryTo: 300000, ageDays: 1,
    message: 'Здравствуйте! Ваш профиль подтверждён на Middle frontend с акцентом на производительность. У нас каталог на миллионы позиций и команда витрины – расскажем подробнее на коротком созвоне.' },
  // Вектор Логистика
  { kind: 'invitation', id: 'demo-inv-vektor-logistics-1', vacancyId: 'demo-vac-vektor-logistics-31', candidateId: 'demo-cat-sre-m-1', status: 'viewed', salaryFrom: 240000, salaryTo: 320000, ageDays: 4,
    message: 'Здравствуйте! Увидели вашу категорию SRE Middle и подтверждённые навыки по алертингу. Ищем человека в группу надёжности биржи заказов, вилка в приглашении.' },
  { kind: 'application', id: 'demo-app-vektor-logistics-1', vacancyId: 'demo-vac-vektor-logistics-1', candidateId: 'demo-pool-be-m-4', status: 'sent', ageDays: 2,
    message: 'Добрый день! Занимался схемами данных и миграциями в продуктовой команде, интересна задача аудита и версионирования записей.' },
  // Нейрон Лаб
  { kind: 'application', id: 'demo-app-neyron-lab-1', vacancyId: 'demo-vac-neyron-lab-1', candidateId: 'demo-ai-j-1', status: 'viewed', ageDays: 5,
    message: 'Здравствуйте! Прошла тест на Junior по LLM-приложениям, делала классификатор обращений на учебном датасете. Хочу работать с реальными ассистентами.' },
  { kind: 'invitation', id: 'demo-inv-neyron-lab-1', vacancyId: 'demo-vac-neyron-lab-4', candidateId: 'demo-ai-m-1', status: 'accepted', salaryFrom: 260000, salaryTo: 340000, ageDays: 6,
    message: 'Здравствуйте! Ваша категория ML-инженер Middle и подтверждённый опыт с конвейерами признаков совпали с нашей потребностью. Предлагаем обсудить роль в команде ассистентов.' },
  // Атлас Облако
  { kind: 'invitation', id: 'demo-inv-atlas-cloud-1', vacancyId: 'demo-vac-atlas-cloud-31', candidateId: 'demo-cat-devops-s-1', status: 'sent', salaryFrom: 380000, salaryTo: 500000, ageDays: 1,
    message: 'Здравствуйте! Ищем senior-инженера в платформенную команду выкаток. Ваш профиль подтверждён на Senior DevOps, вилка и описание команды в приглашении.' },
  { kind: 'application', id: 'demo-app-atlas-cloud-1', vacancyId: 'demo-vac-atlas-cloud-1', candidateId: 'demo-pool-be-m-infra', status: 'declined', ageDays: 9,
    message: 'Здравствуйте! Хотя моя категория Middle, у меня есть опыт с очередями фоновых задач и backpressure. Готов пройти проектное задание уровня Senior.' },
  // Медлайн Диджитал
  { kind: 'application', id: 'demo-app-medline-digital-1', vacancyId: 'demo-vac-medline-digital-31', candidateId: 'demo-cat-qa-automation-j-1', status: 'sent', ageDays: 1,
    message: 'Добрый день! Прошёл тест на Junior QA Automation, умею проектировать проверки по спецификации. Медицинский домен интересен требованиями к точности.' },
  { kind: 'invitation', id: 'demo-inv-medline-digital-1', vacancyId: 'demo-vac-medline-digital-11', candidateId: 'demo-pool-fe-m-4', status: 'viewed', salaryFrom: 230000, salaryTo: 300000, ageDays: 3,
    message: 'Здравствуйте! У нас дизайн-система для 40 клиник и жёсткие требования к доступности. Ваш профиль Middle frontend подтверждён, зовём обсудить роль.' },
  // ГородУм
  { kind: 'application', id: 'demo-app-gorodum-1', vacancyId: 'demo-vac-gorodum-11', candidateId: 'demo-pool-fe-j-3', status: 'viewed', ageDays: 2,
    message: 'Здравствуйте! Есть подтверждённая категория Junior frontend, нравится работать с производительностью интерфейса. Хочу делать продукт для школьников.' },
  { kind: 'invitation', id: 'demo-inv-gorodum-1', vacancyId: 'demo-vac-gorodum-21', candidateId: 'demo-ai-j-2', status: 'sent', salaryFrom: 110000, salaryTo: 150000, ageDays: 2,
    message: 'Здравствуйте! Ищем junior-аналитика в команду аналитики обучения. Ваш профиль подтверждён тестом, вилка указана, расскажем о задачах на созвоне.' },
  // Пульс Геймс
  { kind: 'invitation', id: 'demo-inv-pulse-games-1', vacancyId: 'demo-vac-pulse-games-1', candidateId: 'demo-pool-be-m-3', status: 'sent', salaryFrom: 240000, salaryTo: 320000, ageDays: 1,
    message: 'Здравствуйте! Игровые серверы под пиковой нагрузкой матчей – наша главная задача. Ваш профиль Middle backend с подтверждённой конкурентностью нам подходит.' },
  { kind: 'application', id: 'demo-app-pulse-games-1', vacancyId: 'demo-vac-pulse-games-31', candidateId: 'demo-cat-qa-automation-m-1', status: 'accepted', ageDays: 7,
    message: 'Добрый день! Автоматизирую проверки API по контракту, есть опыт с нагрузочными сценариями. Хочу в игровую студию.' },
];
