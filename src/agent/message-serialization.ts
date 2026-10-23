import type OpenAI from 'openai'
import type { 智能体消息类型 } from './types'

/** 库内部用于治理会话的字段, 不发给模型商 */
let 内部字段集合 = new Set([
  'isSystemCorrection',
  'isSystemInjection',
  'systemInjectionKind',
  'systemInjectionFingerprint',
  'prefixFingerprint',
])

/**
 * 按固定的字段顺序输出已知字段, 再按原有顺序附上其余字段(包括模型商自己返回过的额外字段)。
 * 字段顺序固定, 保证同一条消息无论是刚生成的还是从存档里读回来的, 序列化后的字节都一样。
 */
function 规范化对象(来源: object, 已知字段: string[], 覆盖: Record<string, unknown> = {}): Record<string, unknown> {
  let 来源记录: Record<string, unknown> = Object.fromEntries(Object.entries(来源))
  let 结果: Record<string, unknown> = {}
  for (let 键 of 已知字段) {
    if (键 in 覆盖) 结果[键] = 覆盖[键]
    else if (键 in 来源记录 && 来源记录[键] !== undefined) 结果[键] = 来源记录[键]
  }
  for (let [键, 值] of Object.entries(来源记录)) {
    if (键 in 结果 || 内部字段集合.has(键) === true || 值 === undefined) continue
    结果[键] = 值
  }
  return 结果
}

function 规范化工具调用(调用: object): Record<string, unknown> {
  let 函数: unknown = Object.fromEntries(Object.entries(调用))['function']
  return 规范化对象(调用, ['id', 'type', 'function'], {
    ...(typeof 函数 === 'object' && 函数 !== null ? { function: 规范化对象(函数, ['name', 'arguments']) } : {}),
  })
}

export function 转换为模型消息(消息: 智能体消息类型): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  switch (消息.role) {
    case 'system':
      return { ...规范化对象(消息, ['role', 'content', 'name']), role: 'system', content: 消息.content }
    case 'developer':
      return { ...规范化对象(消息, ['role', 'content', 'name']), role: 'developer', content: 消息.content }
    case 'user':
      return { ...规范化对象(消息, ['role', 'content', 'name']), role: 'user', content: 消息.content }
    case 'assistant':
      return {
        ...规范化对象(消息, ['role', 'content', 'name', 'tool_calls', 'function_call'], {
          content: 消息.content ?? null,
          ...(消息.tool_calls !== undefined ? { tool_calls: 消息.tool_calls.map(规范化工具调用) } : {}),
          ...(消息.function_call !== undefined && 消息.function_call !== null
            ? { function_call: 规范化对象(消息.function_call, ['name', 'arguments']) }
            : {}),
        }),
        role: 'assistant',
      }
    case 'tool':
      return {
        ...规范化对象(消息, ['role', 'content', 'tool_call_id']),
        role: 'tool',
        content: 消息.content,
        tool_call_id: 消息.tool_call_id,
      }
    case 'function':
      return {
        ...规范化对象(消息, ['role', 'content', 'name']),
        role: 'function',
        content: 消息.content,
        name: 消息.name,
      }
  }
}
