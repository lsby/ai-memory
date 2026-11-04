import childProcess from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LocomoJudge } from './src/judge'
import { loadLocomoSamples } from './src/loader'
import { formatDuration, formatTimestamp, loadBenchmarkEnv, parseCliOptions } from './src/options'
import { printBenchmarkReport } from './src/reporter'
import { LocomoRunner } from './src/runner'
import type { LocomoBenchmarkTiming } from './src/types'

let __dirname = path.dirname(fileURLToPath(import.meta.url))

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
  if (cliOptions.funesMode === true) {
    console.log(`[配置] 博闻强记模式: 开启 (消息检索上限: ${String(cliOptions.funesSearchLimit ?? 20)})`)
  }
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
    funesMode: cliOptions.funesMode,
    funesSearchLimit: cliOptions.funesSearchLimit,
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
  if (cliOptions.funesMode === true) {
    summary.funesMode = true
    summary.funesSearchLimit = cliOptions.funesSearchLimit ?? 20
  }

  let evaluationFile = path.join(runDir, 'evaluation.json')
  fs.writeFileSync(evaluationFile, JSON.stringify({ summary, evaluations }, null, 2), 'utf-8')
  console.log(`📁 详细评分与审计报告已保存至: ${evaluationFile}`)

  // 9. 输出完整成绩单与审计大盘
  printBenchmarkReport({
    summary,
    timing,
    auditStats,
    configName,
    sourceDbDir,
    note,
    reorganizeRounds,
    reorganizeTimeMs,
    funesMode: cliOptions.funesMode,
    funesSearchLimit: cliOptions.funesSearchLimit,
  })

  await runner.destroy()
}

runBenchmarkSample().catch((err: unknown) => {
  console.error('\n❌ 评测过程中出现异常:', err)
  process.exit(1)
})
