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
import type { LocomoParsedSample } from './src/types'

let __dirname = path.dirname(fileURLToPath(import.meta.url))

interface TutorCliOptions {
  configName?: string | undefined
  sourceDbDir?: string | undefined
  limit: number
  offset: number
  note?: string | undefined
}

function parseCliArgs(): TutorCliOptions {
  let args = process.argv.slice(2)
  let configName: string | undefined = undefined
  let sourceDbDir: string | undefined = undefined
  let limit = 15
  let offset = 0
  let note: string | undefined = undefined

  for (let i = 0; i < args.length; i++) {
    let arg = args[i]
    if (arg === undefined) continue

    if (arg.startsWith('--from-db=')) {
      sourceDbDir = arg.slice('--from-db='.length).trim()
    } else if (arg === '--from-db' && args[i + 1] !== undefined) {
      sourceDbDir = args[i + 1]?.trim()
      i++
    } else if (arg.startsWith('--limit=')) {
      limit = Number(arg.slice('--limit='.length).trim())
    } else if (arg === '--limit' && args[i + 1] !== undefined) {
      limit = Number(args[i + 1]?.trim())
      i++
    } else if (arg.startsWith('--offset=')) {
      offset = Number(arg.slice('--offset='.length).trim())
    } else if (arg === '--offset' && args[i + 1] !== undefined) {
      offset = Number(args[i + 1]?.trim())
      i++
    } else if (arg.startsWith('--note=')) {
      note = arg.slice('--note='.length).trim()
    } else if (arg.startsWith('-') === false && configName === undefined) {
      configName = arg.trim()
    }
  }

  return { configName, sourceDbDir, limit, offset, note }
}

function buildEvidenceIndex(
  sample: LocomoParsedSample,
): Map<string, { speaker: string; text: string; dateTime: string; sessionId: number }> {
  let map = new Map<string, { speaker: string; text: string; dateTime: string; sessionId: number }>()
  for (let session of sample.sessions) {
    for (let turn of session.turns) {
      map.set(turn.dia_id, {
        speaker: turn.speaker,
        text: turn.text,
        dateTime: session.dateTime,
        sessionId: session.sessionId,
      })
    }
  }
  return map
}

async function runInteractiveTutor(): Promise<void> {
  let cliOptions = parseCliArgs()
  let { loadedPath, configName } = loadBenchmarkEnv(cliOptions.configName)

  console.log('=====================================================')
  console.log('🧑‍🏫 LoCoMo 课堂即时讲评与记忆内化实验 (Interactive Tutor)')
  console.log('=====================================================')
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
  let runDir = path.join(outputDir, `tutoring-${timestamp}-sample-0`)
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
  let targetQuestions = sample.qa.slice(cliOptions.offset, cliOptions.offset + cliOptions.limit)
  console.log(`[样本] 加载人物: ${sample.speakerA} & ${sample.speakerB}`)
  console.log(
    `[范围] 计划讲评题目数: ${String(targetQuestions.length)} 题 (从第 ${String(cliOptions.offset + 1)} 题开始)`,
  )

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
    `[初始状态] 学生初始记忆总数: ${String(initialMemories.length)} 条 (Level 1: ${String(initialMemories.filter((m) => m.等级 === 记忆等级.一级).length)}, Level 2: ${String(initialMemories.filter((m) => m.等级 === 记忆等级.二级).length)})`,
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

  let tutoringRecords: Array<{
    questionIndex: number
    question: string
    category: number
    goldAnswer: string
    studentAnswer: string
    isCorrect: boolean
    judgeReasoning: string
    studentReflection: string
    elapsedMs: number
  }> = []

  let correctCount = 0
  let startTime = Date.now()

  let clearInMemoryHistory = (): void => {
    ;(studentAgent as unknown as { 对话历史: unknown[] }).对话历史 = []
  }

  console.log('\n--- 开始课堂：逐题作答 ➔ 讲评 ➔ 记忆内化 ---')

  for (let idx = 0; idx < targetQuestions.length; idx++) {
    let qa = targetQuestions[idx]
    if (qa === undefined) continue
    let globalIndex = cliOptions.offset + idx + 1
    clearInMemoryHistory()

    let qStart = Date.now()
    console.log(`\n-----------------------------------------------------`)
    console.log(`[题号 ${String(globalIndex)}/${String(sample.qa.length)}] (Category ${String(qa.category)})`)
    console.log(`❓ 问题: ${qa.question}`)

    // 阶段一：学生作答
    let queryPrompt = [
      `Question: ${qa.question}`,
      'Instructions:',
      '- Review your memories and active tools (`search_conversation_messages` and `date_calculator`).',
      '- Directness & Conciseness: State the factual answer directly and concisely.',
      '- Explicit Timelines: When answering questions about when something occurred or is scheduled, state the explicit calendar date, month, or year when available.',
      '- Unmentioned Topics: If both your memories and original dialogue searches confirm no information about the asked event or topic, clearly state that there is no record or it was not mentioned.',
    ].join('\n')

    let studentResult = await studentAgent.私有反思({
      命令: queryPrompt,
      召回查询内容: qa.question,
      预期结果Schema: z.object({
        answer: z.string().describe('Direct and concise answer to the question based on memories'),
      }),
      预期结果描述: 'Answer the question from memory',
      回调: async (): Promise<void> => {},
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
      correctCount++
      console.log(`   🧑‍🏫 老师评分: ✅ CORRECT!`)
    } else {
      console.log(`   🧑‍🏫 老师评分: ❌ WRONG!`)
    }
    console.log(`   📝 老师解析: ${evalResult.reasoning}`)

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

    // 阶段三：讲评反馈与学生自主反思内化
    clearInMemoryHistory()
    let memoryCountBeforeReflection = (await studentAgent.查询记忆()).length
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
      '1. Anti-Pattern Warning: STRICTLY FORBIDDEN to memorize or record the specific question or answer (e.g., "Caroline is single") into memory. Concrete isolated facts cannot generalize to new questions and pollute memory.',
      '2. Scientific Investigation:',
      '   - Trace & Experiment: If not already certain, use `search_conversation_messages` to examine the cited dialogue evidence and understand why it was missed or how it was framed.',
      '   - Reflection & Diagnosis: Analyze why you missed it initially:',
      '     * Vocabulary / Semantic Gap: Did the question use formal terms (e.g. "relationship status") while conversations used informal expressions (e.g. "single mom", "dating")?',
      '     * Speaker Attribution: Did you confuse who spoke vs who was spoken to? How to verify the subject of the action?',
      '     * Temporal Reference: Did you take a session header timestamp literally instead of calculating relative dates ("last Sunday", "two weeks ago") using date_calculator?',
      '     * Premature Surrender: Did you give up after one failed keyword search instead of expanding synonyms?',
      '3. Theory Construction & Memory Persistence:',
      '   - Synthesize a general, reusable reasoning rule, search tactic, or verification heuristic.',
      '   - You MUST call `add_level_1_memory` to commit this general heuristic to your Level 1 working memory!',
      '   - Parameters for `add_level_1_memory`:',
      '     * content: The generalized heuristic rule (NO specific test answers).',
      '     * score: 85 to 95.',
      '     * clues: Natural associative phrases covering the reusable idea, such as "experience summary", "search strategy", "speaker attribution", or "temporal reasoning".',
      '     * commit_message: Short reason (e.g., "Distill general search tactic from question feedback").',
      '   - Only after calling `add_level_1_memory` (or confirming this exact heuristic is already stored in memory), return your final reflection result.',
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
      回调: async (): Promise<void> => {},
      openai客户端: studentClient,
      模型名称: targetModel,
      温度: 0,
      是否支持函数调用: useNativeToolCalls,
      临时追加工具列表: [dateCalculatorTool],
    })

    let reflectionSummary = `${reflectionResult.结果?.root_cause_diagnosis ?? ''} | Heuristic: ${reflectionResult.结果?.generalized_heuristic ?? ''}`

    // 检查学生是否已经在工具调用中添加了记忆
    let memoriesAfterReflection = await studentAgent.查询记忆()
    let memoryAddedInTurn = memoriesAfterReflection.length > memoryCountBeforeReflection

    // 如果学生提炼了有价值的通用经验但在该回合中未主动触发写工具，辅助将其提炼的经验沉淀入一级记忆
    if (
      memoryAddedInTurn === false &&
      reflectionResult.结果?.generalized_heuristic !== undefined &&
      reflectionResult.结果.generalized_heuristic.trim().length > 0
    ) {
      let heuristic = reflectionResult.结果.generalized_heuristic.trim()
      let isSpecificAnswer =
        heuristic.toLowerCase().includes('caroline is') ||
        heuristic.toLowerCase().includes('melanie is') ||
        heuristic.length < 15 ||
        heuristic.toLowerCase().startsWith('no heuristic')
      if (!isSpecificAnswer) {
        await studentAgent.添加记忆({
          等级: 记忆等级.一级,
          内容: heuristic,
          评分: 85,
          线索: ['heuristic', 'strategy', `category_${qa.category}`],
          创建时间: new Date(),
        })
        memoryAddedInTurn = true
        console.log(`   📥 [经验沉淀] 已将学生自主提炼的方法论经验沉淀入一级记忆库`)
      }
    }

    console.log(`   💡 学生反思: ${reflectionSummary} (经验记忆已沉淀: ${memoryAddedInTurn ? '是' : '否'})`)

    let elapsedMs = Date.now() - qStart
    tutoringRecords.push({
      questionIndex: globalIndex - 1,
      question: qa.question,
      category: qa.category,
      goldAnswer: String(qa.answer),
      studentAnswer,
      isCorrect,
      judgeReasoning: evalResult.reasoning,
      studentReflection: reflectionSummary,
      elapsedMs,
    })
  }

  let totalDuration = Date.now() - startTime
  console.log('\n=====================================================')
  console.log('🏁 课堂讲评结束！生成记忆演化体检报告')
  console.log('=====================================================')
  console.log(
    `讲评题数: ${String(targetQuestions.length)} | 答对数: ${String(correctCount)} | 正确率: ${((correctCount / targetQuestions.length) * 100).toFixed(1)}%`,
  )
  console.log(`课堂耗时: ${formatDuration(totalDuration)}`)

  // 结课阶段：全量记忆体检
  let finalMemories = await studentAgent.查询记忆()
  console.log(
    `\n🧠 学生当前记忆总数: ${String(finalMemories.length)} 条 (较初始净增: ${String(finalMemories.length - initialMemories.length)} 条)`,
  )

  let level1Memories = finalMemories.filter((m) => m.等级 === 记忆等级.一级)
  let level2Memories = finalMemories.filter((m) => m.等级 === 记忆等级.二级)

  console.log(`\n--- [一级工作记忆区 (${String(level1Memories.length)} 条)] ---`)
  for (let m of level1Memories) {
    let tagStr = m.线索.length > 0 ? ` [${m.线索.join('][')}]` : ''
    let kwStr = m.线索.length > 0 ? ` (线索: ${m.线索.join(', ')})` : ''
    console.log(`- [${m.id}] (评分:${String(m.评分)})${tagStr} ${m.内容}${kwStr}`)
  }

  console.log(`\n--- [二级长期记忆区 (${String(level2Memories.length)} 条)] ---`)
  for (let m of level2Memories) {
    let tagStr = m.线索.length > 0 ? ` [${m.线索.join('][')}]` : ''
    let kwStr = m.线索.length > 0 ? ` (线索: ${m.线索.join(', ')})` : ''
    console.log(`- [${m.id}] (评分:${String(m.评分)})${tagStr} ${m.内容}${kwStr}`)
  }

  // 线索聚类分析
  let allTags = new Set<string>()
  for (let m of finalMemories) {
    for (let t of m.线索) allTags.add(t)
  }
  console.log(`\n🏷️ 记忆网络中的所有线索 (${String(allTags.size)} 种):`)
  console.log(allTags.size > 0 ? Array.from(allTags).join(', ') : '(无线索)')

  // 保存评测与反思总结到 JSON
  let reportPath = path.join(runDir, 'tutoring-report.json')
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        summary: {
          configName: configName ?? 'local',
          totalQuestions: targetQuestions.length,
          correctCount,
          accuracy: (correctCount / targetQuestions.length) * 100,
          totalDurationMs: totalDuration,
          initialMemoryCount: initialMemories.length,
          finalMemoryCount: finalMemories.length,
        },
        records: tutoringRecords,
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
  console.log(`\n📁 完整讲评记录与反思日记已保存至: ${reportPath}`)

  await studentAgent.销毁()
}

runInteractiveTutor().catch((err: unknown) => {
  let msg = err instanceof Error ? (err.stack ?? err.message) : String(err)
  console.error('交互讲评实验异常退出:\n' + msg)
  if (err !== null && typeof err === 'object' && 'cause' in err) {
    console.error('Caused by: ' + String((err as Record<string, unknown>)['cause']))
  }
  process.exit(1)
})
