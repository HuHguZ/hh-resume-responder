/**
 * Загружает и парсит резюме кандидата со страницы HH.
 * Возвращает объект с текстом резюме для использования в промптах.
 */
export async function loadResume(page) {
  console.log('[resume] Загружаем страницу резюме...')

  await page.goto('https://hh.ru/applicant/resumes', { waitUntil: 'domcontentloaded', timeout: 30000 })

  // Если редирект на логин — сессия истекла
  await page.waitForTimeout(1000)
  if (page.url().includes('/login') || page.url().includes('/account/')) {
    console.warn('[resume] Сессия истекла, страница резюме недоступна')
    return null
  }

  // Ждём появления карточки резюме в DOM (Ajax-загрузка после domcontentloaded)
  const resumeCardSelector = '[data-qa="resume-title"], [class*="resumeCard"], [class*="resume-card"], a[href*="/resume/"]'
  try {
    await page.waitForSelector(resumeCardSelector, { timeout: 15000 })
  } catch {
    console.warn('[resume] Список резюме не появился за 15с')
    return null
  }

  // Переходим на страницу первого резюме по ссылке
  const resumeHref = await page.locator('a[href*="/resume/"]').first().getAttribute('href')
  if (!resumeHref) {
    console.warn('[resume] Не нашли ссылку на резюме на странице')
    return null
  }

  const resumeUrl = resumeHref.startsWith('http') ? resumeHref : `https://hh.ru${resumeHref}`
  await page.goto(resumeUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
  await page.waitForTimeout(2000)

  // Кликаем "Развернуть" чтобы раскрыть все блоки опыта
  const expandButtons = page.locator('a:has-text("Развернуть"), button:has-text("Развернуть")')
  const expandCount = await expandButtons.count()
  for (let i = 0; i < expandCount; i++) {
    try {
      await expandButtons.nth(i).click()
      await page.waitForTimeout(300)
    } catch { /* ignore */ }
  }

  // Парсим всё содержимое резюме из DOM через data-qa атрибуты
  const resume = await page.evaluate(() => {
    const getText = (sel) => {
      const el = document.querySelector(sel)
      return el ? el.innerText?.trim() : ''
    }

    const title = getText('[data-qa="resume-block-title-position"]') || document.querySelector('h1')?.innerText?.trim() || ''
    const experience = getText('[data-qa="resume-list-card-experience"]')
    const skills = getText('[data-qa="skills-card"]')
    const education = getText('[data-qa="resume-list-card-education"]')
    const about = getText('[data-qa="resume-about-card"]')

    return { title, experience, skills, education, about }
  })

  if (!resume || !resume.title) {
    console.warn('[resume] Не удалось распарсить резюме')
    return null
  }

  // Собираем единый текст для промптов
  const resumeText = [
    `Должность: ${resume.title}`,
    resume.experience ? `\nОпыт работы:\n${resume.experience}` : '',
    resume.skills ? `\nНавыки: ${resume.skills}` : '',
    resume.education ? `\nОбразование: ${resume.education}` : '',
    resume.about ? `\nО себе:\n${resume.about}` : '',
  ].filter(Boolean).join('\n')

  console.log(`[resume] Резюме загружено: "${resume.title}" (${resumeText.length} символов)`)

  return { ...resume, resumeText }
}
