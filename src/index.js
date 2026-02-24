import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

chromium.use(StealthPlugin())
import { loadConfig, loadOrPromptAccounts } from './config.js'
import { ensureSession } from './auth.js'
import { searchOnePage } from './search.js'
import { applyToVacancy } from './apply.js'
import { generateCoverLetter, checkVacancyRelevance } from './ai.js'
import { loadResume } from './resume.js'
import { mkdir } from 'fs/promises'
import { setTimeout as sleep } from 'timers/promises'

async function applyOne(config, account, context, vacancy) {
  const page = await context.newPage()
  page.setDefaultTimeout(30000)
  try {
    // Открываем страницу вакансии
    await page.goto(vacancy.href, { waitUntil: 'domcontentloaded', timeout: 20000 })

    // Капча
    const pageTitle = await page.title()
    if (pageTitle.toLowerCase().includes('captcha') || pageTitle.toLowerCase().includes('robot')) {
      throw new Error(`Капча на странице: ${page.url()}`)
    }

    // Уже откликались — быстрый выход без AI
    if (await page.$('text=Вы откликнулись')) {
      console.log(`[worker:${account.id}] Уже откликались: "${vacancy.title}"`)
      return 'already_applied'
    }

    // Парсим полное описание вакансии прямо со страницы
    const fullDescription = await page.evaluate(() => {
      const el = document.querySelector('[data-qa="vacancy-description"]')
      return el ? el.innerText?.trim() : ''
    })

    const fullVacancy = { ...vacancy, description: fullDescription || vacancy.description }

    // Проверяем релевантность с полным описанием вакансии
    const relevant = await checkVacancyRelevance(config, fullVacancy)
    if (!relevant) {
      return 'skipped'
    }

    // Генерируем письмо с полным описанием
    const letter = await generateCoverLetter(config, fullVacancy)

    // Применяем — страница уже открыта, повторная навигация не нужна
    const result = await applyToVacancy(config, page, fullVacancy, letter, true)
    return result
  } catch (err) {
    console.error(`[worker:${account.id}] Ошибка для "${vacancy.title}": ${err.message}`)
    return 'errors'
  } finally {
    await page.close().catch(() => {})
  }
}

async function accountWorker(config, account, context) {
  const searchPage = await context.newPage()
  searchPage.setDefaultTimeout(30000)

  console.log(`\n[worker:${account.id}] Ищем вакансии по запросу "${config.searchQuery}"...`)

  const stats = { applied: 0, already_applied: 0, skipped: 0, errors: 0, rate_limited: false }
  const concurrency = config.concurrencyPerAccount || 5
  const maxVacanciesPerRun = config.maxVacanciesPerRun || Infinity

  const queue = []
  let searchDone = false
  let rateLimited = false
  let totalFetched = 0

  // Producer: последовательно листает страницы и пополняет очередь
  async function producer() {
    for (let pageNum = 0; ; pageNum++) {
      if (rateLimited || totalFetched >= maxVacanciesPerRun) break

      let vacancies
      try {
        vacancies = await searchOnePage(config, searchPage, pageNum)
      } catch (err) {
        console.error(`[worker:${account.id}] Ошибка поиска на стр.${pageNum}: ${err.message}`)
        break
      }

      if (!vacancies || vacancies.length === 0) {
        console.log(`[worker:${account.id}] Страница ${pageNum}: вакансий нет, завершаем поиск`)
        break
      }

      const remaining = maxVacanciesPerRun - totalFetched
      const toAdd = vacancies.slice(0, remaining)
      queue.push(...toAdd)
      totalFetched += toAdd.length
      console.log(`[worker:${account.id}] Страница ${pageNum}: +${toAdd.length} вакансий в очередь (всего: ${queue.length})`)
    }
    searchDone = true
  }

  // Consumer: постоянно тянет из очереди пока есть работа
  async function consumer(_id) {
    while (true) {
      if (rateLimited) break
      if (queue.length === 0) {
        if (searchDone) break
        await sleep(100)
        continue
      }

      const vacancy = queue.shift()
      const result = await applyOne(config, account, context, vacancy)

      if (result === 'rate_limited') {
        rateLimited = true
        stats.rate_limited = true
        console.log(`[worker:${account.id}] Лимит откликов HH исчерпан — останавливаем аккаунт, экономим API`)
        break
      }
      const key = result === 'errors' ? 'errors' : result
      if (stats[key] !== undefined) stats[key]++
      else stats.errors++
    }
  }

  await Promise.all([
    producer(),
    ...Array.from({ length: concurrency }, (_, i) => consumer(i)),
  ])

  await searchPage.close().catch(() => {})
  console.log(`[worker:${account.id}] Завершено. Итог:`, stats)
  return { account: account.id, ...stats }
}

async function main() {
  console.log('=== HH.ru Auto Responder ===\n')

  const config = await loadConfig()
  const accounts = await loadOrPromptAccounts(config)

  // Создаём директорию для сессий
  await mkdir(config.sessionDir, { recursive: true })

  console.log(`\n[main] Проверяем сессии для ${accounts.length} аккаунт(ов)...`)

  const browser = await chromium.launch({
    headless: config.headless,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  })

  // Фаза 1: последовательный логин (OTP требует ввода в терминал)
  const sessionContexts = []
  for (const account of accounts) {
    try {
      const context = await ensureSession(config, account, browser)
      sessionContexts.push({ account, context })
    } catch (err) {
      console.error(`[main] Не удалось войти для ${account.id}: ${err.message}`)
      // Продолжаем с остальными аккаунтами
    }
  }

  if (sessionContexts.length === 0) {
    console.error('[main] Нет ни одного рабочего аккаунта, завершаем.')
    await browser.close()
    process.exit(1)
  }

  // Фаза 1.5: загрузка резюме (из первого аккаунта)
  console.log(`\n[main] Загружаем резюме кандидата...`)
  try {
    const resumePage = await sessionContexts[0].context.newPage()
    resumePage.setDefaultTimeout(30000)
    config.resumeData = await loadResume(resumePage)
    await resumePage.close().catch(() => {})
  } catch (err) {
    console.warn(`[main] Не удалось загрузить резюме: ${err.message}`)
    config.resumeData = null
  }

  console.log(`\n[main] Готово ${sessionContexts.length} аккаунт(ов). Запускаем параллельные воркеры...\n`)

  // Фаза 2: параллельные воркеры
  const workerPromises = sessionContexts.map(({ account, context }) =>
    accountWorker(config, account, context).catch(err => {
      console.error(`[worker:${account.id}] Критическая ошибка: ${err.message}`)
      return { account: account.id, applied: 0, already_applied: 0, skipped: 0, errors: 1 }
    })
  )

  const results = await Promise.all(workerPromises)

  // Фаза 3: закрываем браузеры
  for (const { context } of sessionContexts) {
    await context.close().catch(() => {})
  }
  await browser.close()

  // Фаза 4: итоговая статистика
  console.log('\n========== ИТОГО ==========')
  let totalApplied = 0
  for (const r of results) {
    const rateLimitTag = r.rate_limited ? ' [ЛИМИТ ОТКЛИКОВ]' : ''
    console.log(
      `  ${r.account}: отправлено=${r.applied}, повтор=${r.already_applied}, пропущено=${r.skipped}, ошибки=${r.errors}${rateLimitTag}`
    )
    totalApplied += r.applied
  }
  console.log(`\n  Всего откликов отправлено: ${totalApplied}`)
  console.log('============================\n')
}

main().catch(err => {
  console.error('[main] Фатальная ошибка:', err)
  process.exit(1)
})
