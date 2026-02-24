import { generateText } from './ai.js'

const SALARY_KEYWORDS = [
  'зарплат', 'оклад', 'оплат', 'доход', 'ставк', 'вознагражден',
  'salary', 'компенсац', 'з/п', 'зп', 'финансов', 'денежн',
  'сколько.*хотите', 'сколько.*получать', 'ожидани.*по оплате',
]

const TELEGRAM_KEYWORDS = [
  'telegram', 'телеграм', 'тг', 'tg', '@',
]

function isSalaryQuestion(question) {
  const lower = question.toLowerCase()
  return SALARY_KEYWORDS.some(kw => lower.match(new RegExp(kw)))
}

function isTelegramQuestion(question) {
  const lower = question.toLowerCase()
  return TELEGRAM_KEYWORDS.some(kw => lower.includes(kw))
}

function getDirectAnswer(question, config) {
  if (isSalaryQuestion(question)) {
    return config.salaryExpectation || 'от 400000 на руки'
  }
  if (isTelegramQuestion(question)) {
    return config.telegram || ''
  }
  return null
}

function buildPrompt(question, vacancyDescription, resumeText) {
  const resumeBlock = resumeText ? `\nРезюме кандидата:\n${resumeText}\n` : ''

  return `Ты помогаешь кандидату ответить на вопрос работодателя при отклике на вакансию.

Описание вакансии:
${vacancyDescription}
${resumeBlock}
Вопрос работодателя: "${question}"

Требования к ответу:
- Ответь на базе реального опыта из резюме — приукрашивай где нужно, чтобы ответ звучал максимально убедительно
- Ответь так, чтобы ответ одобрила нанимающая сторона — максимально позитивно и релевантно
- Покажи, что кандидат подходит и мотивирован
- Используй конкретные факты из резюме (компании, технологии, достижения)
- Ответ 3-5 предложений, конкретно по вопросу
- Профессионально но не шаблонно, как реальный человек
- КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО использовать квадратные скобки [] или любые плейсхолдеры типа [ссылка], [компания], [имя] и т.д.
- Если не знаешь конкретный факт (ссылку, название, дату) — обойди вопрос красиво, ответь обобщённо или переведи фокус на другой аспект. Никогда не вставляй заглушки
- Текст должен выглядеть как написанный реальным человеком, а НЕ нейросетью. Никаких шаблонных оборотов
- Только текст ответа, без комментариев или пояснений
- Русский язык`
}

function buildRadioPrompt(question, options, vacancyDescription, resumeText) {
  const resumeBlock = resumeText ? `\nРезюме кандидата:\n${resumeText}\n` : ''

  return `Ты помогаешь кандидату ответить на вопрос работодателя при отклике на вакансию.

Описание вакансии:
${vacancyDescription}
${resumeBlock}
Вопрос работодателя: "${question}"

Доступные варианты ответа (выбери ОДИН самый подходящий):
${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}

ВАЖНО: ответь ТОЛЬКО номером варианта (одна цифра). Выбери тот вариант, который максимально позитивно представит кандидата на основе его резюме.
НИКОГДА не выбирай "Свой вариант" — всегда выбирай один из конкретных готовых вариантов.
Ничего кроме цифры не пиши.`
}

function buildCheckboxPrompt(question, options, vacancyDescription, resumeText) {
  const resumeBlock = resumeText ? `\nРезюме кандидата:\n${resumeText}\n` : ''

  return `Ты помогаешь кандидату ответить на вопрос работодателя при отклике на вакансию.
${resumeBlock}
Описание вакансии:
${vacancyDescription}

Вопрос работодателя: "${question}"

Доступные варианты (можно выбрать НЕСКОЛЬКО):
${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}

ВАЖНО: ответь ТОЛЬКО номерами вариантов через запятую (например: 1,3,5).
Выбери ВСЕ варианты, с которыми кандидат реально работал (на основе резюме) — чем больше релевантных, тем лучше.
НЕ выбирай "Свой вариант" если есть подходящие готовые варианты.
Ничего кроме цифр через запятую не пиши.`
}

/**
 * Извлекает все вопросы со страницы опросника.
 * Поддерживает: textarea, radio, checkbox, select.
 */
async function extractQuestions(page) {
  return page.evaluate(() => {
    const result = []

    // Хелпер для поиска текста вопроса
    function findQuestion(startEl, excludeSelector) {
      let el = startEl
      for (let d = 0; d < 8; d++) {
        if (!el.parentElement) break
        el = el.parentElement
        const fc = el.children?.[0]
        if (fc && !fc.querySelector(excludeSelector)) {
          const text = fc.textContent?.trim()
          if (text && text.length > 10) return text
        }
        const prev = el.previousElementSibling
        if (prev && !prev.querySelector(excludeSelector)) {
          const text = prev.textContent?.trim()
          if (text && text.length > 10) return text
        }
      }
      return ''
    }

    // --- Textarea ---
    const allTAs = Array.from(document.querySelectorAll('textarea'))
    for (let i = 0; i < allTAs.length; i++) {
      const ta = allTAs[i]
      let questionText = ''

      // Стратегия 1: 5 уровней вверх → firstChild
      let block = ta
      for (let d = 0; d < 5; d++) {
        if (block.parentElement) block = block.parentElement
      }
      const firstChild = block.children?.[0]
      if (firstChild && !firstChild.querySelector('textarea')) {
        const text = firstChild.textContent?.trim()
        if (text && text.length > 10) questionText = text
      }

      // Стратегия 2: фоллбэк через previousSibling
      if (!questionText) {
        questionText = findQuestion(ta, 'textarea')
      }

      // Пропускаем textarea-поля "Свой вариант" внутри checkbox/radio групп
      if (!questionText || questionText.length <= 3) continue
      if (questionText === 'Свой вариант') continue

      result.push({ type: 'textarea', question: questionText, textareaIndex: i })
    }

    // --- Checkbox-группы ---
    const cbGroups = {}
    for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
      const name = cb.name
      if (!name) continue
      if (!cbGroups[name]) cbGroups[name] = []
      const label = cb.closest('label')?.textContent?.trim() || cb.parentElement?.textContent?.trim() || ''
      cbGroups[name].push(label)
    }

    for (const [name, options] of Object.entries(cbGroups)) {
      const firstCB = document.querySelector(`input[type="checkbox"][name="${name}"]`)
      if (!firstCB) continue
      const questionText = findQuestion(firstCB, 'input[type="checkbox"]') || name
      result.push({ type: 'checkbox', question: questionText, checkboxName: name, options })
    }

    // --- Radio-группы ---
    const radioGroups = {}
    for (const r of document.querySelectorAll('input[type="radio"]')) {
      const name = r.name
      if (!name) continue
      if (!radioGroups[name]) radioGroups[name] = []
      const label = r.closest('label')?.textContent?.trim() || r.parentElement?.textContent?.trim() || ''
      radioGroups[name].push(label)
    }

    for (const [name, options] of Object.entries(radioGroups)) {
      const firstRadio = document.querySelector(`input[type="radio"][name="${name}"]`)
      if (!firstRadio) continue
      const questionText = findQuestion(firstRadio, 'input[type="radio"]') || name
      result.push({ type: 'radio', question: questionText, radioName: name, options })
    }

    // --- Select ---
    const selects = document.querySelectorAll('select')
    for (let i = 0; i < selects.length; i++) {
      const sel = selects[i]
      const questionText = findQuestion(sel, 'select') || 'Выберите вариант'
      const options = Array.from(sel.options).map(o => o.textContent?.trim()).filter(Boolean)
      if (options.length > 0) {
        result.push({ type: 'select', question: questionText, selectIndex: i, options })
      }
    }

    return result
  })
}

/**
 * Заполняет опросник работодателя на странице отклика.
 */
export async function fillQuestionnaire(config, page, vacancy) {
  const questions = await extractQuestions(page)
  if (questions.length === 0) {
    console.warn(`[questionnaire] Не найдено вопросов на странице`)
    return false
  }

  console.log(`[questionnaire] Найдено ${questions.length} вопрос(ов) для "${vacancy.title}"`)

  for (const q of questions) {
    if (q.type === 'textarea') {
      await handleTextarea(config, page, q, vacancy)
    } else if (q.type === 'checkbox') {
      await handleCheckbox(config, page, q, vacancy)
    } else if (q.type === 'radio') {
      await handleRadio(config, page, q, vacancy)
    } else if (q.type === 'select') {
      await handleSelect(config, page, q, vacancy)
    }
  }

  // Кликаем "Откликнуться"
  const submitBtn = page.locator('[data-qa="vacancy-response-submit-popup"]')
  if (await submitBtn.count() > 0) {
    await submitBtn.click()
    await page.waitForTimeout(2000)
    console.log(`[questionnaire] Опросник отправлен для "${vacancy.title}"`)
    return true
  }

  console.warn(`[questionnaire] Кнопка отправки не найдена`)
  return false
}

async function handleTextarea(config, page, q, vacancy) {
  const textareas = await page.$$('textarea')
  const ta = textareas[q.textareaIndex]
  if (!ta) return

  const direct = getDirectAnswer(q.question, config)
  if (direct) {
    await ta.fill(direct)
    console.log(`[questionnaire] Прямой ответ на: "${q.question.slice(0, 60)}..." → ${direct}`)
    return
  }

  const resumeText = config.resumeData?.resumeText || ''
  const prompt = buildPrompt(q.question, vacancy.description || '', resumeText)
  const answer = await generateText(config, prompt, {
    label: `вопрос: "${q.question.slice(0, 50)}..."`,
  })

  if (!answer) {
    console.warn(`[questionnaire] Не удалось сгенерировать ответ на: "${q.question.slice(0, 60)}..."`)
    return
  }

  await ta.fill(answer)
  console.log(`[questionnaire] Заполнен ответ на: "${q.question.slice(0, 60)}..."`)
}

async function handleCheckbox(config, page, q, vacancy) {
  const resumeText = config.resumeData?.resumeText || ''

  // Фильтруем "Свой вариант" — AI не должен его видеть
  const filteredOptions = []
  const originalIndices = []
  for (let i = 0; i < q.options.length; i++) {
    const opt = q.options[i].trim()
    if (opt === 'Свой вариант' || opt === 'Другое' || opt === 'Other') continue
    filteredOptions.push(opt)
    originalIndices.push(i)
  }

  if (filteredOptions.length === 0) {
    console.warn(`[questionnaire] Нет вариантов кроме "Свой вариант" для чекбоксов: "${q.question.slice(0, 60)}..."`)
    return
  }

  const prompt = buildCheckboxPrompt(q.question, filteredOptions, vacancy.description || '', resumeText)
  const answer = await generateText(config, prompt, {
    label: `checkbox: "${q.question.slice(0, 50)}..."`,
  })

  if (!answer) {
    console.warn(`[questionnaire] Не удалось выбрать чекбоксы для: "${q.question.slice(0, 60)}..."`)
    return
  }

  // AI возвращает "1,3,5" — парсим номера (они относятся к filteredOptions)
  const filteredIndices = answer.trim().split(/[,\s]+/).map(s => parseInt(s.trim(), 10) - 1).filter(n => !isNaN(n) && n >= 0 && n < filteredOptions.length)

  if (filteredIndices.length === 0) {
    console.warn(`[questionnaire] AI вернул некорректные номера "${answer}" для чекбоксов: "${q.question.slice(0, 60)}..."`)
    return
  }

  // Маппим обратно на оригинальные индексы
  const realIndices = filteredIndices.map(fi => originalIndices[fi])

  const checkboxes = page.locator(`input[type="checkbox"][name="${q.checkboxName}"]`)
  for (const idx of realIndices) {
    const cb = checkboxes.nth(idx)
    if (await cb.count() > 0) {
      await cb.click()
    }
  }

  const selected = filteredIndices.map(i => filteredOptions[i]).join(', ')
  console.log(`[questionnaire] Выбраны чекбоксы [${selected}] для: "${q.question.slice(0, 60)}..."`)
}

async function handleRadio(config, page, q, vacancy) {
  const resumeText = config.resumeData?.resumeText || ''

  // Фильтруем "Свой вариант" — AI не должен его видеть, но запоминаем оригинальные индексы
  const filteredOptions = []
  const originalIndices = []
  for (let i = 0; i < q.options.length; i++) {
    const opt = q.options[i].trim()
    if (opt === 'Свой вариант' || opt === 'Другое' || opt === 'Other') continue
    filteredOptions.push(opt)
    originalIndices.push(i)
  }

  if (filteredOptions.length === 0) {
    console.warn(`[questionnaire] Нет вариантов кроме "Свой вариант" для: "${q.question.slice(0, 60)}..."`)
    return
  }

  const prompt = buildRadioPrompt(q.question, filteredOptions, vacancy.description || '', resumeText)
  const answer = await generateText(config, prompt, {
    label: `radio: "${q.question.slice(0, 50)}..."`,
  })

  if (!answer) {
    console.warn(`[questionnaire] Не удалось выбрать вариант для: "${q.question.slice(0, 60)}..."`)
    return
  }

  const filteredIndex = parseInt(answer.trim(), 10) - 1
  if (isNaN(filteredIndex) || filteredIndex < 0 || filteredIndex >= filteredOptions.length) {
    console.warn(`[questionnaire] AI вернул некорректный номер "${answer}" для radio: "${q.question.slice(0, 60)}..."`)
    // Фоллбэк: кликаем первый НЕ-"Свой вариант"
    const radios = page.locator(`input[type="radio"][name="${q.radioName}"]`)
    const target = radios.nth(originalIndices[0])
    if (await target.count() > 0) await target.click()
    return
  }

  const realIndex = originalIndices[filteredIndex]
  const radios = page.locator(`input[type="radio"][name="${q.radioName}"]`)
  const target = radios.nth(realIndex)
  if (await target.count() > 0) {
    await target.click()
    console.log(`[questionnaire] Выбран вариант "${filteredOptions[filteredIndex]}" для: "${q.question.slice(0, 60)}..."`)
  }
}

async function handleSelect(config, page, q, vacancy) {
  const resumeText = config.resumeData?.resumeText || ''
  const prompt = buildRadioPrompt(q.question, q.options, vacancy.description || '', resumeText)
  const answer = await generateText(config, prompt, {
    label: `select: "${q.question.slice(0, 50)}..."`,
  })

  const selects = await page.$$('select')
  const sel = selects[q.selectIndex]
  if (!sel) return

  if (!answer) {
    console.warn(`[questionnaire] Не удалось выбрать вариант для select: "${q.question.slice(0, 60)}..."`)
    return
  }

  const choiceIndex = parseInt(answer.trim(), 10) - 1
  if (isNaN(choiceIndex) || choiceIndex < 0 || choiceIndex >= q.options.length) {
    console.warn(`[questionnaire] AI вернул некорректный номер "${answer}" для select`)
    return
  }

  await sel.selectOption({ index: choiceIndex })
  console.log(`[questionnaire] Выбран "${q.options[choiceIndex]}" в select для: "${q.question.slice(0, 60)}..."`)
}
