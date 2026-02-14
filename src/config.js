import { readFile, writeFile, access } from 'fs/promises'
import { createInterface } from 'readline'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
export const PROJECT_ROOT = path.resolve(__dirname, '..')

export async function loadConfig() {
  const raw = await readFile(path.join(PROJECT_ROOT, 'config/config.json'), 'utf-8')
  const cfg = JSON.parse(raw)
  cfg.sessionDir = path.resolve(PROJECT_ROOT, cfg.sessionDir)
  cfg.accountsFile = path.resolve(PROJECT_ROOT, cfg.accountsFile)
  cfg._projectRoot = PROJECT_ROOT
  return cfg
}

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve))
}

export async function loadOrPromptAccounts(config) {
  const fileExists = await access(config.accountsFile).then(() => true).catch(() => false)

  if (fileExists) {
    const raw = await readFile(config.accountsFile, 'utf-8')
    const accounts = JSON.parse(raw)
    console.log(`[config] Загружено ${accounts.length} аккаунт(ов) из ${config.accountsFile}`)
    return accounts
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })

  try {
    const countStr = await ask(rl, 'Сколько аккаунтов будет работать параллельно? ')
    const count = parseInt(countStr.trim(), 10)
    if (isNaN(count) || count < 1) throw new Error('Неверное количество аккаунтов')

    const accounts = []
    for (let i = 0; i < count; i++) {
      console.log(`\n--- Аккаунт ${i + 1} из ${count} ---`)
      const typeStr = (await ask(rl, 'Тип входа (phone/email): ')).trim().toLowerCase()
      if (typeStr !== 'phone' && typeStr !== 'email') throw new Error(`Неизвестный тип: ${typeStr}`)
      const credential = (await ask(rl, `Введите ${typeStr === 'phone' ? 'телефон (+7...)' : 'email'}: `)).trim()
      accounts.push({ id: `account_${i}`, credential, type: typeStr })
    }

    // Сохраняем для следующих запусков
    await writeFile(config.accountsFile, JSON.stringify(accounts, null, 2), 'utf-8')
    console.log(`[config] Аккаунты сохранены в ${config.accountsFile}`)
    return accounts
  } finally {
    rl.close()
  }
}
