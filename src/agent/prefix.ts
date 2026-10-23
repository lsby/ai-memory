import { createHash } from 'node:crypto'
import type OpenAI from 'openai'

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
