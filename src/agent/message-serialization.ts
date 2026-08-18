import type OpenAI from 'openai'
import type { 智能体消息类型 } from './types'

export function 转换为模型消息(消息: 智能体消息类型): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  switch (消息.role) {
    case 'system':
      return { role: 'system', content: 消息.content, ...(消息.name !== undefined ? { name: 消息.name } : {}) }
    case 'developer':
      return { role: 'developer', content: 消息.content, ...(消息.name !== undefined ? { name: 消息.name } : {}) }
    case 'user':
      return { role: 'user', content: 消息.content, ...(消息.name !== undefined ? { name: 消息.name } : {}) }
    case 'assistant':
      return {
        role: 'assistant',
        content: 消息.content ?? null,
        ...(消息.name !== undefined ? { name: 消息.name } : {}),
        ...(消息.tool_calls !== undefined ? { tool_calls: 消息.tool_calls } : {}),
        ...(消息.function_call !== undefined ? { function_call: 消息.function_call } : {}),
      }
    case 'tool':
      return { role: 'tool', content: 消息.content, tool_call_id: 消息.tool_call_id }
    case 'function':
      return { role: 'function', content: 消息.content, name: 消息.name }
  }
}
