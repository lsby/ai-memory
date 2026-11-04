import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import OpenAI from 'openai'
import { z } from 'zod'
import { 带记忆的智能体 } from '../../../src/agent-memory/agent-memory'
import { 记忆等级 } from '../../../src/agent-memory/types'
import { 英文模型语言包 } from '../../../src/agent/model-language'
import { dateCalculatorTool } from './src/date-calculator'
import { LocomoJudge } from './src/judge'
import { loadLocomoSamples } from './src/loader'
import { formatDuration, loadBenchmarkEnv } from './src/options'
import { buildEvidenceIndex, parseCliArgs, type QuestionStats, type RoundRecord } from './src/random-experiment-helpers'
import type { LocomoQA } from './src/types'

let __dirname = path.dirname(fileURLToPath(import.meta.url))

async function runRandomTutorExperiment(): Promise<void> {
  let cliOptions = parseCliArgs()
  let { loadedPath, configName } = loadBenchmarkEnv(cliOptions.configName)

  console.log('=================================================================')
  console.log('🎲 LoCoMo 随机抽题对抗训练与记忆进化实验 (50-Round Random Practice)')
  console.log('=================================================================')
  if (loadedPath !== undefined) {
    console.log(`[配置] 已载入配置文件: ${loadedPath}`)
  }

  let targetBaseURL = process.env['AI_BASE_URL'] ?? 'http://localhost:11434/v1'
  let targetApiKey = process.env['AI_KEY'] ?? process.env['DEEPSEEK_API_KEY'] ?? 'local'
  let targetModel = process.env['AI_MODEL'] ?? 'gpt-oss-20b'

  let judgeBaseURL = process.env['JUDGE_BASE_URL'] ?? targetBaseURL
  let judgeApiKey = process.env['JUDGE_API_KEY'] ?? targetApiKey
  let judgeModel = process.env['JUDGE_MODEL'] ?? targetModel

  let useNativeToolCalls =
    process.env['USE_NATIVE_TOOL_CALLS'] === '1' || process.env['USE_NATIVE_TOOL_CALLS'] === 'true'

  let outputDir = path.resolve(__dirname, 'output')
  let defaultSourceDb = path.resolve(outputDir, '20261104-063646-sample-0', 'db')
  let sourceDb = cliOptions.sourceDbDir ?? defaultSourceDb

  if (fs.existsSync(sourceDb) === false) {
    throw new Error(`找不到可用的预置数据库: ${sourceDb}\n请确认路径或通过 --from-db 指定`)
  }

  let timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  let runDir = path.join(outputDir, `random-practice-${timestamp}-sample-0`)
  let targetDbDir = path.join(runDir, 'db')

  console.log(`[数据库] 来源预置数据库: ${sourceDb}`)
  console.log(`[数据库] 正在克隆独立练习数据库至: ${targetDbDir}`)
  fs.mkdirSync(runDir, { recursive: true })
  fs.cpSync(sourceDb, targetDbDir, { recursive: true })

  let samples = loadLocomoSamples()
  let sample = samples[0]
  if (sample === undefined) {
    throw new Error('未加载到有效的样本数据')
  }

  let evidenceMap = buildEvidenceIndex(sample)
  let pool: LocomoQA[] = sample.qa.slice(cliOptions.offset, cliOptions.offset + cliOptions.poolSize)

  console.log(`[样本] 加载人物: ${sample.speakerA} & ${sample.speakerB}`)
  console.log(
    `[题库] 选取固定练习题池: ${String(pool.length)} 道题 (全局题号 ${String(cliOptions.offset + 1)} - ${String(cliOptions.offset + pool.length)})`,
  )
  console.log(`[轮次] 计划随机抽取轮次: ${String(cliOptions.totalRounds)} 次`)

  let 内存记忆工具筛选 = (工具名: string): boolean =>
    工具名 !== 'create_skill' &&
    工具名 !== 'update_skill' &&
    工具名 !== 'remove_skill' &&
    工具名 !== 'execute_skill' &&
    工具名 !== 'view_skill_code'

  let studentAgent = new 带记忆的智能体({
    一级记忆容量: 30,
    记忆工具筛选: 内存记忆工具筛选,
    模型语言包: 英文模型语言包,
    向量模型: { 类型: '本地', 模型名称: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2' },
    存储: { 模式: '文件', 路径: targetDbDir },
    博闻强记模式: true,
    博闻强记消息搜索数量: 20,
  })

  await studentAgent.初始化()
  let convList = await studentAgent.查询会话列表()
  if (convList.length > 0 && convList[0] !== undefined) {
    await studentAgent.切换会话(convList[0].id)
    console.log(`[会话] 成功激活对话谱系: ${convList[0].id}`)
  }

  let initialMemories = await studentAgent.查询记忆()
  console.log(
    `[初始记忆] 学生初始记忆总数: ${String(initialMemories.length)} 条 (Level 1: ${String(initialMemories.filter((m) => m.等级 === 记忆等级.一级).length)}, Level 2: ${String(initialMemories.filter((m) => m.等级 === 记忆等级.二级).length)})`,
  )

  let judge = new LocomoJudge({
    baseURL: judgeBaseURL,
    apiKey: judgeApiKey,
    judgeModelName: judgeModel,
  })

  let studentClient = new OpenAI({
    baseURL: targetBaseURL,
    apiKey: targetApiKey,
  })

  let questionStatsMap = new Map<number, QuestionStats>()
  for (let i = 0; i < pool.length; i++) {
    let qa = pool[i]
    if (qa === undefined) continue
    let globalIndex = cliOptions.offset + i + 1
    questionStatsMap.set(globalIndex, {
      questionIndex: globalIndex,
      question: qa.question,
      goldAnswer: String(qa.answer),
      category: qa.category,
      attempts: 0,
      correct: 0,
      history: [],
    })
  }

  let roundRecords: RoundRecord[] = []
  let totalCorrect = 0
  let startTime = Date.now()

  let clearInMemoryHistory = (): void => {
    ;(studentAgent as unknown as { 对话历史: unknown[] }).对话历史 = []
  }

  console.log('\n--- 开始 50 轮随机抽题演练：作答 ➔ 批改 ➔ 反思 ➔ 记忆进化 ---')

  for (let r = 1; r <= cliOptions.totalRounds; r++) {
    let roundStart = Date.now()
    clearInMemoryHistory()

    // 随机抽取一道题
    let poolIndex = Math.floor(Math.random() * pool.length)
    let qa = pool[poolIndex]
    if (qa === undefined) continue
    let globalIndex = cliOptions.offset + poolIndex + 1
    let qStat = questionStatsMap.get(globalIndex)

    console.log(`\n=================================================================`)
    console.log(
      `[第 ${String(r)}/${String(cliOptions.totalRounds)} 轮] 抽中题号 #${String(globalIndex)} (池内序号 ${String(poolIndex + 1)} | Category ${String(qa.category)})`,
    )
    console.log(`❓ 问题: ${qa.question}`)

    try {
      // 阶段一 A：审题与经验检索（套用二级长期记忆中的法则）
      let analysisPrompt = [
        `Question to Solve: ${qa.question}`,
        'Instructions for Question Analysis & Theory Activation:',
        '- Identify the question type (e.g. relative date calculation, speaker attribution, career/qualification details, relationship inference, event timing).',
        '- Call `search_memories` with natural-language contents to search Level 2 long-term memory for applicable heuristics, lessons, or guidelines.',
        '- Summarize the recalled heuristics and formulate your strategic action plan for solving this question.',
      ].join('\n')

      let analysisResult = await studentAgent.私有反思({
        命令: analysisPrompt,
        召回查询内容: qa.question,
        预期结果Schema: z.object({
          problem_category: z.string().describe('The pattern or category of this question'),
          recalled_heuristics: z
            .string()
            .describe(
              'Rules, heuristics, or lessons retrieved from long-term memory via search_memories, or "None" if new',
            ),
          action_plan: z.string().describe('Strategic plan for searching and reasoning on this specific question'),
        }),
        预期结果描述:
          'Analyze the question, retrieve applicable heuristics from long-term memory via search_memories, and form an action plan',
        回调: async (事件): Promise<void> => {
          if (事件.类型 === '工具调用开始') {
            console.log(`      🧠 [审题调取] ${事件.工具名称} -> ${JSON.stringify(事件.参数).slice(0, 150)}`)
          }
        },
        openai客户端: studentClient,
        模型名称: targetModel,
        温度: 0,
        是否支持函数调用: useNativeToolCalls,
        临时追加工具列表: [],
      })

      let recalledRule = analysisResult.结果?.recalled_heuristics ?? 'None'
      let actionPlan = analysisResult.结果?.action_plan ?? ''
      console.log(`   🧠 审题检索经验: ${recalledRule.slice(0, 160)}...`)
      if (actionPlan.length > 0) {
        console.log(`   📋 制定解题战术: ${actionPlan.slice(0, 160)}...`)
      }

      // 阶段一 B：搜证与作答（执行阶段）
      clearInMemoryHistory()
      let queryPrompt = [
        `Question: ${qa.question}`,
        '',
        '--- Active Guidelines Recalled from Long-Term Memory ---',
        recalledRule !== 'None'
          ? recalledRule
          : '- No specific prior rule matched. Follow standard verification procedures.',
        '',
        '--- Planned Search & Reasoning Strategy ---',
        actionPlan !== '' ? actionPlan : '- Search conversation messages for evidence and verify facts directly.',
        '',
        'Instructions for Investigation & Answering:',
        '- Execute your strategy using `search_conversation_messages` to locate the exact conversation text.',
        '- If resolving relative dates, calculate exact dates with `date_calculator` anchored to the session timestamp.',
        '- State the direct, concise factual answer strictly based on the verifiable dialogue evidence.',
      ].join('\n')

      let studentResult = await studentAgent.私有反思({
        命令: queryPrompt,
        召回查询内容: qa.question,
        预期结果Schema: z.object({
          answer: z.string().describe('Direct and concise factual answer to the question'),
        }),
        预期结果描述:
          'Answer the question using conversation search and date calculator following the active guidelines',
        回调: async (事件): Promise<void> => {
          if (事件.类型 === '工具调用开始') {
            console.log(`      🛠️  [搜证执行] ${事件.工具名称} -> ${JSON.stringify(事件.参数).slice(0, 150)}`)
          }
        },
        openai客户端: studentClient,
        模型名称: targetModel,
        温度: 0,
        是否支持函数调用: useNativeToolCalls,
        临时追加工具列表: [dateCalculatorTool],
      })

      let studentAnswer = studentResult.结果?.answer ?? ''
      console.log(`   🧑‍🎓 学生回答: ${studentAnswer}`)
      console.log(`   🎯 标准答案: ${String(qa.answer)}`)

      // 阶段二：老师批改讲评
      let evalResult = await judge.evaluateSingle({
        questionIndex: globalIndex - 1,
        question: qa.question,
        category: qa.category,
        goldAnswer: String(qa.answer),
        predictedAnswer: studentAnswer,
        evidence: qa.evidence,
        elapsedMs: 0,
      })

      let isCorrect = evalResult.isCorrect
      if (isCorrect === true) {
        totalCorrect++
        console.log(`   🧑‍🏫 老师评分: ✅ CORRECT!`)
      } else {
        console.log(`   🧑‍🏫 老师评分: ❌ WRONG!`)
      }
      console.log(`   📝 老师解析: ${evalResult.reasoning}`)

      // 更新该题历史
      if (qStat !== undefined) {
        qStat.attempts++
        if (isCorrect === true) qStat.correct++
        qStat.history.push(isCorrect)
      }

      // 组装原文证据文本
      let evidenceLines: string[] = []
      for (let diaId of qa.evidence) {
        let turn = evidenceMap.get(diaId)
        if (turn !== undefined) {
          evidenceLines.push(
            `- [Session ${String(turn.sessionId)} | Date: ${turn.dateTime}] ${turn.speaker} (${diaId}): "${turn.text}"`,
          )
        }
      }
      let evidenceSection =
        evidenceLines.length > 0 ? evidenceLines.join('\n') : '- (No direct dialogue mention; unrecorded topic)'

      // 阶段三：讲评反馈与自主反思内化
      clearInMemoryHistory()
      let memCountBefore = (await studentAgent.查询记忆()).length
      let feedbackPrompt = [
        '## Teacher Feedback and Scientific Reflection (Hypothesis - Experiment - Reflection - Adjustment)',
        `Question: ${qa.question}`,
        `Your Answer: ${studentAnswer}`,
        `Grading Result: ${isCorrect ? '✅ CORRECT' : '❌ INCORRECT'}`,
        '',
        'Teacher Analysis & Explanation:',
        evalResult.reasoning,
        '',
        'Reference Gold Answer:',
        String(qa.answer).trim() === ''
          ? '(This event/fact was never mentioned or occurred; no record exists in conversation)'
          : String(qa.answer),
        '',
        'Source Dialogue Clue / Evidence Location:',
        evidenceSection,
        '',
        '--- Scientific Methodology & Experience Distillation Guidelines ---',
        '1. Anti-Pattern Warning: STRICTLY FORBIDDEN to memorize or record the specific question or answer (e.g., "Caroline is single") into memory. Isolated facts cannot generalize to new questions and pollute memory.',
        '2. Scientific Investigation:',
        '   - Trace & Experiment: If not already certain, use `search_conversation_messages` to examine the cited dialogue evidence and understand why it was missed or how it was framed.',
        '   - Reflection & Diagnosis: Analyze why you missed it initially:',
        '     * Vocabulary / Semantic Gap: Did the question use formal terms while conversations used informal expressions?',
        '     * Speaker Attribution: Did you confuse who spoke vs who was spoken to? How to verify the subject of the action?',
        '     * Temporal Reference: Did you take a session header timestamp literally instead of calculating relative dates using date_calculator?',
        '     * Premature Surrender: Did you give up after one failed keyword search instead of expanding synonyms?',
        '3. Theory Construction & Memory Persistence:',
        '   - Synthesize a general, reusable reasoning rule, search tactic, or verification heuristic.',
        '   - Call `add_level_2_memory` to commit this general heuristic to Level 2 memory with an importance score (e.g. 90-99) and natural associative clues, so you can retrieve it later via `search_memories`.',
        '   - If this exact heuristic is already present in your memory and verified, you do not need to add duplicate entries.',
        '',
        'Return your root cause diagnosis and generalized heuristic.',
      ].join('\n')

      let reflectionResult = await studentAgent.私有反思({
        命令: feedbackPrompt,
        预期结果Schema: z.object({
          root_cause_diagnosis: z.string().describe('Analysis of why you failed or what you overlooked originally'),
          generalized_heuristic: z
            .string()
            .describe(
              'The reusable reasoning, search, or verification rule you learned (NOT a specific question answer)',
            ),
          memory_updated: z.boolean().describe('Whether you saved this general heuristic into memory'),
        }),
        预期结果描述: 'Reflect on teacher feedback, distill scientific heuristics, and persist into memory',
        回调: async (事件): Promise<void> => {
          if (事件.类型 === '工具调用开始') {
            console.log(`      🛠️  [工具调用] ${事件.工具名称} -> ${JSON.stringify(事件.参数).slice(0, 150)}`)
          }
        },
        openai客户端: studentClient,
        模型名称: targetModel,
        温度: 0,
        是否支持函数调用: useNativeToolCalls,
        临时追加工具列表: [dateCalculatorTool],
      })

      let reflectionSummary = `${reflectionResult.结果?.root_cause_diagnosis ?? ''} | Heuristic: ${reflectionResult.结果?.generalized_heuristic ?? ''}`
      let memoriesAfter = await studentAgent.查询记忆()
      let memoryAddedInTurn = memoriesAfter.length > memCountBefore

      if (memoryAddedInTurn === true) {
        console.log(`   📥 [自主记忆沉淀] 学生已主动调用工具将方法论存入长期记忆库`)
      }

      console.log(`   💡 反思与启发: ${reflectionSummary.slice(0, 160)}...`)

      let elapsedMs = Date.now() - roundStart
      roundRecords.push({
        round: r,
        questionIndex: globalIndex,
        poolIndex,
        question: qa.question,
        category: qa.category,
        goldAnswer: String(qa.answer),
        recalledHeuristic: recalledRule,
        studentAnswer,
        isCorrect,
        judgeReasoning: evalResult.reasoning,
        studentReflection: reflectionSummary,
        heuristicPersisted: memoryAddedInTurn,
        elapsedMs,
      })

      // 统计近期胜率（最近 10 轮）
      let windowSize = Math.min(10, roundRecords.length)
      let recentRecords = roundRecords.slice(-windowSize)
      let recentCorrect = recentRecords.filter((rec) => rec.isCorrect).length
      let recentRate = ((recentCorrect / windowSize) * 100).toFixed(1)

      let qHistStr = qStat !== undefined ? qStat.history.map((h) => (h ? '✅' : '❌')).join('') : ''
      console.log(
        `   📊 本题累计: ${String(qStat?.correct ?? 0)}/${String(qStat?.attempts ?? 0)} [${qHistStr}] | 近 ${String(windowSize)} 轮胜率: ${recentRate}% | 总体正确率: ${((totalCorrect / r) * 100).toFixed(1)}% (${String(totalCorrect)}/${String(r)})`,
      )
    } catch (err: unknown) {
      let errMsg = err instanceof Error ? (err.stack ?? err.message) : String(err)
      console.error(`   ⚠️ 本轮执行异常: ${errMsg}`)
    }
  }

  let totalDuration = Date.now() - startTime
  console.log('\n=================================================================')
  console.log('🏁 50 轮随机抽题演练全部结束！生成记忆演化深度分析报告')
  console.log('=================================================================')

  // 阶段分析：前 10 轮 vs 中间 20 轮 vs 后 20 轮
  let earlyRecords = roundRecords.slice(0, 10)
  let midRecords = roundRecords.slice(10, 30)
  let lateRecords = roundRecords.slice(30, 50)

  let earlyRate =
    earlyRecords.length > 0 ? (earlyRecords.filter((r) => r.isCorrect).length / earlyRecords.length) * 100 : 0
  let midRate = midRecords.length > 0 ? (midRecords.filter((r) => r.isCorrect).length / midRecords.length) * 100 : 0
  let lateRate = lateRecords.length > 0 ? (lateRecords.filter((r) => r.isCorrect).length / lateRecords.length) * 100 : 0

  console.log(`\n📈 三阶段准确率对比 (质量演进趋势):`)
  console.log(
    `   🔹 初始摸索期 (第 1 - 10 轮):  ${earlyRate.toFixed(1)}% (${String(earlyRecords.filter((r) => r.isCorrect).length)}/${String(earlyRecords.length)})`,
  )
  console.log(
    `   🔹 经验成长期 (第 11 - 30 轮): ${midRate.toFixed(1)}% (${String(midRecords.filter((r) => r.isCorrect).length)}/${String(midRecords.length)})`,
  )
  console.log(
    `   🔹 稳定深化期 (第 31 - 50 轮): ${lateRate.toFixed(1)}% (${String(lateRecords.filter((r) => r.isCorrect).length)}/${String(lateRecords.length)})`,
  )
  console.log(
    `   🎯 全局总胜率: ${((totalCorrect / cliOptions.totalRounds) * 100).toFixed(1)}% (${String(totalCorrect)}/${String(cliOptions.totalRounds)})`,
  )
  console.log(`   ⏱️ 总演练耗时: ${formatDuration(totalDuration)}`)

  console.log(`\n📋 各题目作答演进轨迹 (Learning Trajectory):`)
  for (let [qIdx, stat] of questionStatsMap.entries()) {
    let histStr = stat.history.map((h) => (h ? '✅' : '❌')).join('➔')
    let rate = stat.attempts > 0 ? ((stat.correct / stat.attempts) * 100).toFixed(1) : '0'
    console.log(
      `   题 #${String(qIdx)} (${stat.question.slice(0, 45)}...): 胜率 ${rate}% (${String(stat.correct)}/${String(stat.attempts)}) | 轨迹: [${histStr}]`,
    )
  }

  let finalMemories = await studentAgent.查询记忆()
  console.log(
    `\n🧠 学生终态记忆总数: ${String(finalMemories.length)} 条 (净增: ${String(finalMemories.length - initialMemories.length)} 条)`,
  )

  let level1Memories = finalMemories.filter((m) => m.等级 === 记忆等级.一级)
  let level2Memories = finalMemories.filter((m) => m.等级 === 记忆等级.二级)

  console.log(
    `\n--- [一级工作记忆区 (${String(level1Memories.length)} 条) | 二级长期记忆区 (${String(level2Memories.length)} 条)] ---`,
  )
  for (let m of level1Memories) {
    let clueStr = m.线索.length > 0 ? ` [${m.线索.join('][')}]` : ''
    console.log(`- [${m.id}] (评分:${String(m.评分)})${clueStr} ${m.内容.slice(0, 120)}...`)
  }

  let allTags = new Set<string>()
  for (let m of finalMemories) {
    for (let t of m.线索) allTags.add(t)
  }
  console.log(`\n🏷️ 记忆网络中的所有线索 (${String(allTags.size)} 种):`)
  console.log(allTags.size > 0 ? Array.from(allTags).join(', ') : '(无线索)')

  let reportPath = path.join(runDir, 'random-practice-report.json')
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        summary: {
          configName: configName ?? 'local',
          totalRounds: cliOptions.totalRounds,
          poolSize: pool.length,
          totalCorrect,
          overallAccuracy: (totalCorrect / cliOptions.totalRounds) * 100,
          earlyAccuracy: earlyRate,
          midAccuracy: midRate,
          lateAccuracy: lateRate,
          totalDurationMs: totalDuration,
          initialMemoryCount: initialMemories.length,
          finalMemoryCount: finalMemories.length,
        },
        questionStats: Array.from(questionStatsMap.values()),
        rounds: roundRecords,
        finalMemories: finalMemories.map((m) => ({
          id: m.id,
          level: m.等级,
          content: m.内容,
          score: m.评分,
          clues: m.线索,
          createdAt: m.创建时间,
        })),
      },
      null,
      2,
    ),
    'utf-8',
  )
  console.log(`\n📁 50 轮完整演练数据已保存至: ${reportPath}`)

  await studentAgent.销毁()
}

runRandomTutorExperiment().catch((err: unknown) => {
  console.error('随机抽题演练实验异常退出:', err)
  process.exit(1)
})
