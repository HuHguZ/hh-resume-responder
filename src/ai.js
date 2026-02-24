import { GoogleGenAI } from '@google/genai'

const cache = new Map()

let genai = null

function getClient(config) {
  if (!genai) {
    genai = new GoogleGenAI({ apiKey: config.geminiApiKey })
  }
  return genai
}

/**
 * Универсальная функция генерации текста через Gemini с ретраем и кэшем.
 * @param {object} config — конфиг с geminiApiKey, geminiModel
 * @param {string} prompt — промпт
 * @param {object} [opts]
 * @param {string} [opts.cacheKey] — ключ кэша (если не указан — без кэша)
 * @param {string} [opts.label] — метка для логов
 * @param {number} [opts.maxAttempts] — количество попыток (по умолч. 3)
 */
export async function generateText(config, prompt, opts = {}) {
  const { cacheKey, label = 'prompt', maxAttempts = 3 } = opts

  if (cacheKey && cache.has(cacheKey)) {
    return cache.get(cacheKey)
  }

  const client = getClient(config)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await client.models.generateContent({
        model: config.geminiModel,
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      })

      const text = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null
      if (text) {
        if (cacheKey) cache.set(cacheKey, text)
        return text
      }
    } catch (err) {
      console.warn(`[ai] Попытка ${attempt}/${maxAttempts} не удалась (${label}): ${err.message}`)
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 1000 * attempt))
      }
    }
  }

  console.error(`[ai] Все ${maxAttempts} попытки провалились (${label})`)
  return null
}

export async function checkVacancyRelevance(config, { title, description }) {
  const resumeText = config.resumeData?.resumeText
  if (!resumeText) return true // нет резюме — не фильтруем

  const prompt = `Ты — строгий HR-фильтр. Определи, подходит ли данная вакансия кандидату по специализации.

РЕЗЮМЕ КАНДИДАТА:
${resumeText}

ВАКАНСИЯ:
Название: ${title}
Описание: ${(description || '')}

ШАГ 1 — проверь, есть ли в названии вакансии конкретная платформа, CMS или корпоративная система: 1С-Битрикс, Битрикс24, SAP, WordPress, Drupal, Magento, Salesforce, 1С:ERP, Jira, ServiceNow и т.п. Это НЕ отраслевые маркеры — это ключевые технические требования. Если такая платформа есть в названии, и её нет в стеке кандидата — ответ NO.
ШАГ 2 — убери из названия вакансии отраслевые маркеры: IT, Digital, Tech, EdTech, FinTech, название отрасли (банк, страхование, ритейл и т.п.). Определи ФУНКЦИЮ вакансии по оставшимся словам.
ШАГ 3 — определи ФУНКЦИЮ кандидата: чем он занимается согласно резюме?
ШАГ 4 — совпадают ли функции?

Ответь YES если функции совпадают или вакансия смежная и ключевые навыки кандидата являются основными требованиями.
Ответь NO если функции принципиально разные или требуется специфическая платформа которой нет в стеке кандидата.

ВАЖНЫЕ ПРАВИЛА:
- 1С-Битрикс, Битрикс24, SAP, WordPress, Drupal и подобные корпоративные платформы/CMS — это ТЕХНИЧЕСКИЙ СТЕК, а не отраслевой маркер. Если платформа указана в названии вакансии, кандидат обязан иметь с ней опыт
- Слова IT, Digital, Tech, EdTech, FinTech — это всегда отраслевые маркеры, где бы они ни стояли: в начале, в скобках, после тире или слэша. «IT Менеджер проектов» = «Менеджер проектов» (управление), «FinTech Frontend» = «Frontend» (разработка)
- Если кандидат — технический специалист (разработчик, инженер и т.п.), то менеджерские, продажные, маркетинговые, HR-позиции — всегда NO, даже с приставкой IT/Tech/Digital
- Ориентируйся прежде всего на ФУНКЦИОНАЛЬНЫЕ слова названия (менеджер, разработчик, инженер, аналитик и т.д.), игнорируя отраслевые маркеры
- Не давай кандидату пользу сомнения если специализация явно другая
- Отвечай СТРОГО одним словом без знаков препинания: YES или NO`

  const result = await generateText(config, prompt, {
    label: `релевантность "${title}"`,
    maxAttempts: 2,
  })

  if (!result) return false // ошибка запроса — пропускаем вакансию (безопаснее, чем отправлять нерелевантный отклик)

  const answer = result.trim().toUpperCase()
  const relevant = answer.startsWith('YES')
  if (!relevant) {
    console.log(`[ai] Нерелевантная вакансия пропущена: "${title}" (ответ: ${answer.slice(0, 10)})`)
  }
  return relevant
}

export async function generateCoverLetter(config, { title, employer, description }) {
  const resumeBlock = config.resumeData?.resumeText
    ? `\nРезюме кандидата:\n${config.resumeData.resumeText}\n`
    : ''

  const prompt = `Сгенерируй ОЧЕНЬ короткое сопроводительное письмо для отклика на вакансию.

Входные данные:
Название вакансии: ${title}
Компания: ${employer}
Описание/требования: ${description.slice(0, 800)}
${resumeBlock}
Жёсткие требования:
- 2–3 предложения, не больше
- Без приветствий и подписей
- Без фраз: «с большим интересом», «уверен», «буду рад», «внести вклад»
- Текст должен выглядеть как написанный реальным человеком, а НЕ нейросетью или HR-ботом
- Упомяни конкретный релевантный опыт из резюме, подходящий под эту вакансию
- Профессионально, но разговорно
- КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО использовать квадратные скобки [], плейсхолдеры типа [ссылка], [имя], [компания]. Если чего-то не знаешь — просто не упоминай это, обойди красиво
- Не вставляй подпись, имя, "С уважением" или что-то подобное в конце
- Только финальный текст письма
- Никаких комментариев, пояснений или советов
- Русский язык`

  const text = await generateText(config, prompt, {
    cacheKey: `letter|${title}|${employer}`,
    label: `письмо для "${title}"`,
  })

  if (text) {
    console.log(`[ai] Письмо сгенерировано для "${title}"`)
  } else {
    console.error(`[ai] Не удалось сгенерировать письмо для "${title}", отклик без письма`)
  }

  return text
}
