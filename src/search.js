async function checkCaptcha(page) {
  const title = await page.title()
  if (title.toLowerCase().includes('captcha') || title.toLowerCase().includes('robot')) {
    throw new Error(`[search] Капча обнаружена на странице: ${page.url()}`)
  }
}

export async function searchOnePage(config, page, pageNum) {
  const { searchQuery, area } = config
  const url = `https://hh.ru/search/vacancy?text=${encodeURIComponent(searchQuery)}&area=${area}&items_on_page=100&page=${pageNum}`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await checkCaptcha(page)

  const items = await page.$$('[data-qa="vacancy-serp__vacancy"]')
  if (items.length === 0) return null

  const vacancies = []
  for (const item of items) {
    const titleEl = await item.$('[data-qa="serp-item__title"]')
    if (!titleEl) continue

    const title = (await titleEl.innerText()).trim()
    const href = await titleEl.getAttribute('href')
    if (!href) continue
    const fullHref = href.startsWith('http') ? href : `https://hh.ru${href}`

    const employerEl = await item.$('[data-qa="vacancy-serp__vacancy-employer"]')
    const employer = employerEl ? (await employerEl.innerText()).trim() : 'Неизвестно'

    const descEl = await item.$('[data-qa="vacancy-description"]')
    const description = descEl ? (await descEl.innerText()).trim() : ''

    vacancies.push({ title, href: fullHref, employer, description })
  }

  return vacancies
}
