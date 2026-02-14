import { chromium } from 'playwright'
import { loadConfig, loadOrPromptAccounts } from './config.js'
import { ensureSession } from './auth.js'
import { searchOnePage } from './search.js'
import { applyToVacancy } from './apply.js'
import { generateCoverLetter } from './ai.js'
import { mkdir } from 'fs/promises'

async function applyOne(config, account, context, vacancy) {
  const page = await context.newPage()
  page.setDefaultTimeout(30000)
  try {
    const letter = await generateCoverLetter(config, vacancy)
    const result = await applyToVacancy(config, page, vacancy, letter)
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

  const stats = { applied: 0, already_applied: 0, skipped: 0, errors: 0 }
  const concurrency = config.concurrencyPerAccount || 5
  const maxVacanciesPerRun = config.maxVacanciesPerRun || Infinity
  let totalProcessed = 0

  for (let pageNum = 0; ; pageNum++) {
    let vacancies
    try {
      vacancies = await searchOnePage(config, searchPage, pageNum)
    } catch (err) {
      console.error(`[worker:${account.id}] Ошибка поиска на стр.${pageNum}: ${err.message}`)
      break
    }

    if (!vacancies || vacancies.length === 0) {
      console.log(`[worker:${account.id}] Страница ${pageNum}: вакансий нет, завершаем`)
      break
    }

    // Обрезаем если упрёмся в лимит
    const remaining = maxVacanciesPerRun - totalProcessed
    const batch = vacancies.slice(0, remaining)

    console.log(`[worker:${account.id}] Страница ${pageNum}: ${batch.length} вакансий — откликаемся батчами по ${concurrency}...`)

    for (let i = 0; i < batch.length; i += concurrency) {
      const chunk = batch.slice(i, i + concurrency)
      const results = await Promise.all(
        chunk.map(vacancy => applyOne(config, account, context, vacancy))
      )
      for (const result of results) {
        const key = result === 'errors' ? 'errors' : result
        if (stats[key] !== undefined) stats[key]++
        else stats.errors++
      }
    }

    totalProcessed += batch.length
    console.log(`[worker:${account.id}] Страница ${pageNum} завершена. Всего обработано: ${totalProcessed}. Статистика:`, stats)

    if (totalProcessed >= maxVacanciesPerRun) {
      console.log(`[worker:${account.id}] Достигнут лимит maxVacanciesPerRun (${maxVacanciesPerRun})`)
      break
    }
  }

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
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
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
    console.log(
      `  ${r.account}: отправлено=${r.applied}, повтор=${r.already_applied}, пропущено=${r.skipped}, ошибки=${r.errors}`
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
