# HH.ru Auto Responder

Автоматический отклик на вакансии hh.ru с генерацией сопроводительных писем через Google Gemini AI.

## Автор

[![Telegram](https://img.shields.io/badge/Telegram-@huhguz-2CA5E0?style=flat&logo=telegram&logoColor=white)](https://t.me/huhguz)

## Вдохновение

[![GitHub](https://img.shields.io/badge/GitHub-jointime1/n8n--hh.ru-181717?style=flat&logo=github&logoColor=white)](https://github.com/jointime1/n8n-hh.ru)

## Возможности

- Параллельная работа с несколькими аккаунтами одновременно
- Сохранение сессий — повторный вход через OTP только при истечении куки
- Генерация сопроводительных писем через Gemini AI (кэширование по вакансии)
- Отклики постранично — сначала откликается на все вакансии страницы, потом переходит к следующей
- Параллельные отклики внутри страницы (настраивается `concurrencyPerAccount`)
- 4 стратегии отклика: modal, dropdown, inline-форма, прямой отклик
- Пропуск вакансий с опросником работодателя
- Лимит откликов за запуск (`maxVacanciesPerRun`)

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
  "maxVacanciesPerRun": 1000
}
```

| Параметр | Описание |
|---|---|
| `searchQuery` | Поисковый запрос (название вакансии) |
| `area` | Регион: `113` — Россия, `1` — Москва, `2` — Санкт-Петербург |
| `headless` | `false` — показывать браузер (рекомендуется, hh.ru блокирует headless) |
| `geminiApiKey` | API ключ Google Gemini |
| `concurrencyPerAccount` | Кол-во параллельных откликов на один аккаунт |
| `delayBetweenAppliesMs` | Задержка после каждого отклика (мс) |
| `maxVacanciesPerRun` | Максимум откликов за один запуск |

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
    index.js             — оркестрация: логин, параллельные воркеры
    auth.js              — OTP-логин и управление сессиями
    search.js            — поиск вакансий с пагинацией
    apply.js             — 4 стратегии отклика
    ai.js                — генерация письма через Gemini
    config.js            — загрузка конфига и аккаунтов
```
