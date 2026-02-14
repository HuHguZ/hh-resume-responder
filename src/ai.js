import { GoogleGenAI } from '@google/genai'

// In-memory кэш: одна и та же вакансия не вызывает повторный API-запрос
// (полезно когда несколько аккаунтов откликаются на одни вакансии)
const cache = new Map()

let genai = null

function getClient(config) {
  if (!genai) {
    genai = new GoogleGenAI({ apiKey: config.geminiApiKey })
  }
  return genai
}

export async function generateCoverLetter(config, { title, employer, description }) {
  const cacheKey = `${title}|${employer}`
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)
  }

  const prompt = `Сгенерируй ОЧЕНЬ короткое сопроводительное письмо для отклика на вакансию.

Входные данные:
Название вакансии: ${title}
Компания: ${employer}
Описание/требования: ${description.slice(0, 800)}

Жёсткие требования:
- 2–3 предложения, не больше
- Без приветствий и подписей
- Без фраз: «с большим интересом», «уверен», «буду рад», «внести вклад»
- Текст должен выглядеть как написанный человеком, не HR и не нейросетью
- Прямо укажи, что есть релевантный опыт по вакансии ${title}
- Профессионально, но разговорно
- Только финальный текст письма
- Никаких комментариев, пояснений или советов
- Русский язык
- не оставляй в конце системный комментарий с [Ваше имя]`

  const client = getClient(config)
  const maxAttempts = 3

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await client.models.generateContent({
        model: config.geminiModel,
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      })

      const text = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null
      if (text) {
        cache.set(cacheKey, text)
        console.log(`[ai] Письмо сгенерировано для "${title}"`)
        return text
      }
    } catch (err) {
      console.warn(`[ai] Попытка ${attempt}/${maxAttempts} не удалась для "${title}": ${err.message}`)
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 1000 * attempt))
      }
    }
  }

  console.error(`[ai] Все ${maxAttempts} попытки провалились для "${title}", отклик без письма`)
  return null
}
