import { createHash } from 'node:crypto'
import type OpenAI from 'openai'
import type { z } from 'zod'
import type { 回合结果, 智能体执行模式, 智能体消息类型 } from './types'

/** 前缀指纹 = sha256(组装好的系统提示词全文 + 发给模型的工具定义 JSON)。工具定义里包含提交结果函数 */
export function 计算前缀指纹(
  系统提示词: string,
  发给模型的工具定义: OpenAI.Chat.Completions.ChatCompletionTool[],
): string {
  return createHash('sha256').update(系统提示词).update('\n').update(JSON.stringify(发给模型的工具定义)).digest('hex')
}

/** 注入消息的内容指纹 */
export function 计算内容指纹(内容: string): string {
  return createHash('sha256').update(内容).digest('hex')
}

/** 历史为空或推演时一致; 否则第一条必须是带相同指纹的 system */
export function 前缀是否一致(历史: 智能体消息类型[], 执行模式: 智能体执行模式, 前缀指纹: string): boolean {
  if (执行模式 === '推演' || 历史.length === 0) return true
  let 第一条 = 历史[0]
  return 第一条?.role === 'system' && 第一条.prefixFingerprint === 前缀指纹
}

/** 前缀已变时的返回结果: 没有发请求, 新增上下文和用量都为空, 历史原样返回 */
export function 构造前缀已变结果<T extends z.ZodType>(历史: 智能体消息类型[]): 回合结果<T> {
  return { 结果: null, 消息列表: [...历史], 新增上下文: [], 结束原因: '前缀已变', 用量: [], 历史已截断: false }
}
