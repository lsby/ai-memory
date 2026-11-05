import type { 智能体事件 } from '@lsby/ai-memory'
import { 带记忆的智能体, 英文模型语言包 } from '@lsby/ai-memory'
import OpenAI from 'openai'
import { z } from 'zod'
import { dateCalculatorTool } from '../locomo-bridge'
import { buildAnalysisPrompt, buildFeedbackPrompt, buildQueryPrompt } from './prompts'
import type { QuestionAnalysisResult } from './types'

export type AgentRunnerContext = {
  agent: 带记忆的智能体
  client: OpenAI
  modelName: string
  useNativeToolCalls: boolean
}

export async function createGrowthAgent(params: {
  dbDir: string
  baseURL: string
  apiKey: string
  modelName: string
  useNativeToolCalls?: boolean
}): Promise<AgentRunnerContext> {
  let agent = new 带记忆的智能体({
    系统提示词:
      'You are a rigorous, scientific QA reasoning agent with persistent associative memory. You carefully analyze questions, retrieve strategic problem-solving heuristics, verify details against conversation messages, and state direct, factual answers.',
    一级记忆容量: 30,
    模型语言包: 英文模型语言包,
    向量模型: { 类型: '本地', 模型名称: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2' },
    存储: { 模式: '文件', 路径: params.dbDir },
    博闻强记模式: true,
    博闻强记消息搜索数量: 20,
  })

  await agent.初始化()
  let convList = await agent.查询会话列表()
  if (convList.length > 0 && convList[0] !== undefined) {
    await agent.切换会话(convList[0].id)
  }

  let client = new OpenAI({
    baseURL: params.baseURL,
    apiKey: params.apiKey,
  })

  return {
    agent,
    client,
    modelName: params.modelName,
    useNativeToolCalls: params.useNativeToolCalls ?? false,
  }
}

export function clearAgentInMemoryHistory(agent: 带记忆的智能体): void {
  ;(agent as unknown as { 对话历史: unknown[] }).对话历史 = []
}

export async function runAnalysisPhase(
  ctx: AgentRunnerContext,
  question: string,
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void,
): Promise<QuestionAnalysisResult> {
  clearAgentInMemoryHistory(ctx.agent)
  let prompt = buildAnalysisPrompt(question)

  let result = await ctx.agent.私有反思({
    命令: prompt,
    召回查询内容: question,
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
    回调: async (事件: 智能体事件): Promise<void> => {
      if (事件.类型 === '工具调用开始' && onToolCall !== undefined) {
        onToolCall(事件.工具名称, 事件.参数)
      }
    },
    openai客户端: ctx.client,
    模型名称: ctx.modelName,
    温度: 0,
    是否支持函数调用: ctx.useNativeToolCalls,
    临时追加工具列表: [],
  })

  return {
    problemCategory: result.结果?.problem_category ?? 'general',
    recalledHeuristics: result.结果?.recalled_heuristics ?? 'None',
    actionPlan: result.结果?.action_plan ?? '',
  }
}

export async function runQueryPhase(
  ctx: AgentRunnerContext,
  question: string,
  analysis: QuestionAnalysisResult,
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void,
): Promise<string> {
  clearAgentInMemoryHistory(ctx.agent)
  let prompt = buildQueryPrompt(question, analysis.recalledHeuristics, analysis.actionPlan)

  let result = await ctx.agent.私有反思({
    命令: prompt,
    召回查询内容: question,
    预期结果Schema: z.object({
      answer: z.string().describe('Direct and concise factual answer to the question'),
    }),
    预期结果描述: 'Answer the question using conversation search and date calculator following the active guidelines',
    回调: async (事件: 智能体事件): Promise<void> => {
      if (事件.类型 === '工具调用开始' && onToolCall !== undefined) {
        onToolCall(事件.工具名称, 事件.参数)
      }
    },
    openai客户端: ctx.client,
    模型名称: ctx.modelName,
    温度: 0,
    是否支持函数调用: ctx.useNativeToolCalls,
    临时追加工具列表: [dateCalculatorTool],
  })

  return result.结果?.answer ?? ''
}

export async function runReflectionPhase(
  ctx: AgentRunnerContext,
  params: {
    question: string
    studentAnswer: string
    isCorrect: boolean
    teacherReasoning: string
    goldAnswer: string
    evidenceText: string
  },
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void,
): Promise<{ diagnosis: string; generalizedHeuristic: string }> {
  clearAgentInMemoryHistory(ctx.agent)
  let prompt = buildFeedbackPrompt(params)

  let result = await ctx.agent.私有反思({
    命令: prompt,
    预期结果Schema: z.object({
      diagnosis: z.string().describe('Root cause diagnosis of why the question was answered correctly or incorrectly'),
      generalized_heuristic: z
        .string()
        .describe(
          'A generalizable reasoning heuristic or verification rule distilled from this case (MUST NOT contain isolated specific facts)',
        ),
    }),
    预期结果描述:
      'Reflect on performance, synthesize general reasoning heuristic, and commit it to Level 2 memory via add_level_2_memory with associative clues',
    回调: async (事件: 智能体事件): Promise<void> => {
      if (事件.类型 === '工具调用开始' && onToolCall !== undefined) {
        onToolCall(事件.工具名称, 事件.参数)
      }
    },
    openai客户端: ctx.client,
    模型名称: ctx.modelName,
    温度: 0,
    是否支持函数调用: ctx.useNativeToolCalls,
    临时追加工具列表: [],
  })

  return {
    diagnosis: result.结果?.diagnosis ?? '',
    generalizedHeuristic: result.结果?.generalized_heuristic ?? '',
  }
}
