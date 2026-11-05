import OpenAI from 'openai'
import { z } from 'zod'
import { 带记忆的智能体 } from '../../../../src/agent-memory/agent-memory'
import { 英文模型语言包 } from '../../../../src/agent-memory/model-language'
import { 记忆等级 } from '../../../../src/agent-memory/types'
import type { 智能体事件, 模型审计汇总, 模型请求审计记录 } from '../../../../src/agent/types'
import { dateCalculatorTool } from './date-calculator'
import type { LocomoAuditStats, LocomoParsedSession, LocomoQA, LocomoQAResult } from './types'

export interface LocomoRunnerOptions {
  baseURL: string
  apiKey: string
  modelName: string
  firstLevelCapacity?: number | undefined
  logEvents?: boolean | undefined
  timezone?: string | undefined
  useNativeToolCalls?: boolean | undefined
  storageDir?: string | undefined
  funesMode?: boolean | undefined
  funesSearchLimit?: number | undefined
  deliberation?: boolean | undefined
}

export class LocomoRunner {
  private openaiClient: OpenAI
  private agent: 带记忆的智能体
  private modelName: string
  private logEvents: boolean
  private useNativeToolCalls: boolean
  private funesMode: boolean
  private funesSearchLimit: number
  private deliberationMode: boolean

  private handleEvent = async (event: 智能体事件): Promise<void> => {
    if (this.logEvents === false) return
    if (event.类型 === '工具调用开始') {
      console.log(`  [Tool Call] ${event.工具名称}:`, JSON.stringify(event.参数))
    } else if (event.类型 === '工具调用结果') {
      console.log(`  [Tool Result] ${event.工具名称} (${String(event.耗时ms)}ms)`)
    } else if (event.类型 === '流程信息') {
      console.log(`  [Info] ${event.内容}`)
    } else if (event.类型 === '错误') {
      console.error(`  [Agent Error] ${event.错误信息}`)
    }
  }

  public constructor(options: LocomoRunnerOptions) {
    this.openaiClient = new OpenAI({
      baseURL: options.baseURL,
      apiKey: options.apiKey,
    })
    this.modelName = options.modelName
    this.logEvents = options.logEvents ?? false
    this.useNativeToolCalls = options.useNativeToolCalls ?? false
    this.funesMode = options.funesMode ?? false
    this.funesSearchLimit = options.funesSearchLimit ?? 20
    this.deliberationMode = options.deliberation ?? true

    // 开放全套记忆存取与检索工具（排除动态代码编写工具）
    let 内存记忆工具筛选 = (工具名: string): boolean => 工具名.includes('skill') === false && 工具名 !== 'execute_code'

    this.agent = new 带记忆的智能体({
      系统提示词:
        'You are an intelligent long-term conversational memory agent. Your role is to build a coherent, persistent mental model of the users across ongoing conversations, remembering their traits, relationships, experiences, preferences, and timeline.',
      最大校验重试次数: 3,
      最大循环轮次: 15,
      一级记忆容量: options.firstLevelCapacity ?? 30,
      自动检索二级记忆数量: 10,
      自动检索线索数量: 10,
      向量召回相似度阈值: 0.4,
      记忆工具筛选: 内存记忆工具筛选,
      模型语言包: 英文模型语言包,
      时区: options.timezone ?? 'UTC',
      向量模型: { 类型: '本地', 模型名称: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2' },
      // 支持本地文件持久化存储（存本地数据库）
      ...(options.storageDir !== undefined ? { 存储: { 模式: '文件' as const, 路径: options.storageDir } } : {}),
      ...(this.funesMode === true ? { 博闻强记模式: true, 博闻强记消息搜索数量: this.funesSearchLimit } : {}),
    })
  }

  private clearInMemoryHistory(): void {
    ;(this.agent as unknown as { 对话历史: unknown[] }).对话历史 = []
  }

  public async init(): Promise<void> {
    await this.agent.初始化()
    if (this.funesMode === true) {
      let 会话列表 = await this.agent.查询会话列表()
      if (会话列表.length === 0) {
        await this.agent.创建会话({ 标题: 'LoCoMo Benchmark Sessions' })
      }
      this.clearInMemoryHistory()
    }
  }

  /**
   * 阶段一：通用长程对话记忆摄取（强化时序锚定与原子化提取）
   */
  public async ingestSessions(
    sessions: LocomoParsedSession[],
    onProgress?: (current: number, total: number) => void,
  ): Promise<void> {
    for (let i = 0; i < sessions.length; i++) {
      let session = sessions[i]
      if (session === undefined) continue

      if (onProgress !== undefined) {
        onProgress(i + 1, sessions.length)
      }

      let turnsText = session.turns
        .map((t) => {
          let line = `${t.speaker}: ${t.text}`
          if (typeof t.blip_caption === 'string' && t.blip_caption !== '') {
            line += ` [Shared Image: ${t.blip_caption}]`
          }
          return line
        })
        .join('\n')

      let sessionPrompt = [
        `[Session Date/Time: ${session.dateTime}]`,
        turnsText,
        '',
        'Task: Record all salient facts, events, and personal information from this conversation into memory using the provided tools.',
        'Guidelines:',
        '- Comprehensiveness: Exhaustively record each distinct fact, life experience, plan, preference, background detail, and interpersonal dynamic mentioned by the speakers.',
        `- Grounding: Anchor relative time expressions (e.g. days, weeks, months, or years relative to now) to explicit dates or timeframes using the session timestamp (${session.dateTime}).`,
        '- Atomicity: Store clear, atomic memory entries with explicit subjects so they can be reliably searched and retrieved later.',
        '- Do not aggressively filter or discard information; err on the side of preserving useful details.',
      ].join('\n')

      if (this.funesMode === true) {
        let currentConv = await this.agent.读取当前会话()
        let parentMessageId = currentConv.当前消息id

        let headerMsg = await this.agent.追加会话消息({
          会话id: currentConv.id,
          预期父消息id: parentMessageId,
          消息: {
            role: 'user',
            content: `[Session ${String(i + 1)} Date/Time: ${session.dateTime}]`,
          },
        })
        parentMessageId = headerMsg.id

        for (let t of session.turns) {
          let line = `${t.speaker}: ${t.text}`
          if (typeof t.blip_caption === 'string' && t.blip_caption !== '') {
            line += ` [Shared Image: ${t.blip_caption}]`
          }
          let turnMsg = await this.agent.追加会话消息({
            会话id: currentConv.id,
            预期父消息id: parentMessageId,
            消息: {
              role: 'user',
              content: line,
            },
          })
          parentMessageId = turnMsg.id
        }

        this.clearInMemoryHistory()
      }

      await this.agent.私有反思({
        命令: sessionPrompt,
        预期结果Schema: z.object({
          summary: z.string().describe('Brief summary of what occurred in this session'),
          memoriesSaved: z.number().describe('Number of facts extracted and saved to memory'),
        }),
        预期结果描述: 'Reflect and store memories from the session',
        回调: this.handleEvent,
        openai客户端: this.openaiClient,
        模型名称: this.modelName,
        温度: 0,
        是否支持函数调用: this.useNativeToolCalls,
        临时追加工具列表: [dateCalculatorTool],
      })
    }
  }

  /**
   * 阶段 1.5：记忆重组与潜意识梦境巩固 (Memory Consolidation)
   */
  public async reorganizeMemories(
    rounds: number,
    onProgress?: (current: number, total: number) => void,
  ): Promise<void> {
    for (let i = 1; i <= rounds; i++) {
      if (onProgress !== undefined) {
        onProgress(i, rounds)
      }
      await this.agent.执行记忆重组({
        openai客户端: this.openaiClient,
        模型名称: this.modelName,
        回调: this.handleEvent,
        是否支持函数调用: this.useNativeToolCalls,
      })
    }
  }

  /**
   * 阶段二：通用 QA 记忆回捞与作答（强化绝对时间换算与列举项穷尽聚合）
   */
  public async answerQuestions(
    qaList: LocomoQA[],
    onProgress?: (current: number, total: number) => void,
  ): Promise<LocomoQAResult[]> {
    let results: LocomoQAResult[] = []
    this.clearInMemoryHistory()

    for (let i = 0; i < qaList.length; i++) {
      let qa = qaList[i]
      if (qa === undefined) continue

      this.clearInMemoryHistory()

      if (onProgress !== undefined) {
        onProgress(i + 1, qaList.length)
      }

      let funesGuidance =
        this.funesMode === true
          ? [
              '- Active Dialogue Search: You have full access to original dialogue turns via `search_conversation_messages`. If your retrieved memories do not explicitly contain the specific detail, exact quote, name, or fact, DO NOT immediately guess or conclude "no record".',
              '- Multi-Angle Search Strategy: If an initial search query returns no results or ambiguous matches, try alternative keyword variants, synonyms, root forms of words, or simpler noun/verb queries before concluding that something was unmentioned.',
              '- Speaker Attribution Verification: In two-person dialogues, be attentive to speaker attribution. Ensure traits, events, and actions mentioned in conversation are attributed to the correct participant rather than confusing one with the other.',
            ]
          : []

      let startMs = Date.now()
      let recalledRule = 'None'
      let actionPlan = ''

      if (this.deliberationMode === true) {
        let analysisPrompt = [
          `Question to Solve: ${qa.question}`,
          'Instructions for Question Analysis & Theory Activation:',
          '- Identify the question type (e.g. relative date calculation, speaker attribution, career/qualification details, relationship inference, event timing).',
          '- Call `search_memories` with natural-language contents to search Level 2 long-term memory for applicable heuristics, lessons, or guidelines.',
          '- Summarize the recalled heuristics and formulate your strategic action plan for solving this question.',
        ].join('\n')

        let analysisResult = await this.agent.私有反思({
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
          回调: this.handleEvent,
          openai客户端: this.openaiClient,
          模型名称: this.modelName,
          温度: 0,
          是否支持函数调用: this.useNativeToolCalls,
          临时追加工具列表: [],
        })

        recalledRule = analysisResult.结果?.recalled_heuristics ?? 'None'
        actionPlan = analysisResult.结果?.action_plan ?? ''
        this.clearInMemoryHistory()
      }

      let activeRuleSection =
        recalledRule !== 'None' && recalledRule.trim() !== ''
          ? recalledRule
          : '- No specific prior rule matched. Follow standard verification procedures.'
      let planSection =
        actionPlan !== '' && actionPlan.trim() !== ''
          ? actionPlan
          : '- Search conversation messages for evidence and verify facts directly.'

      let queryPrompt = [
        `Question: ${qa.question}`,
        '',
        '--- Active Guidelines Recalled from Long-Term Memory ---',
        activeRuleSection,
        '',
        '--- Planned Search & Reasoning Strategy ---',
        planSection,
        '',
        'Instructions for Investigation & Answering:',
        '- Review Memories & Gather Facts: Review all memories concerning the people, events, and timeline asked about. Actively use your available tools (`search_conversation_messages` and `date_calculator`) to verify details or discover original context before submitting the final answer.',
        '- Date & Calendar Calculations: When questions ask for specific dates, day of the week, elapsed durations, or relative times (e.g., "last week", "3 days ago", "X years ago"), use the `date_calculator` tool to perform or verify calendar math instead of relying solely on mental estimation.',
        '- Targeted & Direct: State the specific fact, name, date, or answer directly and avoid lengthy unrelated conversation recitals.',
        '- Explicit Timelines: When answering questions about when something occurred or is scheduled, state the explicit calendar date, month, or year when available.',
        '- Synthesis: If an answer requires connecting clues across multiple events or listing several items, aggregate them completely.',
        '- Unmentioned Topics: If both your memories and original dialogue searches confirm no information about the asked event or topic, clearly state that there is no record or it was not mentioned.',
        ...funesGuidance,
      ].join('\n')

      let roundResult = await this.agent.私有反思({
        命令: queryPrompt,
        召回查询内容: qa.question,
        预期结果Schema: z.object({
          answer: z.string().describe('Direct and concise answer to the question based on memories'),
        }),
        预期结果描述: 'Answer the question from memory',
        回调: this.handleEvent,
        openai客户端: this.openaiClient,
        模型名称: this.modelName,
        温度: 0,
        是否支持函数调用: this.useNativeToolCalls,
        临时追加工具列表: [dateCalculatorTool],
      })
      let elapsedMs = Date.now() - startMs

      let answerText = roundResult.结果?.answer ?? ''

      results.push({
        questionIndex: i,
        question: qa.question,
        category: qa.category,
        goldAnswer: String(qa.answer),
        predictedAnswer: answerText,
        evidence: qa.evidence,
        elapsedMs,
      })
    }

    return results
  }

  /**
   * 获取智能体内部的完整审计数据
   */
  public async getAuditStats(): Promise<{
    stats: LocomoAuditStats
    detailedRecords: 模型请求审计记录[]
  }> {
    let modelAudit: 模型审计汇总 = this.agent.读取模型审计汇总()
    let detailedRecords = this.agent.读取模型审计记录()

    let allMemories = await this.agent.查询记忆()
    let level0 = allMemories.filter((m) => m.等级 === 记忆等级.零级).length
    let level1 = allMemories.filter((m) => m.等级 === 记忆等级.一级).length
    let level2 = allMemories.filter((m) => m.等级 === 记忆等级.二级).length

    let stats: LocomoAuditStats = {
      modelAudit,
      memoryStats: {
        total: allMemories.length,
        level0,
        level1,
        level2,
      },
    }

    return { stats, detailedRecords }
  }

  public async destroy(): Promise<void> {
    await this.agent.销毁()
  }
}
