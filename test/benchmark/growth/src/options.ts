import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let __dirname = path.dirname(fileURLToPath(import.meta.url))

export type GrowthCliOptions = {
  db?: string | undefined
  from?: string | undefined
  to?: string | undefined
  rounds: number
  limit?: number | undefined
  offset: number
  sampleIndex: number
  maxSessions?: number | undefined
  configName?: string | undefined
  note?: string | undefined
  model?: string | undefined
  baseUrl?: string | undefined
  apiKey?: string | undefined
  judgeModel?: string | undefined
  judgeBaseUrl?: string | undefined
  judgeApiKey?: string | undefined
  useNativeToolCalls: boolean
}

export function sanitizeNoteForDir(note?: string): string {
  if (note === undefined || note.trim() === '') return ''
  let cleaned = note
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  if (cleaned.length > 30) {
    cleaned = cleaned.slice(0, 30).replace(/-$/, '')
  }
  return cleaned !== '' ? `-${cleaned}` : ''
}

export function setupTerminalMirrorLog(logFilePath: string): () => void {
  let logStream = fs.createWriteStream(logFilePath, { flags: 'a', encoding: 'utf-8' })
  let origStdoutWrite = process.stdout.write.bind(process.stdout)
  let origStderrWrite = process.stderr.write.bind(process.stderr)
  let cleanAnsi = (str: string): string => str.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')

  process.stdout.write = (chunk: Uint8Array | string, encoding?: unknown, cb?: unknown): boolean => {
    let text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8')
    logStream.write(cleanAnsi(text))
    return origStdoutWrite(chunk, encoding as never, cb as never)
  }

  process.stderr.write = (chunk: Uint8Array | string, encoding?: unknown, cb?: unknown): boolean => {
    let text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8')
    logStream.write(cleanAnsi(text))
    return origStderrWrite(chunk, encoding as never, cb as never)
  }

  return (): void => {
    process.stdout.write = origStdoutWrite
    process.stderr.write = origStderrWrite
    logStream.end()
  }
}

export function formatTimestamp(d: Date): string {
  let pad = (n: number): string => String(n).padStart(2, '0')
  let y = d.getFullYear()
  let m = pad(d.getMonth() + 1)
  let day = pad(d.getDate())
  let h = pad(d.getHours())
  let min = pad(d.getMinutes())
  let s = pad(d.getSeconds())
  return `${String(y)}${m}${day}-${h}${min}${s}`
}

function parseArgValue(arg: string): string | undefined {
  let eqIdx = arg.indexOf('=')
  if (eqIdx !== -1) return arg.slice(eqIdx + 1)
  return undefined
}

export function parseGrowthCliOptions(): GrowthCliOptions {
  let argv = process.argv.slice(2)
  let options: GrowthCliOptions = {
    rounds: 10,
    offset: 0,
    sampleIndex: 0,
    useNativeToolCalls: false,
  }

  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i]
    if (arg === undefined) continue
    if (arg.startsWith('--db=')) options.db = parseArgValue(arg)
    else if (arg === '--db' && argv[i + 1] !== undefined) options.db = argv[++i]
    else if (arg.startsWith('--from-db=')) options.from = parseArgValue(arg)
    else if (arg === '--from-db' && argv[i + 1] !== undefined) options.from = argv[++i]
    else if (arg.startsWith('--from=')) options.from = parseArgValue(arg)
    else if (arg === '--from' && argv[i + 1] !== undefined) options.from = argv[++i]
    else if (arg.startsWith('--note=')) options.note = parseArgValue(arg)
    else if ((arg === '--note' || arg === '-m' || arg === '--comment') && argv[i + 1] !== undefined)
      options.note = argv[++i]
    else if (arg.startsWith('--to=')) options.to = parseArgValue(arg)
    else if (arg === '--to' && argv[i + 1] !== undefined) options.to = argv[++i]
    else if (arg.startsWith('--out=')) options.to = parseArgValue(arg)
    else if (arg === '--out' && argv[i + 1] !== undefined) options.to = argv[++i]
    else if (arg.startsWith('--rounds=')) options.rounds = Number(parseArgValue(arg) ?? '10')
    else if (arg === '--rounds' && argv[i + 1] !== undefined) options.rounds = Number(argv[++i])
    else if (arg.startsWith('--max-sessions=')) options.maxSessions = Number(parseArgValue(arg))
    else if (arg === '--max-sessions' && argv[i + 1] !== undefined) options.maxSessions = Number(argv[++i])
    else if (arg.startsWith('--limit=')) options.limit = Number(parseArgValue(arg))
    else if (arg === '--limit' && argv[i + 1] !== undefined) options.limit = Number(argv[++i])
    else if (arg.startsWith('--offset=')) options.offset = Number(parseArgValue(arg) ?? '0')
    else if (arg === '--offset' && argv[i + 1] !== undefined) options.offset = Number(argv[++i])
    else if (arg.startsWith('--sample=')) options.sampleIndex = Number(parseArgValue(arg) ?? '0')
    else if (arg === '--sample' && argv[i + 1] !== undefined) options.sampleIndex = Number(argv[++i])
    else if (arg.startsWith('--config=')) options.configName = parseArgValue(arg)
    else if (arg === '--config' && argv[i + 1] !== undefined) options.configName = argv[++i]
    else if (arg.startsWith('--model=')) options.model = parseArgValue(arg)
    else if (arg === '--native-tools') options.useNativeToolCalls = true
  }

  return options
}

export function loadGrowthEnv(customConfig?: string): {
  loadedPath?: string | undefined
  configName?: string | undefined
} {
  let envDir = path.resolve(__dirname, '../../../../test/.env')

  if (customConfig !== undefined && customConfig.trim() !== '') {
    let fileName = customConfig.endsWith('.env') ? customConfig : `${customConfig}.env`
    let target = path.join(envDir, fileName)
    if (fs.existsSync(target) === true) {
      if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(target)
      }
      return { loadedPath: target, configName: customConfig }
    }
    let fallback = path.resolve(process.cwd(), customConfig)
    if (fs.existsSync(fallback) === true) {
      if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(fallback)
      }
      return { loadedPath: fallback, configName: customConfig }
    }

    let available: string[] = []
    if (fs.existsSync(envDir) === true) {
      available = fs
        .readdirSync(envDir)
        .filter((f) => f.endsWith('.env'))
        .map((f) => f.replace(/\.env$/, ''))
    }
    throw new Error(
      `找不到指定的配置 "${customConfig}"。\n已检查路径: ${target}\n可选配置: ${available.length > 0 ? available.join(', ') : '无 (请在 test/.env/ 目录下创建)'}`,
    )
  }

  // 若未指定配置文件，检查系统环境变量是否已完整提供 AI_BASE_URL
  if (process.env['AI_BASE_URL'] !== undefined && process.env['AI_BASE_URL'] !== '') {
    return {}
  }

  let available: string[] = []
  if (fs.existsSync(envDir) === true) {
    available = fs
      .readdirSync(envDir)
      .filter((f) => f.endsWith('.env'))
      .map((f) => f.replace(/\.env$/, ''))
  }
  throw new Error(
    `未指定环境配置，且未检测到 AI_BASE_URL！\n请通过 --config=<name> 显式指定配置（可选: ${available.length > 0 ? available.join(', ') : '无'}）\n示例: --config=deepseek 或 --config=local`,
  )
}
