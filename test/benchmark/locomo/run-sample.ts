import childProcess from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LocomoJudge } from './judge'
import { loadLocomoSamples } from './loader'
import { LocomoRunner } from './runner'
import type { LocomoBenchmarkTiming } from './types'

let __dirname = path.dirname(fileURLToPath(import.meta.url))

function formatDuration(ms: number): string {
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

function formatTimestamp(d: Date): string {
  let pad = (n: number): string => String(n).padStart(2, '0')
  let y = d.getFullYear()
  let m = pad(d.getMonth() + 1)
  let day = pad(d.getDate())
  let h = pad(d.getHours())
  let min = pad(d.getMinutes())
  let s = pad(d.getSeconds())
  return `${String(y)}${m}${day}-${h}${min}${s}`
}

interface CliOptions {
  configName?: string | undefined
  note?: string | undefined
  fromDb?: string | undefined
  reorganizeRounds?: number | undefined
}

function parseCliOptions(): CliOptions {
  let configName = process.env['CONFIG'] ?? process.env['ENV_CONFIG']
  let note = process.env['NOTE'] ?? process.env['RUN_NOTE'] ?? process.env['COMMENT']
  let fromDb = process.env['FROM_DB'] ?? process.env['SOURCE_DB']
  let reorganizeRounds = process.env['REORGANIZE'] !== undefined ? Number(process.env['REORGANIZE']) : undefined

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
    } else if (arg.startsWith('-') === false && arg.includes('=') === false && configName === undefined) {
      // 首个非选项裸参数视为配置名称，例如 `npx tsx run-sample.ts deepseek`
      configName = arg.trim()
    }
  }

  return { configName, note, fromDb, reorganizeRounds }
}

function loadBenchmarkEnv(configName?: string): { loadedPath?: string; configName?: string } {
  let envDir = path.resolve(__dirname, '../../.env')

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
    let fallback = path.resolve(__dirname, `../../${fileName}`)
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
    { name: 'test-env', path: path.resolve(__dirname, '../../.env') },
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

async function runBenchmarkSample(): Promise<void> {
  let overallStartMs = Date.now()
  let timestamp = formatTimestamp(new Date())

  let cliOptions = parseCliOptions()
  let { loadedPath, configName } = loadBenchmarkEnv(cliOptions.configName)

  console.log('=====================================================')
  console.log('🚀 LoCoMo Benchmark 启动 (ai-memory 评测与审计套件)')
  console.log('=====================================================')

  if (loadedPath !== undefined) {
    console.log(`[配置] 已载入配置文件: ${loadedPath}`)
  } else {
    console.log('[配置] 未发现指定配置文件，使用系统环境变量/默认值')
  }

  let note = cliOptions.note ?? process.env['NOTE']
  let reorganizeRounds = cliOptions.reorganizeRounds
  if (note !== undefined && note !== '') {
    console.log(`[备注] 本次运行说明: ${note}`)
  }
  if (reorganizeRounds !== undefined && reorganizeRounds > 0) {
    console.log(`[重组] 潜意识梦境重组轮数: ${String(reorganizeRounds)} 轮`)
  }

  let targetBaseURL = process.env['AI_BASE_URL'] ?? 'http://localhost:11434/v1'
  let targetApiKey = process.env['AI_KEY'] ?? process.env['DEEPSEEK_API_KEY'] ?? 'local'
  let targetModel = process.env['AI_MODEL'] ?? 'gpt-oss-20b'

  let judgeBaseURL = process.env['JUDGE_BASE_URL'] ?? targetBaseURL
  let judgeApiKey = process.env['JUDGE_API_KEY'] ?? targetApiKey
  let judgeModel = process.env['JUDGE_MODEL'] ?? targetModel

  // 可通过环境变量限制跑的轮次，用于快速验证
  let sampleIndex = Number(process.env['LOCOMO_SAMPLE_INDEX'] ?? '0')
  let maxSessionsStr = process.env['LOCOMO_MAX_SESSIONS']
  let maxSessions = maxSessionsStr !== undefined ? Number(maxSessionsStr) : undefined
  let maxQAStr = process.env['LOCOMO_MAX_QA']
  let maxQA = maxQAStr !== undefined ? Number(maxQAStr) : undefined
  let useNativeToolCalls =
    process.env['USE_NATIVE_TOOL_CALLS'] === '1' || process.env['USE_NATIVE_TOOL_CALLS'] === 'true'

  let fromDb = cliOptions.fromDb ?? process.env['FROM_DB'] ?? process.env['SOURCE_DB']
  let sourceDbDir: string | undefined = undefined

  // 目录结构：每一次测试独立放在一个时间戳目录下（先日期），里面包含 db/ 文件夹及评测 JSON 结果
  let outputDir = path.resolve(__dirname, 'output')

  if (fromDb !== undefined && fromDb.trim() !== '') {
    let rawPath = fromDb.trim()
    let candidates = [
      rawPath,
      path.resolve(outputDir, rawPath),
      path.resolve(outputDir, rawPath, 'db'),
      path.resolve(__dirname, rawPath),
    ]
    for (let c of candidates) {
      if (fs.existsSync(c) === true) {
        if (fs.existsSync(path.join(c, 'db')) === true && fs.statSync(path.join(c, 'db')).isDirectory() === true) {
          sourceDbDir = path.join(c, 'db')
          break
        }
        if (fs.statSync(c).isDirectory() === true) {
          sourceDbDir = c
          break
        }
      }
    }
    if (sourceDbDir === undefined) {
      throw new Error(`找不到指定的预置数据库目录: ${rawPath}`)
    }
  }

  let runDirName = `${timestamp}-sample-${String(sampleIndex)}`
  let runDir = path.join(outputDir, runDirName)
  if (fs.existsSync(runDir) === false) {
    fs.mkdirSync(runDir, { recursive: true })
  }

  // 记录代码 commit 哈希至 commit.txt
  try {
    let commitHash = childProcess.execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim()
    fs.writeFileSync(path.join(runDir, 'commit.txt'), commitHash, 'utf-8')
  } catch {
    // 忽略异常
  }
  let storageDir = path.join(runDir, 'db')
  if (sourceDbDir !== undefined) {
    console.log(`[复用] 安全深拷贝已有记忆库 (绝不污染原数据库):`)
    console.log(`       源目录: ${sourceDbDir}`)
    console.log(`       新目录: ${storageDir}`)
    fs.cpSync(sourceDbDir, storageDir, { recursive: true })
  } else if (fs.existsSync(storageDir) === false) {
    fs.mkdirSync(storageDir, { recursive: true })
  }

  // 若提供了备注，单独保存为 note.txt，避免目录名过长或特殊字符异常
  if (note !== undefined && note.trim() !== '') {
    let noteFile = path.join(runDir, 'note.txt')
    fs.writeFileSync(noteFile, note.trim(), 'utf-8')
    console.log(`[备注] 运行说明已记录至: ${noteFile}`)
  }

  let firstLevelCapacity =
    process.env['FIRST_LEVEL_CAPACITY'] !== undefined ? Number(process.env['FIRST_LEVEL_CAPACITY']) : 30

  console.log(`[配置] 被测模型: ${targetModel} @ ${targetBaseURL}`)
  console.log(`[配置] 函数调用模式: ${useNativeToolCalls ? '原生 tools' : '框架自解析 (规避本地 PEG 500)'}`)
  console.log(`[配置] 数据库存储: 本次独立持久化目录 (${storageDir})`)
  if (sourceDbDir !== undefined) {
    console.log(`[配置] 预置数据库: 来源 ${sourceDbDir}`)
  }
  console.log(`[配置] 一级记忆容量: ${String(firstLevelCapacity)}`)
  console.log(`[配置] 裁判模型: ${judgeModel} @ ${judgeBaseURL}`)
  console.log(
    `[范围] 测试 Sample 索引: ${String(sampleIndex)} | 限制会话数: ${maxSessions !== undefined ? String(maxSessions) : '全量'} | 限制问答数: ${maxQA !== undefined ? String(maxQA) : '全量'}`,
  )

  // 2. 加载数据集
  let allSamples = loadLocomoSamples()
  let sample = allSamples[sampleIndex]
  if (sample === undefined) {
    throw new Error(`找不到索引为 ${String(sampleIndex)} 的 Sample 数据`)
  }

  console.log(`\n📚 成功加载 Sample [${sample.sampleId}]`)
  console.log(`   人物: ${sample.speakerA} & ${sample.speakerB}`)
  console.log(`   总会话数: ${String(sample.sessions.length)} | 总 QA 数: ${String(sample.qa.length)}`)

  let sessionsToRun = maxSessions !== undefined ? sample.sessions.slice(0, maxSessions) : sample.sessions
  let qaToRun = maxQA !== undefined ? sample.qa.slice(0, maxQA) : sample.qa

  // 3. 初始化 Runner (开启本地文件存储)
  let runner = new LocomoRunner({
    baseURL: targetBaseURL,
    apiKey: targetApiKey,
    modelName: targetModel,
    logEvents: process.env['VERBOSE'] === '1',
    useNativeToolCalls,
    storageDir,
    firstLevelCapacity,
  })
  await runner.init()

  // 4. 阶段一：记忆摄取
  let ingestStartMs = Date.now()
  let ingestTimeMs = 0
  if (sourceDbDir !== undefined) {
    console.log('\n--- 阶段一：跳过多轮对话灌入（已复用预置数据库构建的独立副本）---')
  } else {
    console.log('\n--- 阶段一：多轮长程对话输入，AI 自主构建记忆 ---')
    await runner.ingestSessions(sessionsToRun, (cur, total) => {
      process.stdout.write(`\r  正在灌入 Session: [${String(cur)}/${String(total)}]...`)
    })
    ingestTimeMs = Date.now() - ingestStartMs
    console.log(`\n✅ 记忆沉淀完成！耗时: ${formatDuration(ingestTimeMs)}`)
  }

  // 阶段 1.5：记忆重组与梦境巩固 (Memory Consolidation)
  let reorganizeTimeMs = 0
  if (reorganizeRounds !== undefined && reorganizeRounds > 0) {
    console.log(`\n--- 阶段 1.5：启动潜意识记忆重组与梦境巩固（共 ${String(reorganizeRounds)} 轮）---`)
    let reorgStartMs = Date.now()
    await runner.reorganizeMemories(reorganizeRounds, (cur, total) => {
      process.stdout.write(`\r  正在重组潜意识网络 (第 [${String(cur)}/${String(total)}] 场梦)...`)
    })
    reorganizeTimeMs = Date.now() - reorgStartMs
    console.log(`\n✅ 潜意识记忆重组完成！耗时: ${formatDuration(reorganizeTimeMs)}`)
  }

  // 5. 阶段二：QA 问答考评
  console.log('\n--- 阶段二：QA 记忆回捞与作答考评 ---')
  let answerStartMs = Date.now()
  let qaResults = await runner.answerQuestions(qaToRun, (cur, total) => {
    process.stdout.write(`\r  正在作答 Question: [${String(cur)}/${String(total)}]...`)
  })
  let answerTimeMs = Date.now() - answerStartMs
  console.log(`\n✅ 作答完成！耗时: ${formatDuration(answerTimeMs)}`)

  // 6. 提取框架内置审计与记忆统计
  console.log('\n--- 阶段三：提取框架审计信息与记忆库统计 ---')
  let { stats: auditStats, detailedRecords } = await runner.getAuditStats()
  let auditRecordsFile = path.join(runDir, 'audit-records.json')
  fs.writeFileSync(auditRecordsFile, JSON.stringify(detailedRecords, null, 2), 'utf-8')
  console.log(`📁 详细请求级审计记录已保存至: ${auditRecordsFile}`)

  // 7. 保存原始预测结果
  let predictionFile = path.join(runDir, 'predictions.json')
  fs.writeFileSync(predictionFile, JSON.stringify(qaResults, null, 2), 'utf-8')
  console.log(`📁 预测回答已保存至: ${predictionFile}`)

  // 8. 阶段四：裁判评分
  console.log('\n--- 阶段四：LLM-as-a-Judge 自动阅卷评分 ---')
  let judgeStartMs = Date.now()
  let judge = new LocomoJudge({
    baseURL: judgeBaseURL,
    apiKey: judgeApiKey,
    judgeModelName: judgeModel,
  })

  let { evaluations, summary } = await judge.evaluateBatch(qaResults, (cur, total) => {
    process.stdout.write(`\r  裁判评分中: [${String(cur)}/${String(total)}]...`)
  })
  let judgeTimeMs = Date.now() - judgeStartMs
  console.log(`\n✅ 评分完成！耗时: ${formatDuration(judgeTimeMs)}`)

  let totalTimeMs = Date.now() - overallStartMs
  let timing: LocomoBenchmarkTiming = {
    ingestTimeMs,
    ...(reorganizeTimeMs > 0 ? { reorganizeTimeMs } : {}),
    answerTimeMs,
    judgeTimeMs,
    totalTimeMs,
    avgSessionTimeMs: sessionsToRun.length > 0 ? Math.round(ingestTimeMs / sessionsToRun.length) : 0,
    avgQATimeMs: qaToRun.length > 0 ? Math.round(answerTimeMs / qaToRun.length) : 0,
  }
  summary.timing = timing
  summary.audit = auditStats
  summary.configName = configName
  summary.note = note
  if (sourceDbDir !== undefined) {
    summary.fromDb = sourceDbDir
  }
  if (reorganizeRounds !== undefined && reorganizeRounds > 0) {
    summary.reorganizeRounds = reorganizeRounds
  }

  let evaluationFile = path.join(runDir, 'evaluation.json')
  fs.writeFileSync(evaluationFile, JSON.stringify({ summary, evaluations }, null, 2), 'utf-8')
  console.log(`📁 详细评分与审计报告已保存至: ${evaluationFile}`)

  // 9. 输出完整成绩单与审计大盘
  console.log('\n=====================================================')
  console.log('📊 LoCoMo 记忆评测成绩单')
  console.log('=====================================================')
  if (configName !== undefined) {
    console.log(`使用配置: ${configName}`)
  }
  if (sourceDbDir !== undefined) {
    console.log(`复用数据库: ${sourceDbDir}`)
  }
  if (note !== undefined && note !== '') {
    console.log(`本次备注: ${note}`)
  }
  if (reorganizeRounds !== undefined && reorganizeRounds > 0) {
    console.log(`潜意识重组: 开启 (${String(reorganizeRounds)} 轮梦境重组)`)
  }
  console.log(`总题目数: ${String(summary.totalQuestions)}`)
  console.log(`正确数: ${String(summary.correctCount)}`)
  console.log(`总正确率: ${summary.accuracy.toFixed(2)}%`)
  console.log('-----------------------------------------------------')
  console.log('分题型正确率统计:')
  let catNames: Record<number, string> = {
    1: 'Multi-hop (多跳关联)',
    2: 'Single-hop (单跳回忆)',
    3: 'Temporal (时序推理)',
    4: 'Open-domain (常识结合)',
    5: 'Adversarial (防幻觉)',
  }
  for (let [cat, data] of Object.entries(summary.byCategory)) {
    let name = catNames[Number(cat)] ?? `Category ${cat}`
    console.log(`  - ${name.padEnd(25)}: ${String(data.correct)}/${String(data.total)} (${data.accuracy.toFixed(1)}%)`)
  }
  console.log('-----------------------------------------------------')
  console.log('⏱️ 耗时与性能统计:')
  console.log(
    `  - 记忆摄取耗时: ${formatDuration(timing.ingestTimeMs)} (平均每会话: ${formatDuration(timing.avgSessionTimeMs)})`,
  )
  if (reorganizeTimeMs > 0) {
    console.log(
      `  - 记忆重组耗时: ${formatDuration(reorganizeTimeMs)} (平均每轮: ${formatDuration(Math.round(reorganizeTimeMs / (reorganizeRounds ?? 1)))})`,
    )
  }
  console.log(
    `  - QA 作答耗时  : ${formatDuration(timing.answerTimeMs)} (平均每题: ${formatDuration(timing.avgQATimeMs)})`,
  )
  console.log(`  - 裁判阅卷耗时: ${formatDuration(timing.judgeTimeMs)}`)
  console.log(`  - 评测总耗时  : ${formatDuration(timing.totalTimeMs)}`)
  console.log('-----------------------------------------------------')
  console.log('🔍 框架内置心智审计看板:')
  console.log(`  - 沉淀记忆总数: ${String(auditStats.memoryStats.total)} 条`)
  console.log(`    ├── 零级常驻记忆: ${String(auditStats.memoryStats.level0)} 条`)
  console.log(`    ├── 一级工作记忆: ${String(auditStats.memoryStats.level1)} 条`)
  console.log(`    └── 二级潜意识网: ${String(auditStats.memoryStats.level2)} 条`)
  console.log(`  - 模型调用总计: ${String(auditStats.modelAudit.模型请求次数)} 次`)
  console.log(`    ├── 新建对话: ${String(auditStats.modelAudit.新建对话请求次数)} 次`)
  console.log(`    └── 缓存复用: ${String(auditStats.modelAudit.缓存复用请求次数)} 次`)
  console.log(
    `  - 吞吐字符数  : 发出 ${String(auditStats.modelAudit.发出字符数)} 字 / 接收 ${String(auditStats.modelAudit.返回字符数)} 字`,
  )
  if (auditStats.modelAudit.token用量.请求次数 > 0) {
    console.log(
      `  - Token 用量  : 输入 ${String(auditStats.modelAudit.token用量.输入token数)} / 输出 ${String(auditStats.modelAudit.token用量.输出token数)} / 缓存命中 ${String(auditStats.modelAudit.token用量.缓存命中token数)}`,
    )
  }
  console.log('=====================================================\n')

  await runner.destroy()
}

runBenchmarkSample().catch((err: unknown) => {
  console.error('\n❌ 评测过程中出现异常:', err)
  process.exit(1)
})
