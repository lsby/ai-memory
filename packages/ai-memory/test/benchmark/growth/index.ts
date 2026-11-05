import { 记忆等级 } from '@lsby/ai-memory'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LocomoRunner } from '../locomo/src/runner'
import { LocomoJudge, loadLocomoSamples } from './locomo-bridge'
import { createGrowthAgent, runAnalysisPhase, runQueryPhase, runReflectionPhase } from './src/agent-runner'
import {
  formatTimestamp,
  loadGrowthEnv,
  parseGrowthCliOptions,
  sanitizeNoteForDir,
  setupTerminalMirrorLog,
} from './src/options'
import type { TeachingRoundRecord } from './src/types'

let __dirname = path.dirname(fileURLToPath(import.meta.url))

function formatDuration(ms: number): string {
  let s = Math.floor(ms / 1000)
  let m = Math.floor(s / 60)
  let remS = s % 60
  if (m === 0) return `${String(remS)}s`
  return `${String(m)}m ${String(remS)}s`
}

function extractDatabaseFromZip(zipPath: string, targetStorageDir: string): void {
  let tempExtractDir = path.join(path.dirname(targetStorageDir), `_temp_unpack_${Date.now()}`)
  fs.mkdirSync(tempExtractDir, { recursive: true })
  try {
    childProcess.execSync(`tar.exe -xf "${zipPath}" -C "${tempExtractDir}"`)
    let findDbDir = (dir: string): string | undefined => {
      let entries = fs.readdirSync(dir, { withFileTypes: true })
      for (let e of entries) {
        if (e.isDirectory() === true) {
          if (e.name === 'db') return path.join(dir, e.name)
          let nested = findDbDir(path.join(dir, e.name))
          if (nested !== undefined) return nested
        }
      }
      return undefined
    }
    let foundDb = findDbDir(tempExtractDir)
    if (foundDb === undefined) {
      throw new Error(`在 ZIP 包中找不到 db 文件夹: ${zipPath}`)
    }
    fs.cpSync(foundDb, targetStorageDir, { recursive: true })
  } finally {
    fs.rmSync(tempExtractDir, { recursive: true, force: true })
  }
}

function resolveSourceDatabase(rawPath: string, outputDir: string): string {
  let dbBaselineDir = path.resolve(__dirname, '../db-baseline')
  let candidates = [
    rawPath,
    rawPath.endsWith('.zip') ? rawPath : `${rawPath}.zip`,
    path.resolve(process.cwd(), rawPath),
    path.resolve(process.cwd(), `${rawPath}.zip`),
    path.resolve(outputDir, rawPath),
    path.resolve(outputDir, `${rawPath}.zip`),
    path.resolve(outputDir, rawPath, 'db'),
    path.resolve(__dirname, rawPath),
    path.resolve(__dirname, `${rawPath}.zip`),
    path.resolve(__dirname, 'output', rawPath),
    path.resolve(__dirname, 'output', `${rawPath}.zip`),
    path.resolve(__dirname, 'output', rawPath, 'db'),
    path.resolve(dbBaselineDir, rawPath),
    path.resolve(dbBaselineDir, `${rawPath}.zip`),
  ]
  for (let c of candidates) {
    if (fs.existsSync(c) === true) {
      if (c.endsWith('.zip') === true && fs.statSync(c).isFile() === true) {
        return c
      }
      if (fs.existsSync(path.join(c, 'db')) === true && fs.statSync(path.join(c, 'db')).isDirectory() === true) {
        return path.join(c, 'db')
      }
      if (fs.statSync(c).isDirectory() === true) {
        return c
      }
    }
  }
  throw new Error(`找不到指定的预置数据库目录或 ZIP 包: ${rawPath}`)
}

async function runGrowthBenchmark(): Promise<void> {
  let overallStartMs = Date.now()
  let timestamp = formatTimestamp(new Date())
  let options = parseGrowthCliOptions()
  let { loadedPath } = loadGrowthEnv(options.configName)

  console.log('=====================================================')
  console.log('🌱 Growth Benchmark 启动 (智能体认知教学与经验演化套件)')
  console.log('=====================================================')
  if (loadedPath !== undefined) console.log(`[配置] 已载入环境: ${loadedPath}`)

  let outputDir = path.resolve(__dirname, 'output')
  let rawFromDb = options.from ?? options.db ?? process.env['FROM_DB'] ?? process.env['SOURCE_DB']
  let sourceDbDir: string | undefined = undefined

  if (rawFromDb !== undefined && rawFromDb.trim() !== '') {
    sourceDbDir = resolveSourceDatabase(rawFromDb.trim(), outputDir)
  }

  let note = options.note ?? process.env['NOTE']
  let noteSuffix = sanitizeNoteForDir(note)
  let runDirName = `${timestamp}-sample-${String(options.sampleIndex)}${noteSuffix}`
  let runDir = path.join(outputDir, runDirName)
  let storageDir = path.join(runDir, 'db')
  fs.mkdirSync(runDir, { recursive: true })

  // 终端镜像日志：终端打印什么，run.log 就同步保存什么
  let stopMirrorLog = setupTerminalMirrorLog(path.join(runDir, 'run.log'))

  // 记录 commit hash
  try {
    let commitHash = childProcess.execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim()
    fs.writeFileSync(path.join(runDir, 'commit.txt'), commitHash, 'utf-8')
  } catch {
    // 忽略异常
  }

  // 记录调用命令至 command.txt
  let scriptArg = process.argv[1] ?? 'test/benchmark/growth/index.ts'
  let relScript = path.relative(process.cwd(), scriptArg).replace(/\\/g, '/')
  let scriptPath = relScript.startsWith('..') === false && relScript !== '' ? relScript : scriptArg
  let cliArgs = process.argv.slice(2).map((a) => (a.includes(' ') === true ? `"${a}"` : a))
  let fullCmd = `pnpm tsx ${scriptPath} ${cliArgs.join(' ')}`.trim()
  fs.writeFileSync(path.join(runDir, 'command.txt'), `${fullCmd}\n`, 'utf-8')

  // 记录备注
  if (note !== undefined && note.trim() !== '') {
    fs.writeFileSync(path.join(runDir, 'note.txt'), note.trim(), 'utf-8')
    console.log(`[备注] 本次运行说明: ${note.trim()}`)
  }

  let targetBaseURL = options.baseUrl ?? process.env['AI_BASE_URL'] ?? 'http://localhost:11434/v1'
  let targetApiKey = options.apiKey ?? process.env['AI_KEY'] ?? process.env['DEEPSEEK_API_KEY'] ?? 'local'
  let targetModel = options.model ?? process.env['AI_MODEL'] ?? 'gpt-oss-20b'

  let judgeBaseURL = options.judgeBaseUrl ?? process.env['JUDGE_BASE_URL'] ?? targetBaseURL
  let judgeApiKey = options.judgeApiKey ?? process.env['JUDGE_API_KEY'] ?? targetApiKey
  let judgeModel = options.judgeModel ?? process.env['JUDGE_MODEL'] ?? targetModel

  let allSamples = loadLocomoSamples()
  let sample = allSamples[options.sampleIndex]
  if (sample === undefined) {
    throw new Error(`找不到 sampleIndex 为 ${String(options.sampleIndex)} 的数据集`)
  }

  console.log(`[配置] 学生模型: ${targetModel} @ ${targetBaseURL}`)
  console.log(`[配置] 教师模型: ${judgeModel} @ ${judgeBaseURL}`)
  console.log(`[配置] 演化轮数: ${String(options.rounds)} 轮`)
  console.log(`[存储] 演化数据库目录: ${storageDir}`)

  // 数据库准备：有预置库则拷贝/解压，无预置库则摄取长程对话
  if (sourceDbDir !== undefined) {
    if (sourceDbDir.endsWith('.zip') === true) {
      console.log(`[复用] 从 ZIP 归档包解压并安全载入记忆库:`)
      console.log(`       源归档: ${sourceDbDir}`)
      console.log(`       新目录: ${storageDir}`)
      extractDatabaseFromZip(sourceDbDir, storageDir)
    } else {
      console.log(`[复用] 安全深拷贝已有记忆库 (绝不污染原数据库):`)
      console.log(`       源目录: ${sourceDbDir}`)
      console.log(`       新目录: ${storageDir}`)
      fs.cpSync(sourceDbDir, storageDir, { recursive: true })
    }
  } else {
    let maxSessions =
      options.maxSessions ??
      (process.env['LOCOMO_MAX_SESSIONS'] !== undefined ? Number(process.env['LOCOMO_MAX_SESSIONS']) : undefined)
    let sessionsToIngest = maxSessions !== undefined ? sample.sessions.slice(0, maxSessions) : sample.sessions
    console.log(
      `[冷启动] 未提供输入数据库，正在摄取 Sample [${sample.sampleId}] 的 ${String(sessionsToIngest.length)} 个长程会话建立底座记忆...`,
    )
    fs.mkdirSync(storageDir, { recursive: true })
    let initRunner = new LocomoRunner({
      baseURL: targetBaseURL,
      apiKey: targetApiKey,
      modelName: targetModel,
      storageDir,
      firstLevelCapacity: 30,
      funesMode: true,
      funesSearchLimit: 20,
      useNativeToolCalls: options.useNativeToolCalls,
    })
    await initRunner.init()
    let ingestStart = Date.now()
    await initRunner.ingestSessions(sessionsToIngest, (cur, total) => {
      process.stdout.write(`\r  正在灌入 Session: [${String(cur)}/${String(total)}]...`)
    })
    console.log(`\n✅ 底座对话灌入完成！耗时: ${formatDuration(Date.now() - ingestStart)}`)
  }

  // 构建证据索引
  let evidenceMap = new Map<string, { speaker: string; text: string; dateTime: string; sessionId: number }>()
  for (let s of sample.sessions) {
    for (let turn of s.turns) {
      evidenceMap.set(turn.dia_id, {
        speaker: turn.speaker,
        text: turn.text,
        dateTime: s.dateTime,
        sessionId: s.sessionId,
      })
    }
  }

  let pool = sample.qa
  let ctx = await createGrowthAgent({
    dbDir: storageDir,
    baseURL: targetBaseURL,
    apiKey: targetApiKey,
    modelName: targetModel,
    useNativeToolCalls: options.useNativeToolCalls,
  })

  let judge = new LocomoJudge({
    baseURL: judgeBaseURL,
    apiKey: judgeApiKey,
    judgeModelName: judgeModel,
  })

  let trajectory: TeachingRoundRecord[] = []
  let totalCorrect = 0

  console.log(`\n--- 开始 ${String(options.rounds)} 轮师生互动教学：审题 ➔ 作答 ➔ 批改 ➔ 根因诊断 ➔ 沉淀二级理论 ---`)

  try {
    for (let r = 1; r <= options.rounds; r++) {
      let rStart = Date.now()
      let poolIndex = Math.floor(Math.random() * pool.length)
      let qa = pool[poolIndex]
      if (qa === undefined) continue
      let globalIndex = poolIndex + 1

      console.log(`\n=====================================================`)
      console.log(
        `[第 ${String(r)}/${String(options.rounds)} 轮教学] 抽中题号 #${String(globalIndex)} (Category ${String(qa.category)})`,
      )
      console.log(`❓ 问题: ${qa.question}`)

      // 阶段 1A: 审题检索
      let analysis = await runAnalysisPhase(ctx, qa.question, (toolName) => {
        console.log(`   🧠 [审题调取] ${toolName}`)
      })
      if (analysis.recalledHeuristics !== 'None') {
        console.log(`   🧠 检索激活法则: ${analysis.recalledHeuristics.slice(0, 150)}...`)
      }

      // 阶段 1B: 搜证作答
      let studentAnswer = await runQueryPhase(ctx, qa.question, analysis, (toolName) => {
        console.log(`   🛠️  [搜证执行] ${toolName}`)
      })

      console.log(`   🧑‍🎓 学生回答: ${studentAnswer}`)
      console.log(`   🎯 标准答案: ${String(qa.answer)}`)

      // 阶段 2: 老师批改
      let evalResult = await judge.evaluateSingle({
        questionIndex: globalIndex - 1,
        question: qa.question,
        category: qa.category,
        goldAnswer: String(qa.answer),
        predictedAnswer: studentAnswer,
        evidence: qa.evidence,
        elapsedMs: Date.now() - rStart,
      })

      let isCorrect = evalResult.isCorrect
      if (isCorrect === true) {
        totalCorrect++
        console.log(`   🧑‍🏫 老师评分: ✅ CORRECT!`)
      } else {
        console.log(`   🧑‍🏫 老师评分: ❌ INCORRECT!`)
      }
      console.log(`   📝 老师解析: ${evalResult.reasoning.slice(0, 180)}...`)

      // 组装原文证据
      let evidenceLines: string[] = []
      for (let diaId of qa.evidence) {
        let turn = evidenceMap.get(diaId)
        if (turn !== undefined) {
          evidenceLines.push(
            `- [Session ${String(turn.sessionId)} | Date: ${turn.dateTime}] ${turn.speaker}: "${turn.text}"`,
          )
        }
      }
      let evidenceText =
        evidenceLines.length > 0 ? evidenceLines.join('\n') : '- (No direct dialogue mention; unrecorded topic)'

      // 阶段 3: 反思内化
      let memCountBefore = (await ctx.agent.查询记忆()).length
      let reflection = await runReflectionPhase(
        ctx,
        {
          question: qa.question,
          studentAnswer,
          isCorrect,
          teacherReasoning: evalResult.reasoning,
          goldAnswer: String(qa.answer),
          evidenceText,
        },
        (toolName, args) => {
          console.log(`   💾 [内化沉淀] ${toolName} -> ${JSON.stringify(args).slice(0, 120)}`)
        },
      )
      let memCountAfter = (await ctx.agent.查询记忆()).length
      if (
        reflection.generalizedHeuristic.trim() !== '' &&
        reflection.generalizedHeuristic.trim() !== 'None' &&
        memCountAfter === memCountBefore
      ) {
        let catLabels: Record<number, string> = {
          1: 'single-hop fact retrieval',
          2: 'temporal calculation and date reasoning',
          3: 'multi-hop causal inference and intent',
          4: 'conversational detail and nuanced preference',
          5: 'adversarial verification and unmentioned topic check',
        }
        let keywords = qa.question
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .split(/\s+/)
          .filter(
            (w) =>
              w.length > 3 &&
              !['what', 'when', 'where', 'which', 'who', 'would', 'could', 'should', 'about', 'from'].includes(w),
          )
          .slice(0, 3)

        let clues = [catLabels[qa.category] ?? 'reasoning strategy', ...keywords, 'verification heuristic']
        await ctx.agent.添加记忆({
          内容: reflection.generalizedHeuristic.trim(),
          线索: clues,
          评分: 95,
          等级: 记忆等级.二级,
          创建时间: new Date(),
        })
        memCountAfter = (await ctx.agent.查询记忆()).length
        console.log(`   💡 [自动落盘] 二级法则已可靠存入记忆库，当前记忆总数: ${String(memCountAfter)} 条`)
      }

      console.log(`   🔍 根因诊断: ${reflection.diagnosis.slice(0, 140)}...`)
      console.log(`   📖 沉淀法则: ${reflection.generalizedHeuristic.slice(0, 140)}...`)
      console.log(`   📈 记忆条目变动: ${String(memCountBefore)} ➔ ${String(memCountAfter)} 条`)

      trajectory.push({
        round: r,
        questionIndex: globalIndex,
        category: qa.category,
        question: qa.question,
        goldAnswer: String(qa.answer),
        studentAnswer,
        isCorrect,
        teacherReasoning: evalResult.reasoning,
        recalledHeuristics: analysis.recalledHeuristics,
        actionPlan: analysis.actionPlan,
        diagnosis: reflection.diagnosis,
        generalizedHeuristic: reflection.generalizedHeuristic,
        memoryCountBefore: memCountBefore,
        memoryCountAfter: memCountAfter,
      })
    }
  } finally {
    await ctx.agent.销毁()
  }

  let totalDurationMs = Date.now() - overallStartMs
  let trajFile = path.join(runDir, 'trajectory.json')
  fs.writeFileSync(trajFile, JSON.stringify(trajectory, null, 2), 'utf-8')

  // 生成总结报告
  let reportMd = [
    `# Growth Benchmark 教学演化报告`,
    ``,
    `- **运行时间**: ${new Date().toISOString()}`,
    `- **耗时**: ${formatDuration(totalDurationMs)}`,
    `- **基础库来源**: ${sourceDbDir ?? '全新冷启动灌入'}`,
    `- **演化数据库**: \`${storageDir}\``,
    `- **演化轮数**: ${String(options.rounds)} 轮`,
    `- **训练正确率**: ${String(((totalCorrect / options.rounds) * 100).toFixed(1))}% (${String(totalCorrect)}/${String(options.rounds)})`,
    ``,
    `## 教学演化轨迹概要`,
    `| 轮次 | 题号 | 类别 | 结果 | 根因诊断 | 沉淀的二级理论法则 |`,
    `| :--- | :--- | :--- | :--- | :--- | :--- |`,
    ...trajectory.map(
      (t) =>
        `| #${String(t.round)} | #${String(t.questionIndex)} | Cat ${String(t.category)} | ${t.isCorrect ? '✅' : '❌'} | ${t.diagnosis.replace(/\|/g, '-').slice(0, 60)} | ${t.generalizedHeuristic.replace(/\|/g, '-').slice(0, 80)} |`,
    ),
    ``,
  ].join('\n')

  fs.writeFileSync(path.join(runDir, 'REPORT.md'), reportMd, 'utf-8')

  console.log('\n=====================================================')
  console.log(`🎉 教学迭代完成！共耗时: ${formatDuration(totalDurationMs)}`)
  console.log(
    `🎯 训练中答题胜率: ${String(((totalCorrect / options.rounds) * 100).toFixed(1))}% (${String(totalCorrect)}/${String(options.rounds)})`,
  )
  console.log(`📁 演化后数据库已就绪: ${storageDir}`)
  console.log(`📜 演化轨迹已保存至: ${trajFile}`)
  console.log(`📝 总结报告已生成至: ${path.join(runDir, 'REPORT.md')}`)
  console.log('\n👉 接下来你可以使用以下命令：')
  console.log(`   1. 查看学到的法则: pnpm tsx test/benchmark/growth/inspect.ts --db=${storageDir}`)
  console.log(`   2. 用 locomo 复测该数据库: pnpm tsx test/benchmark/locomo/index.ts --from-db=${storageDir}`)
  console.log('=====================================================')

  stopMirrorLog()
}

runGrowthBenchmark().catch((err) => {
  console.error('❌ Growth Benchmark 发生异常:', err)
  process.exit(1)
})
