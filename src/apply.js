async function checkCaptcha(page) {
  const title = await page.title()
  if (title.toLowerCase().includes('captcha') || title.toLowerCase().includes('robot')) {
    throw new Error(`Капча на странице: ${page.url()}`)
  }
}

async function checkAlreadyApplied(page) {
  const el = await page.$('text=Вы откликнулись')
  return el !== null
}

// Заполняет модальное окно с письмом (data-qa селекторы)
async function fillModalLetter(page, letterText) {
  const textarea = page.locator('[data-qa="vacancy-response-popup-form-letter-input"]')
  if (await textarea.count() === 0) return false

  if (letterText) await textarea.fill(letterText)
  const submitBtn = page.locator('[data-qa="vacancy-response-submit-popup"]')
  if (await submitBtn.count() === 0) return false

  await submitBtn.click()
  await page.waitForTimeout(1500)
  return true
}

// Заполняет inline-форму письма (появляется после отклика на странице вакансии)
async function fillInlineLetter(page, letterText) {
  for (const sel of ['textarea[placeholder="Сопроводительное письмо"]', 'textarea[placeholder*="письмо"]', 'textarea']) {
    const el = page.locator(sel).first()
    if (await el.count() > 0) {
      if (letterText) await el.fill(letterText)
      break
    }
  }

  for (const sel of ['button:has-text("Отправить")', 'button[type="submit"]']) {
    const btn = page.locator(sel).first()
    if (await btn.count() > 0) {
      await btn.click()
      await page.waitForTimeout(1500)
      return true
    }
  }
  return false
}

// Стратегия 1: ссылка "Написать сопроводительное" → модальное окно
async function strategyWriteCoverLetterLink(page, letterText) {
  const link = page.locator('a:has-text("Написать сопроводительное")')
  if (await link.count() === 0) return false

  await link.first().click()
  try {
    await page.waitForSelector('[data-qa="vacancy-response-popup-form-letter-input"]', { timeout: 5000 })
  } catch {
    return false
  }
  return fillModalLetter(page, letterText)
}

// Стратегия 2: dropdown "С сопроводительным письмом"
async function strategyDropdown(page, letterText) {
  for (const qa of ['vacancy-response-link-top', 'vacancy-response-link-bottom']) {
    const btn = page.locator(`[data-qa="${qa}"]`)
    if (await btn.count() === 0) continue

    const arrowSelectors = [
      `[data-qa="${qa}"] ~ button`,
      `[data-qa="${qa}"] + button`,
      `[data-qa="${qa}"] ~ [data-qa*="dropdown"]`,
    ]
    let arrowFound = false
    for (const sel of arrowSelectors) {
      const arrow = page.locator(sel).first()
      if (await arrow.count() > 0) {
        await arrow.click()
        await page.waitForTimeout(800)
        arrowFound = true
        break
      }
    }
    if (!arrowFound) continue

    const withLetterItem = page.locator('text=С сопроводительным письмом')
    if (await withLetterItem.count() === 0) continue

    await withLetterItem.first().click()
    try {
      await page.waitForSelector('[data-qa="vacancy-response-popup-form-letter-input"]', { timeout: 5000 })
    } catch {
      continue
    }
    return fillModalLetter(page, letterText)
  }
  return false
}

// Стратегия 3: клик кнопки → обрабатываем все варианты
async function strategyButtonClick(page, letterText) {
  for (const qa of ['vacancy-response-link-top', 'vacancy-response-link-bottom']) {
    const btn = page.locator(`[data-qa="${qa}"]`)
    if (await btn.count() === 0) continue

    await btn.first().click()
    await page.waitForTimeout(2500)

    // Вариант А: попап "Вакансия с прямым откликом" — кликаем подтверждение
    const advertisingBtn = page.locator('[data-qa="vacancy-response-link-advertising"]')
    if (await advertisingBtn.count() > 0) {
      console.log(`[debug] Попап прямого отклика — подтверждаем`)
      await advertisingBtn.click()
      await page.waitForTimeout(2500)
    }

    // Вариант Б: страница с вопросами работодателя — пропускаем
    if (await page.$('text=ответить на несколько вопросов')) {
      console.log(`[debug] Questionnaire — пропускаем`)
      return false
    }

    // Вариант В: модальное окно с textarea
    const modalTextarea = page.locator('[data-qa="vacancy-response-popup-form-letter-input"]')
    if (await modalTextarea.count() > 0) {
      return fillModalLetter(page, letterText)
    }

    // Вариант Г: inline-форма "Резюме доставлено"
    if (await page.$('text=Резюме доставлено')) {
      await fillInlineLetter(page, letterText)
      return true
    }

    // Вариант Д: "Вы откликнулись" — принят без формы
    if (await page.$('text=Вы откликнулись')) return true
  }
  return false
}

// Стратегия 4: страница уже в состоянии "Резюме доставлено" (без клика)
// Срабатывает если кнопка уже была нажата ранее в этой же сессии
async function strategyAlreadyDelivered(page, letterText) {
  const delivered = await page.$('text=Резюме доставлено')
  if (!delivered) return false
  return fillInlineLetter(page, letterText)
}

export async function applyToVacancy(config, page, vacancy, letterText) {
  const { href, title, employer } = vacancy

  try {
    await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await checkCaptcha(page)

    if (await checkAlreadyApplied(page)) {
      console.log(`[apply] Уже откликались: "${title}"`)
      return 'already_applied'
    }

    const strategies = [
      () => strategyWriteCoverLetterLink(page, letterText),
      () => strategyDropdown(page, letterText),
      () => strategyButtonClick(page, letterText),
      () => strategyAlreadyDelivered(page, letterText),
    ]

    for (let i = 0; i < strategies.length; i++) {
      try {
        const success = await strategies[i]()
        if (success) {
          const withLetter = letterText ? ' (с письмом)' : ''
          console.log(`[apply] Отклик отправлен${withLetter}: "${title}" — ${employer}`)
          await page.waitForTimeout(config.delayBetweenAppliesMs)
          return 'applied'
        }
      } catch (err) {
        console.warn(`[apply] Стратегия ${i + 1} не сработала для "${title}": ${err.message}`)
      }
    }

    console.warn(`[apply] Все стратегии не сработали для "${title}"`)
    return 'skipped'

  } catch (err) {
    if (err.message.includes('Капча')) {
      console.error(`[apply] Капча заблокировала "${title}"`)
      return 'error'
    }
    console.error(`[apply] Ошибка для "${title}": ${err.message}`)
    return 'error'
  }
}
