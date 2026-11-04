import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface CliOptions {
  configName?: string | undefined
  note?: string | undefined
  fromDb?: string | undefined
  reorganizeRounds?: number | undefined
  funesMode?: boolean | undefined
  funesSearchLimit?: number | undefined
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`
  let seconds = Math.floor(ms / 1000)
  if (seconds < 60) {
    let decimals = ((ms % 1000) / 100).toFixed(0)
    return `${String(seconds)}.${decimals}s`
  }
  let minutes = Math.floor(seconds / 60)
  let remainingSeconds = seconds % 60
  return `${String(minutes)}m ${String(remainingSeconds)}s`
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

export function parseCliOptions(): CliOptions {
  let configName = process.env['CONFIG'] ?? process.env['ENV_CONFIG']
  let note = process.env['NOTE'] ?? process.env['RUN_NOTE'] ?? process.env['COMMENT']
  let fromDb = process.env['FROM_DB'] ?? process.env['SOURCE_DB']
  let reorganizeRounds = process.env['REORGANIZE'] !== undefined ? Number(process.env['REORGANIZE']) : undefined
  let funesMode =
    process.env['FUNES'] === 'true' || process.env['FUNES_MODE'] === 'true' || process.env['BO_WEN_QIANG_JI'] === 'true'
  let funesSearchLimit = process.env['FUNES_LIMIT'] !== undefined ? Number(process.env['FUNES_LIMIT']) : undefined

  let args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    let arg = args[i]
    if (arg === undefined) continue

    if (arg.startsWith('--config=')) {
      configName = arg.slice('--config='.length).trim()
    } else if ((arg === '--config' || arg === '-c') && args[i + 1] !== undefined) {
      configName = args[i + 1]?.trim()
      i++
    } else if (arg.startsWith('--note=')) {
      note = arg.slice('--note='.length).trim()
    } else if (
      (arg === '--note' || arg === '-m' || arg === '--desc' || arg === '--comment') &&
      args[i + 1] !== undefined
    ) {
      note = args[i + 1]?.trim()
      i++
    } else if (arg.startsWith('--from-db=')) {
      fromDb = arg.slice('--from-db='.length).trim()
    } else if ((arg === '--from-db' || arg === '--db') && args[i + 1] !== undefined) {
      fromDb = args[i + 1]?.trim()
      i++
    } else if (arg.startsWith('--reorganize=')) {
      reorganizeRounds = Number(arg.slice('--reorganize='.length).trim())
    } else if (arg === '--reorganize' || arg === '--dream') {
      let nextArg = args[i + 1]
      if (nextArg !== undefined && /^\d+$/.test(nextArg) === true) {
        reorganizeRounds = Number(nextArg.trim())
        i++
      } else {
        reorganizeRounds = 10
      }
    } else if (arg.startsWith('--reorganize-rounds=')) {
      reorganizeRounds = Number(arg.slice('--reorganize-rounds='.length).trim())
    } else if (arg === '--funes' || arg === '--funes-mode' || arg === '--bowenqiangji') {
      funesMode = true
    } else if (arg.startsWith('--funes-limit=')) {
      funesSearchLimit = Number(arg.slice('--funes-limit='.length).trim())
    } else if (arg === '--funes-limit' && args[i + 1] !== undefined) {
      funesSearchLimit = Number(args[i + 1]?.trim())
      i++
    } else if (arg.startsWith('-') === false && arg.includes('=') === false && configName === undefined) {
      // 首个非选项裸参数视为配置名称，例如 `npx tsx index.ts deepseek`
      configName = arg.trim()
    }
  }

  return { configName, note, fromDb, reorganizeRounds, funesMode, funesSearchLimit }
}

export function loadBenchmarkEnv(configName?: string): { loadedPath?: string; configName?: string } {
  let envDir = path.resolve(__dirname, '../../../../test/.env')

  if (configName !== undefined && configName !== '') {
    let fileName = configName.endsWith('.env') ? configName : `${configName}.env`
    let target = path.join(envDir, fileName)
    if (fs.existsSync(target) === true) {
      if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(target)
      }
      return { loadedPath: target, configName }
    }
    // 同时也尝试直接在 test/ 目录下找
    let fallback = path.resolve(__dirname, `../../../${fileName}`)
    if (fs.existsSync(fallback) === true) {
      if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(fallback)
      }
      return { loadedPath: fallback, configName }
    }

    let available: string[] = []
    if (fs.existsSync(envDir) === true) {
      available = fs
        .readdirSync(envDir)
        .filter((f) => f.endsWith('.env'))
        .map((f) => f.replace(/\.env$/, ''))
    }
    throw new Error(
      `找不到指定的配置 "${configName}"。\n已检查路径: ${target}\n可选配置: ${available.length > 0 ? available.join(', ') : '无 (请在 test/.env/ 目录下创建)'}`,
    )
  }

  // 未指定时按优先级自动探测默认配置
  let defaultCandidates = [
    { name: 'deepseek', path: path.join(envDir, 'deepseek.env') },
    { name: 'local', path: path.join(envDir, 'local.env') },
    { name: 'default', path: path.join(envDir, 'default.env') },
    { name: 'test-env', path: path.resolve(__dirname, '../../../../test/.env') },
  ]
  for (let candidate of defaultCandidates) {
    if (fs.existsSync(candidate.path) === true) {
      if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(candidate.path)
      }
      return { loadedPath: candidate.path, configName: candidate.name }
    }
  }

  return {}
}
