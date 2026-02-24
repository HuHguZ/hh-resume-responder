# HH.ru Auto Responder

Автоматический отклик на вакансии hh.ru с генерацией сопроводительных писем через Google Gemini AI.

## Автор

[![Telegram](https://img.shields.io/badge/Telegram-@huhguz-2CA5E0?style=flat&logo=telegram&logoColor=white)](https://t.me/huhguz)

## Вдохновение

[![GitHub](https://img.shields.io/badge/GitHub-jointime1/n8n--hh.ru-181717?style=flat&logo=github&logoColor=white)](https://github.com/jointime1/n8n-hh.ru)

## Возможности

### Аккаунты и авторизация
- Параллельная работа с несколькими аккаунтами одновременно
- OTP-вход через телефон или email
- Сохранение сессий — повторный вход только при истечении куки

### Поиск вакансий
- Поиск по запросу и региону с полной пагинацией по страницам
- Автоматическая загрузка и парсинг резюме с профиля hh.ru (опыт, навыки, образование, о себе)
- Фильтрация нерелевантных вакансий через Gemini AI — отсеивает вакансии другой специализации (даже с приставками IT/Digital/Tech)

### Отклики
- 4 стратегии отклика под разные UI-паттерны hh.ru: ссылка «Написать сопроводительное», dropdown «С сопроводительным письмом», клик кнопки с автоопределением типа ответа, вариант «Резюме доставлено»
- Параллельные отклики внутри страницы (настраивается `concurrencyPerAccount`)
- Постраничная обработка: сначала все вакансии страницы, потом следующая
- Лимит откликов за запуск (`maxVacanciesPerRun`)
- Обнаружение исчерпания лимита hh.ru (200 откликов / 24ч) и остановка аккаунта

### AI-генерация
- Генерация персонального сопроводительного письма под каждую вакансию через Gemini
- Кэширование писем по паре «вакансия + работодатель» — API не вызывается дважды
- Автозаполнение опросника работодателя через AI: textarea, radio, checkbox, select
- Умные прямые ответы на вопросы про зарплату и Telegram (без API-запроса)

### Надёжность
- Детектирование капчи и остановка при блокировке
- Определение уже отправленных откликов (пропуск дублей)
- Ретрай запросов к Gemini (до 3 попыток с паузой)
- Итоговая статистика по каждому аккаунту: отправлено / повтор / пропущено / ошибки

## Установка

```bash
npm install
```

## Настройка

Отредактируй `config/config.json`:

```json
{
  "searchQuery": "Frontend разработчик",
  "area": "113",
  "headless": false,
  "sessionDir": "./sessions",
  "accountsFile": "./config/accounts.json",
  "geminiModel": "gemini-3-flash-preview",
  "geminiApiKey": "YOUR_GEMINI_API_KEY",
  "concurrencyPerAccount": 5,
  "delayBetweenAppliesMs": 2000,
  "maxVacanciesPerRun": 1000,
  "salaryExpectation": "от 400000 на руки",
  "telegram": "@username"
}
```

| Параметр | Описание |
|---|---|
| `searchQuery` | Поисковый запрос (название вакансии) |
| `area` | Регион: `113` — Россия, `1` — Москва, `2` — Санкт-Петербург |
| `headless` | `false` — показывать браузер (рекомендуется, hh.ru блокирует headless) |
| `geminiApiKey` | API ключ Google Gemini |
| `geminiModel` | Модель Gemini (например `gemini-2.0-flash`) |
| `concurrencyPerAccount` | Кол-во параллельных откликов на один аккаунт |
| `delayBetweenAppliesMs` | Задержка после каждого отклика (мс) |
| `maxVacanciesPerRun` | Максимум откликов за один запуск |
| `salaryExpectation` | Ответ на вопрос про зарплату в опросниках |
| `telegram` | Telegram-ник для вопросов про контакты |

### Аккаунты

При первом запуске скрипт спросит данные аккаунтов и сохранит их в `config/accounts.json`.

Формат `config/accounts.json`:

```json
[
  { "id": "account_0", "type": "phone", "credential": "+79001234567" },
  { "id": "account_1", "type": "email", "credential": "user@example.com" }
]
```

## Запуск

```bash
npm start
```

При первом запуске (или истечении сессии) скрипт откроет браузер и попросит ввести OTP-код из SMS/email.

## Структура проекта

```
hh-resume-responder/
  config/
    config.json          — настройки
    accounts.json        — аккаунты (создаётся при первом запуске)
  sessions/
    account_0.json       — сохранённые сессии Playwright
  src/
    index.js             — оркестрация: логин, параллельные воркеры, статистика
    auth.js              — OTP-логин и управление сессиями
    search.js            — поиск вакансий с пагинацией
    apply.js             — 4 стратегии отклика
    questionnaire.js     — AI-заполнение опросников работодателя
    resume.js            — парсинг резюме с профиля hh.ru
    ai.js                — Gemini: генерация писем, фильтрация релевантности
    config.js            — загрузка конфига и аккаунтов
```
