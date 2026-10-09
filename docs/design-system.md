# Дизайн-система платформы

Правила кода для `platform/`. Визуал и размеры из мокапа - в [design-spec.md](design-spec.md) (спека Карины, источник визуала); здесь - как это собрано в коде и что обязательно. Расхождение спеки и этого документа - находка: чинить здесь, спеку не править молча.

Обязательное правило (решение владельца 09.10): новые экраны собираются из `platform/src/components/ui`; цвета только через токены `platform/src/styles/tokens.css`; новый токен или компонент сначала описывается в этом документе. Правило продублировано в `AGENTS.md` и `.claude/skills/fullstack-dev/SKILL.md`; сырые цвета ловит тест `platform/tests/unit/design-tokens.test.ts`.

## 1. Принципы

- Светлый квадратный стиль: скругления 0 (исключение - голова силуэта), без теней и градиентов на панелях.
- Стекло: `--glass` + рамка `--glass-border` + `--blur`. Фон страницы `--paper` со свечением `--glow`.
- Синий ФСП (`--blue`) - главный акцент: CTA, прогресс, выбор. Чёрный (`--ink`) - текст, основные кнопки, активные чипы.
- Моно (`--mono`) только для служебного: кикеры, метки, счётчики, проценты.
- Честность уровней доказанности видна без цвета: у `LevelBadge` текст + знак (○ ◐ ◑ ● — со слов, артефакт, третья сторона, платформа: по возрастанию, решение 09.10) + форма рамки (пунктир / контур / серая / синяя заливка). Любой новый индикатор статуса тоже дублирует цвет текстом или формой.
- Данные не выдумываем: демо помечено «демо», пустое состояние честно пусто (см. AGENTS.md и CLAUDE.md проекта).

## 2. Токены

Источник: `src/styles/tokens.css`. В компонентах и модулях - только `var(--имя)`.

### Основные

| Токен | Значение | Когда |
|---|---|---|
| `--ink` | `#111111` | текст, чёрные кнопки, рамка активного, логотип |
| `--paper` | `#f1f1f3` | фон страницы |
| `--muted` | `#6b6b70` | вторичный текст, подписи, кикер |
| `--blue` | `#402fff` | CTA, фокус, прогресс, выбранное, hover чёрной кнопки |
| `--line` | `rgba(17,17,17,.10)` | тонкие разделители |
| `--glass` / `--glass-strong` | белый .58 / .86 | панели, шапка / модалки, выделенные блоки |
| `--glass-border` | белый .9 | рамка стекла |
| `--silhouette` | `#e6e6ea` | подложка аватара, серая метка |
| `--glow` | radial-gradient | только фон `body` |
| `--ease` | `cubic-bezier(.65,0,.25,1)` | все переходы |
| `--blur` | `blur(18px) saturate(1.2)` | `backdrop-filter` стекла |

### Производные

| Токен | Когда |
|---|---|
| `--surface-input` | фон полей |
| `--surface-ghost` | фон кнопки-призрака и чипа |
| `--surface-hover` | hover-подложка в навигации |
| `--surface-notice` | фон `Notice` |
| `--surface-quote` | подложка цитаты |
| `--surface-dim` | = `--silhouette` |
| `--border-strong` | рамка выделенного (= `--ink`) |
| `--border-input` | рамка полей, контурный тег |
| `--border-soft` | рамка кнопки-призрака |
| `--border-faint` | рамка чипа, мягкий контур |
| `--rail` | направляющие линии |
| `--text-soft`, `--text-dim` | приглушённый текст (цитаты, описания); контраст проверен ≥ 4.5:1 |
| `--placeholder` | placeholder |
| `--on-ink` | текст на чёрном/синем |
| `--on-ink-soft` | вторичный текст на синем/чёрном |
| `--error` | текст ошибки |
| `--danger-border`, `--danger-text` | опасная кнопка |
| `--backdrop` | подложка модалки |
| `--focus` | = `--blue`, цвет фокуса |
| `--meter-off`, `--meter-on` | сегменты `Meter` |
| `--demo` | пометка «демо» (= `--muted`) |

### Устаревшие алиасы - не использовать в новом коде

| Токен | Заменять на |
|---|---|
| `--bg` | `--paper` |
| `--panel` | `--glass` |
| `--text` | `--ink` |
| `--red` | `--error` (или `--danger-*`) |
| `--accent-soft`, `--accent-check` | `--blue` |
| `--tag-red-border`, `--tag-red-text` | `--ink` (тег `dashed`) |
| `--radius*` (все = 0) | не нужны: скругления нет |

Алиасы живут, пока на них ссылаются старые экраны; удалять - когда ссылок не останется.

### Запрещено

Лайм `#D4FF3A` (только карта соответствия) и красный бренда `#EC1D35` в интерфейсе платформы не используются. Тени, градиенты и свечения на панелях - нет (тени в спеке §4 относятся к плиткам мокапа, не к платформе).

## 3. Типографика

Окончательный вариант HTML-макета: крупные заголовки лендинга — Golos Text, мелкие подписи — JetBrains Mono. Hero: `clamp(52px,6vw,104px)/.95`, на телефоне `clamp(36px,10.8vw,52px)/1.02`; заголовки секций — `clamp(32px,3.4vw,52px)/1`. Моноширинный вариант больших заголовков был отклонён.

Фоновая сетка остаётся видимой: лендинг создаёт собственный stacking context (`isolation: isolate`), внутри которого canvas на отрицательном слое находится над фоном страницы. На телефоне сохраняется статичная CSS-сетка. Внутренние страницы используют спокойную статичную сетку на `--landing-grid-line`; это декор, не отдельная панель и не перехватчик кликов. Вход и онбординг остаются текущим чатом, HTML-опросник не переносится.

Шрифты подключает `app/layout.tsx` через `next/font`: **Golos Text** (`--font`) - весь интерфейс; **JetBrains Mono** (`--mono`) - служебное. Тире в текстах - « - », не длинное.

| Токен | px | Где |
|---|---|---|
| `--fs-xs` | 11 | кикер, теги |
| `--fs-sm` | 12 | подсказки, мелкие кнопки |
| `--fs` | 14 | основной UI, кнопки, поля |
| `--fs-md` | 15 | навигация, абзацы |
| `--fs-lg` | 17 | лид, крупный текст |

Заголовки заданы глобально в `tokens.css`: h1 `clamp(28px,3vw,38px)`, h2 26, h3 19, вес 700, отрицательный трекинг. Крупные hero-размеры спеки §3 (H1 главной, 84-пиксельная кнопка) - только на лендинге, в локальных модулях.

## 4. Отступы, сетка, брейкпоинты

- Поля страницы `--page-pad`: 56 px, на ≤1150 - 28, на ≤640 - 16. Контент до 1200 px по центру.
- Базовая сетка отступов - 4/8: 6, 8, 12, 14, 16, 20, 24. Внутренний отступ панели 20 px; поле 12 px; высота кнопки 48 (sm 36), чипа 40.
- Брейкпоинты - ровно три (CSS не принимает переменные в `@media`, значения копируются буквально):

| Значение | Что меняется |
|---|---|
| `max-width: 1150px` | планшет: `--page-pad` 28, hero в одну колонку |
| `max-width: 1050px` | боковая панель профиля становится строкой (спека §10) |
| `max-width: 640px` | телефон: `--page-pad` 16, сетки в 1 колонку, шапка 72 px |

Других значений (1000, 900, 760 ...) в новом коде не вводить. Сейчас в модулях встречаются только эти три. Кроме них - `@media print` и `prefers-reduced-motion` (уже глобально гасит анимации).

## 5. Компоненты

Каталог: `platform/src/components/ui/` (импорт `@/components/ui`). Стили - в `components/ui.module.css`, поверх токенов. React 19: `ref` передаётся обычным пропом, `forwardRef` не нужен (подтверждено документацией React 19). Клиентский код: компоненты без состояния и хуков, кроме `Field` (`useId`), поэтому работают и в Server Components.

| Компонент | Назначение | Пропсы | Пример |
|---|---|---|---|
| `Button` | кнопка и ссылка-кнопка | `variant`: `primary` (чёрная, hover синяя) / `cta` (синяя, hover чёрная) / `ghost` (по умолчанию) / `danger`; `size`: `md` / `sm`; `loading` (блок + спиннер + `aria-busy`); `href` - рендер через `next/link`; `ref`; остальное от `<button>`/`<a>` | `<Button variant="cta" href="/consultant">К консультанту</Button>` |
| `Chip` | чип-фильтр, переключатель | `pressed` -> `aria-pressed`, чёрная заливка | `<Chip pressed={on} onClick={toggle}>Backend</Chip>` |
| `Tag` | моно-метка | `tone`: `plain` (серая) / `outline` / `solid` (синяя) / `dashed` | `<Tag tone="solid">платформа</Tag>` |
| `Panel` | стеклянная панель | `variant`: `glass` / `strong`; `as` - тег корня | `<Panel as="section">…</Panel>` |
| `Field` | поле формы: подпись, подсказка, ошибка | `label`, `hint`, `error`, один ребёнок `input/select/textarea`; сам ставит `id`, `aria-describedby`, `aria-invalid`; ошибка с `role="alert"` | `<Field label="Почта" error={e}><input type="email" /></Field>` |
| `Avatar` | силуэт-квадрат | `size` (px, по умолчанию 56); декоративный (`aria-hidden`) | `<Avatar size={48} />` |
| `Meter` | сегментная полоса покрытия | `value`, `max`, `label`; `role="img"` с подписью «N из M» | `<Meter value={3} max={5} />` |
| `Notice` | заметка / ошибка | `tone`: `info` (`role=status`) / `error` (`role=alert`) | `<Notice tone="error">{msg}</Notice>` |
| `Kicker` | кикер над заголовком | как `<span>` | `<Kicker>Backend · Middle</Kicker>` |
| `Skeleton` | заглушка контента с перелевом (shimmer на токенах `--line` / `--surface-ghost`; при `prefers-reduced-motion` статична) | `shape`: `line` (по умолчанию) / `block` / `circle`; `width`, `height` (число — px); `aria-hidden`, смысл — в соседнем `role="status"` | `<Skeleton width="60%" />` |
| `Spinner` | индикатор загрузки | нет; `aria-hidden`, смысл - в соседнем тексте | `<Spinner /> Загружаю…` |
| `VisuallyHidden` | текст для скринридера | как `<span>` | `<VisuallyHidden>Карта пробелов</VisuallyHidden>` |

Помощник `cx(...)` склеивает классы.

Где используются сейчас: `Button` - шапка («Выйти»), `ProfilePage` («К консультанту», «Печать / PDF», «На страницу входа»); `Notice` - `ProfilePage` (ошибка загрузки). Остальное - в списке «к переводу».

Составные компоненты экранов (не примитивы): `LevelBadge` (знак + текст + рамка по уровню доказанности), `ClaimCard`, `EventFeed`, `Chat`, `DefenseDialog`, `Uploader`, `Recommendations`, `onboarding/OnboardingChat` (онбординг — лента помощника на весь экран, см. «Лента чата»); кабинет работодателя — `components/employer/*` (`CandidateMatchCard`, `AssistantChat`, `AssistantCandidateCard`, `VacancyForm`, `FilterForm`, `InviteForm`, `IncomingInvitations`, `PrivacyToggle`, `RefinementHistory`, стили `Employer.module.css`). Шапка, подвал и колонка страницы — оболочка `components/shell` (см. «Оболочка»). Строятся из примитивов; общий кусок, повторившийся в двух экранах, выносится в `components/ui` через этот документ.

### К переводу на примитивы

Экраны меняют параллельные лейны, поэтому не переведены (при ближайшей правке экрана - переводить, ничего не ломая в виде):

- `Chat`, `EventFeed`, `ClaimCard`, `DefenseDialog`, `Uploader`, `Recommendations`: кнопки `ui.btn…` -> `Button`, поля -> `Field`, уведомления -> `Notice`.
- `ProfilePage`: кнопки решения по утверждениям (`ClaimItem`), `Panel`, `Meter`, `Avatar`, `Kicker`, спиннер загрузки - пока `ui.*` классами.
- `LevelBadge`: на `Tag` (`tone` по уровню).
- `LoginForm` и главная - лейн landing2.
- Сырые цвета в модулях (allowlist теста): ClaimCard 1, DefenseDialog 3, LoginForm 1, ProfilePage 3, Uploader 1 строк. Заменять токенами и уменьшать allowlist; увеличивать нельзя.

### Лента чата

Онбординг (`onboarding/OnboardingChat`), карьерный консультант (`Chat`, `EventFeed`) и помощник работодателя (`employer/AssistantChat`; выдача в сообщении — компактная `employer/AssistantCandidateCard` внутри `MessageCard`, черновик приглашения — открытая `InviteForm`) — одна сущность «помощник ФСП Карьеры» и один вид ленты. Примитивы — `platform/src/components/chat/Thread.tsx` (импорт `@/components/chat/Thread`: на macOS путь `components/chat` без файла совпадает с `Chat.tsx` по регистру), стили — `chat/thread.module.css`, появление — `chat/motion.ts`, автоскролл — `chat/scroll.ts`.

| Примитив | Назначение |
|---|---|
| `Thread` | `<ol>` ленты с `aria-label` («Переписка с помощником» / «с консультантом») |
| `AssistantRow` | строка помощника: знак ФСП слева (логотип шапки, без имени), справа содержимое; `mark={false}` — продолжение (шаги разбора, карточки, чипы) в той же колонке |
| `Bubble` | статичная реплика на стекле; `tone="error"` — ошибка/валидация репликой помощника (`role="alert"`) |
| `Reply` | реплика с появлением: «печатает» (три точки, 400–700 мс) → раскрытие по словам тем же движком, что `StreamingText` (`paced`) → целиком. Тап по реплике показывает её сразу. `prefers-reduced-motion` и среды без `matchMedia` — без анимации. `onDone` — когда текст показан: только после этого появляются чипы и поле ввода |
| `Typing` | «помощник печатает» (`role="status"`, текст для скринридера) |
| `UserBubble` | ответ пользователя — синий пузырь справа; `quiet` — пропуск («пропущу», серый); `action` — тихая ссылка «изменить» под пузырём |
| `QuickReplies` | быстрые ответы — `Chip` под последней репликой; чип с пояснением — подпись и пояснение в столбик; `pressed` — тоггл мультивыбора |
| `DoneLink` | тихое «Готово» (синяя ссылка) для мультивыбора и карточек; кнопок «Далее» в ленте нет |
| `MessageCard` | карточка внутри сообщения: демо-достижения ФСП, карточки кандидатов, черновики. Форм-карточек (ползунки, дропзона, сводка) в ленте нет: зарплата — чипы вилок + число в композере, документы — композер, сводка — обычная реплика |
| `Composer` (`chat/Composer.tsx`) | единый композер внизу ленты (липкий) для онбординга, консультанта и помощника работодателя: поле растёт до 180 px, Enter отправляет, Shift+Enter — перенос; `attachments` — скрепка с подсказкой лимитов, чипы вложений над полем, drag-n-drop файла на всю ленту (подложка «Брось файлы сюда»), вставка файла из буфера; ссылки — прямо в тексте; `voice` — кнопка микрофона; `sending` — кнопка «Отправить» со спиннером без смены размера; `aside` — тихие ссылки («Пропустить»), `hint` — подсказка справа; выключенное поле с плейсхолдером «Выбери вариант выше» на шагах с чипами |
| `AttachmentChip`, `AttachmentLimitsHint` | чип вложения: тип, имя (многоточие посередине), размер / «загружаю…» / ошибка, «×»; лимиты «PDF или DOCX · до 5 МБ · до 10 файлов» — на скрепке (hover/focus) и для скринридера |
| `VoiceButton` | микрофон: первый клик — объяснение, кто распознаёт (`browser` — «распознаёт браузер», `yandex` — SpeechKit); запись — синяя кнопка «стоп», кольцо по уровню сигнала, статус с таймером; распознанное дописывается в поле, само не отправляется; нет API — кнопка неактивна с `title`, `STT_PROVIDER=off` — кнопки нет |
| `StreamingText` | текст реплики, который растёт плавно: курсор в `requestAnimationFrame` догоняет поток (≈ 0,6 с отставания, после `done` хвост — ≈ 0,2 с), граница по словам, свежие слова проявляются за 220 мс (opacity + blur 2 px), каретка мигает; `paced` — готовый текст ≈ 2,5 с (160–700 зн/с); `prefers-reduced-motion` и история — сразу целиком. Арифметика — `chat/smooth-text.ts`, сборка ленты из `delta/discard/message` — `chat/stream-items.ts` |
| `ReplySkeleton` | пузырь-скелет (две строки) на месте будущей реплики, пока ждём сервер; потом приходит `Reply` («печатает…» → текст). Там, где ждём короткое действие (отправка файла), остаётся `Spinner` |
| `CardSkeleton` | скелет по форме `MessageCard` (заголовок + строки) для ответов-карточек |
| `ThreadSkeleton` | знак помощника и два пузыря-скелета: `loading.tsx` для `/onboarding` и `/consultant` |
| `ProgressLine` | тонкая полоса прогресса под шапкой, без цифр на экране (`role="progressbar"`, число — в `aria-label`) |

Появление: реплика и карточка выезжают за 180 мс (fade + сдвиг на 8 px); отправленный пузырь — из композера за 200 мс (fade + сдвиг 12 px + scale 0,98 → 1), композер очищается сразу; чипы — по очереди со сдвигом 50 мс (`--i`, не больше 12); входящая реплика стримится (`StreamingText`), «печатает» видно, пока реплика не началась. При `prefers-reduced-motion` анимации выключены глобально (`tokens.css`).

Состояния шага онбординга: реплика печатается → появляются интерактив (чипы / карточка / активное поле) → клик: интерактив исчезает, ответ сразу становится пузырём, под ним скелет реплики до ответа сервера → следующая реплика. Ошибка сервера или проверки — реплика `Bubble tone="error"`, интерактив остаётся. Перезагрузка: история рисуется статично из `OnboardingView.history`, текущая реплика печатается заново, лента сразу прокручена к ней. Тап по пузырю — исключение из правила «интерактивное — только `<button>`»: это ускоритель, текст появляется и сам.

### Оболочка

Шапка, подвал и колонка страницы - один набор на весь сайт, `components/shell/`. Страница про них ничего не знает.

- `app/layout.tsx` подключает `ShellFrame` один раз: ссылка «К содержимому», `SiteHeader`, страница, `SiteFooter`. Своих `Header` в `layout.tsx` групп нет.
- `SiteHeader` (серверный) читает сессию и отдаёт клиентскому `HeaderBar` ссылки роли из `shell/nav.ts`: кандидат - Консультант / Профиль / Тест / Приглашения, работодатель - Потребности / Поиск по базе / Приглашения. Гость видит «Войти»; на главной (`/`) гостю добавляются якоря «Компании / Почему мы», всем - «№ 01 · осень 2026». Вошедший видит «Выйти» и плашку «Онбординг не завершён» (`OnboardingBanner`). Ссылки роли менять только в `nav.ts`.
- Лэйаут не перерисовывается при клиентской навигации (Next.js 15), поэтому после входа и выхода нужен `router.refresh()`; экраны входа и `LogoutButton` его вызывают. Новый способ войти/выйти обязан делать то же.
- Исключения: `/onboarding` без шапки и подвала (у чата своя полоса с `Brand` и «Настроить позже», список `BARE_PATHS` в `ShellFrame`); тест в процессе скрывает оболочку через `useBareShell(active)`. Другие страницы-исключения - добавить путь в `BARE_PATHS` или вызвать хук.
- Клиентские файлы импортируют конкретные модули (`shell/Brand`, `shell/ShellFrame`), не `shell/index.ts`: иначе `SiteHeader` (`next/headers`) попадёт в клиентский бандл.
- `Container size="text|default|wide"` - колонка 720 / 960 / 1120 px с полями `--page-pad`; `PageTitle` - кикер + h1 + лид. `Brand` - знак и «/карьера», везде один.

Как добавить страницу: создать `app/<путь>/page.tsx` с корнем `<main id="main">`, внутри `Container` и `PageTitle`. Шапка и подвал появятся сами; ссылку в навигацию - в `shell/nav.ts`. Ошибку API и пустое состояние показывать через `Notice` (`tone="error"` / по умолчанию), а не сырым `ui.notice`.

### Дебаг-панель

`components/devtools/DevPanel` (клиентская) - плавающая круглая кнопка `dev` справа внизу (`bottom: 112px`, над композером чата, не перекрывает индикатор Next слева) и поповер на `Button`/`Kicker` с токенами; подтверждение удаления - встроенный блок `role="alertdialog"` в самой панели (отдельного modal-примитива в `ui/` нет). Монтируется только серверным `DevPanelGate` на localhost, в production не отдаётся; на экранах для пользователя не показывается и в макеты не входит. Описание и гейт - `platform/README.md`, «Дебаг-панель».

## 6. Состояния

| Состояние | Правило |
|---|---|
| hover | кнопка-призрак: рамка `--ink`; primary -> синяя; cta -> чёрная; чип: рамка `--ink`. Только `:not(:disabled)` |
| focus | глобально `:focus-visible { outline: 2px solid var(--blue); outline-offset: 3px }`, у полей - синяя рамка. Не убирать `outline` |
| disabled | `opacity .5`, курсор по умолчанию; пояснять причину текстом рядом, не молчать |
| loading | `Button loading` или `<Spinner />` + текст «Загружаю…» с `role="status"`; контейнер `aria-busy="true"` |
| error | `Notice tone="error"` или `Field error`; текст объясняет, что делать; `role="alert"` |
| empty | честный текст «нет …» с `role="status"` и подсказкой следующего шага; не рисовать выдуманные примеры |

## 7. Доступность

- Контраст: основной текст `--ink` на `--paper` ≈ 16.7:1; `--muted` `#6b6b70` на `--paper` ≈ 4.7:1 (минимум для мелкого текста) - светлее не делать; белый на синем `#402fff` ≈ 6.8:1.
- Фокус всегда виден; порядок Tab = визуальный; есть ссылка «К содержимому» в шапке.
- Поле без видимой подписи - только с `aria-label`; подписи полей - через `Field`.
- Ошибки и статусы - `role="alert"` / `role="status"`; значение индикатора (Meter, LevelBadge) продублировано текстом.
- Цель нажатия ≥ 36 px (sm) / 48 px; интерактивное - `<button>`/`<a>`, не `div`.
- Анимации гасятся `prefers-reduced-motion` (глобально).

## 8. Адаптив

Экран обязан работать на 360 px без горизонтальной прокрутки: сетки сворачиваются в одну колонку на ≤640, длинные слова и ссылки переносятся (`overflow-wrap`), таблицы - в `overflow-x: auto` внутри своей панели, а не на странице. Проверять браузером на 360 и 1280 перед PR на экран.

## 9. Запреты

- Лайм `#D4FF3A` - только на карте; красный `#EC1D35` - нигде.
- Сырые `#hex` и `rgb()/rgba()/hsl()` в `*.module.css` вне `tokens.css` - нельзя (тест). Единичное исключение - печатная раскладка, строка помечается комментарием `raw-ok: печать`.
- Тени, градиенты, свечения на панелях; скругления.
- Новые шрифты и шрифтовые размеры вне шкалы `--fs-*` (кроме hero лендинга).
- Новые брейкпоинты сверх трёх.
- Выдуманные данные ФСП, цифры и «демо» без пометки.
- Инлайновые стили для цвета и размеров; `style` допустим только для динамических значений (как `--avatar`).

## 10. Как добавить

### Тестовый экран сетчатого консультанта

Эксперимент v2 доступен отдельной страницей `/design/consultant-grid-v2`;
одобренный v1 сохранён в `design-baselines/consultant-grid-v1` и
`public/design/consultant-grid-v1`. Кнопки на существующем `Button` переключают
страницы «Сохранённый v1» и «Тест v2». Начальные настройки сохранённого вида:
42 px / 1.25 / 0.18. В v2 WebGL рисует невидимую поверхность в буфер глубины,
затем только линии и узлы сетки; нет заливки головы, материала или отдельного
треугольного каркаса. Модель, поза и речевая анимация — из исходного экспорта.

`/design/consultant-grid-preview` показывает предоставленный 10 октября экспорт
`consultant-handoff` в отдельном документе iframe: его собственные шрифты,
вёрстка и Canvas 2D остаются эталоном 1:1. Это изолированный дизайн-мокап,
сценарный чат с вымышленным профилем, а не рабочий консультант.
`ConsultantGridPreview` использует существующие `Button`, `Field`, `Kicker`,
`Notice` и токены для сворачиваемой панели над макетом. Регулировки:
шаг сетки 16–80 px (46 по умолчанию), выпуклость 0.3–1.6 (1), угол 0–0.9 (0.5).
Сброс восстанавливает экспорт; изменения применяются без перезапуска чата.
Исходная палитра внутри импортированного HTML сохраняется буквально.
На 360 px адаптируются только шапка, бейджи и поле ввода, чтобы убрать
переполнение исходного экспорта. Новые UI-примитивы и цвета не нужны.

Новый токен: строка в таблице выше -> `tokens.css` -> использование. Новый компонент: строка в каталоге (назначение, пропсы, пример) -> файл в `components/ui` + экспорт в `index.ts` -> тест в `tests/unit/components/ui/`. Проверка: `npm run typecheck && npm run lint && npx vitest run --project components --project unit`.

Восстановление от 9 октября: мобильный граф держит длинные счётчики вакансий отдельной строкой под названием компании; фон чата — общая статичная сетка. Блок статистики автоматически размещает все показатели, а последний нечётный на узком экране занимает всю строку.

## Консультант: цифровой собеседник

`ConsultantScene` (`components/head/ConsultantScene.tsx`) размещает ленту слева, область давления лица справа на больших экранах. `ConsultantHead` использует модель из ветки `codex/interactive-head` только как источник глубины для одной натянутой сетки на весь фон. Видны только линии, словно человек прижал лицо к сетке с обратной стороны. У сетки одинаковый шаг 24 px, цвет и толщина по всему экрану; нет отдельного контура, заливки, плотности или контраста головы. Линии `--ink` на `--paper`. Canvas фиксирован на весь viewport за содержимым, чтобы длинные чаты не создавали огромный GPU-буфер. Плавные волны двигают всю поверхность, включая фон вокруг лица; давление лица меняется при дыхании, повороте за мышью и процедурном моргании. Существующий `Button` размера `sm` в правом нижнем углу останавливает и включает всю анимацию. Canvas декоративный, кнопка остаётся доступной клавиатуре. На экранах до 1050 px canvas скрыт и GLB не загружается. При reduced-motion остаётся неподвижная сетка без кнопки включения движения. При скрытой вкладке и невидимом портрете анимация останавливается. При отсутствии WebGL остаётся статичная фоновая сетка без отдельной фотографии головы. Загрузчик страницы резервирует раскладку без повторной загрузки модели.

Стрелка «Приступим» - SVG 56×32 с квадратными концами и толщиной 5; на телефоне 46×28. В интерфейсных текстах длинные тире заменены обычным дефисом с пробелами; пользовательский текст и цитаты источников не переписываются.

### Consultant portrait restoration, 9 October
The consultant uses the separate Neuron wire material (mode 4) from codex/interactive-head over the original static landing grid. The canvas stays within the right portrait column, uses a transparent background and cannot paint over the chat or the page grid. No new colors or components are introduced. This supersedes the full-page deforming grid described above.

### Glass consultant portrait, 9 October
The user selected the glass material (mode 5) from codex/interactive-head. The local transparent canvas renders back and front glass surfaces and refracts a texture of the existing static 48px grid, using only paper, ink and blue tokens. The surrounding background and layout remain the same.

### Local liquid-metal portrait
The latest local selection is soft pearlescent metal: diffuse light, broad satin
reflections and a subtle blue pearl sheen derived from the existing tokens.
Extend only the lower neck
downwards; a smooth alpha fade dissolves its base into the existing page grid.
No smoke particles or overlay are used. Face pose, scale and tracking stay fixed.
Small shoulder hints extend the existing bust base on each side; their outer
and lower silhouette remains translucent and fades out before the mesh edge.

The consultant conversation adopts the supplied consultant-handoff styling:
a square glass panel with a separately scrolling feed, 36px dark assistant
mark, 16px messages, bordered quick actions and a fixed composer within the
panel. The title includes the mono subtitle and links to the existing profile
and test routes (the export's map/interview routes do not exist in the app).
Existing tokens and chat/UI primitives are reused; embedded onboarding retains
its current appearance. The accepted chrome portrait stays on the right.

The user selected the face1.png reference in place of the curtain experiment.
Use smooth geometry normals and silver studio
reflections, without glass transmission or a projected page grid on the face.
Normal-map relief and baked lattice markings are disabled in metallic mode. Forehead geometry repair keeps the broad shape smooth. The portrait camera
leaves clearance at both yaw limits; thin ears render from both sides.
The user requested publication on 10 October; the pearlescent variant replaces
the earlier glass material on the consultant page.

### Animated glass consultant, 9 October
The glass portrait may blink and deform at the neck while its shoulder base stays fixed. Mouth movement uses Blender facial morphs. Speech controls use existing small Buttons, with a labelled demo recording started by the user, no autoplay or microphone. The static page grid and left chat layout remain unchanged; reduced-motion stops the decorative animation.
