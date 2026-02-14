import { readFile, writeFile, mkdir, access } from 'fs/promises'
import { createInterface } from 'readline'
import path from 'path'

function sessionPath(config, accountId) {
  return path.join(config.sessionDir, `${accountId}.json`)
}

async function isSessionValid(config, account) {
  const filePath = sessionPath(config, account.id)
  const exists = await access(filePath).then(() => true).catch(() => false)
  if (!exists) return false

  try {
    const raw = await readFile(filePath, 'utf-8')
    const state = JSON.parse(raw)
    const cookies = state.cookies || []
    const now = Date.now() / 1000

    const hhtokenCookie = cookies.find(c => c.name === 'hhtoken')
    if (!hhtokenCookie) return false
    if (hhtokenCookie.expires !== -1 && hhtokenCookie.expires < now) return false
    return true
  } catch {
    return false
  }
}

function promptOtp(account) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(`[auth] Введите OTP для ${account.id} (${account.credential}): `, code => {
      rl.close()
      resolve(code.trim())
    })
  })
}

async function loginAccount(config, account, browser) {
  console.log(`[auth] Запускаем логин для ${account.id} (${account.credential})...`)
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  })
  const page = await context.newPage()
  page.setDefaultTimeout(30000)

  await page.goto('https://hh.ru/login', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)

  // Выбрать тип аккаунта "Соискатель"
  const applicantBtn = page.locator('input[data-qa="account-type-card-APPLICANT"]')
  if (await applicantBtn.count() > 0 && !(await applicantBtn.isChecked())) {
    await applicantBtn.click()
  }

  // Нажать "Войти"
  await page.click('button[data-qa="submit-button"]')
  await page.waitForTimeout(2000)

  if (account.type === 'phone') {
    // Ввод телефона — убираем +7 если есть
    let phone = account.credential.replace(/^\+7/, '').replace(/\D/g, '')
    const phoneInput = page.locator('input[data-qa="magritte-phone-input-national-number-input"]')
    await phoneInput.waitFor({ timeout: 10000 })
    await phoneInput.fill(phone)
  } else {
    // Переключиться на email вкладку
    const emailTab = page.locator('input[data-qa="credential-type-EMAIL"]')
    if (await emailTab.count() > 0) {
      await emailTab.click()
      await page.waitForTimeout(500)
    }
    // Найти поле email
    const emailInput = page.locator('input[type="email"], input[name="login"], input[data-qa*="email"]').first()
    await emailInput.waitFor({ timeout: 10000 })
    await emailInput.fill(account.credential)
  }

  // Нажать "Продолжить" / "Дальше"
  await page.click('button[data-qa="submit-button"]')
  await page.waitForTimeout(2000)

  // Ждём поле OTP
  const otpSelectors = [
    'input[data-qa="otp-code-input"]',
    'input[inputmode="numeric"]',
    'input[name="code"]',
    'input[placeholder*="код"]'
  ]
  let otpInput = null
  for (const sel of otpSelectors) {
    const el = page.locator(sel).first()
    try {
      await el.waitFor({ timeout: 8000 })
      otpInput = el
      break
    } catch {
      // Пробуем следующий
    }
  }

  if (!otpInput) {
    throw new Error(`[auth] Не найдено поле OTP для ${account.id}`)
  }

  const otp = await promptOtp(account)
  await otpInput.fill(otp)

  // Подтвердить OTP
  await page.click('button[data-qa="submit-button"], button[type="submit"]')

  // Ждём перенаправления с /login
  await page.waitForURL(url => !url.href.includes('/login'), { timeout: 30000 })

  // Проверяем hhtoken
  const cookies = await context.cookies()
  const hasToken = cookies.some(c => c.name === 'hhtoken')
  if (!hasToken) {
    await context.close()
    throw new Error(`[auth] Логин не удался для ${account.id}: cookie hhtoken не найдена`)
  }

  // Сохраняем сессию
  await mkdir(config.sessionDir, { recursive: true })
  const state = await context.storageState()
  await writeFile(sessionPath(config, account.id), JSON.stringify(state, null, 2), 'utf-8')
  console.log(`[auth] Сессия сохранена для ${account.id}`)

  await page.close()
  return context
}

export async function ensureSession(config, account, browser) {
  const valid = await isSessionValid(config, account)

  if (valid) {
    console.log(`[auth] Используем существующую сессию для ${account.id}`)
    const state = JSON.parse(await readFile(sessionPath(config, account.id), 'utf-8'))
    return browser.newContext({
      storageState: state,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })
  }

  console.log(`[auth] Сессия не найдена или истекла для ${account.id}, запускаем логин...`)
  return loginAccount(config, account, browser)
}
