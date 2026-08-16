import { jsonrepair } from 'jsonrepair'
import type { z } from 'zod'
import { 提交结果函数名 } from './constants'
import type { 智能体工具, 累积工具调用 } from './types'

/**
 * 从文本中提取工具调用结构。
 * AI 有时不使用 tool_calls 字段, 而是将工具调用以 JSON 形式嵌入回复文本中。
 */
export function 从文本提取工具调用(文本: string, 工具列表: 智能体工具[]): 累积工具调用[] | null {
  let 候选json列表 = 提取候选json(文本)
  let 计数器 = 0
  let 所有工具调用: 累积工具调用[] = []

  for (let json文本 of 候选json列表) {
    let 解析结果 = 尝试解析json(json文本)
    if (解析结果 === null) continue

    if (Array.isArray(解析结果) === true) {
      let 结果列表 = 解析工具调用数组(解析结果 as unknown[], 计数器, 工具列表)
      if (结果列表 !== null) {
        for (let 调用 of 结果列表) {
          let 已存在 = 所有工具调用.some((t) => t.名称 === 调用.名称 && t.参数片段 === 调用.参数片段)
          if (已存在 === false) {
            所有工具调用.push({ id: `text_extracted_${String(计数器)}`, 名称: 调用.名称, 参数片段: 调用.参数片段 })
            计数器++
          }
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (typeof 解析结果 === 'object' && 解析结果 !== null && Array.isArray(解析结果) === false) {
      let 对象 = 解析结果 as Record<string, unknown>
      if (Array.isArray(对象['tool_calls']) === true) {
        let 结果列表 = 解析工具调用数组(对象['tool_calls'] as unknown[], 计数器, 工具列表)
        if (结果列表 !== null) {
          for (let 调用 of 结果列表) {
            let 已存在 = 所有工具调用.some((t) => t.名称 === 调用.名称 && t.参数片段 === 调用.参数片段)
            if (已存在 === false) {
              所有工具调用.push({ id: `text_extracted_${String(计数器)}`, 名称: 调用.名称, 参数片段: 调用.参数片段 })
              计数器++
            }
          }
        }
      }

      let 单个调用 = 解析单个工具调用对象(对象, 计数器, 工具列表)
      if (单个调用 !== null) {
        let 已存在 = 所有工具调用.some((t) => t.名称 === 单个调用.名称 && t.参数片段 === 单个调用.参数片段)
        if (已存在 === false) {
          所有工具调用.push({
            id: `text_extracted_${String(计数器)}`,
            名称: 单个调用.名称,
            参数片段: 单个调用.参数片段,
          })
          计数器++
        }
      }

      if (typeof 对象['function'] === 'object' && 对象['function'] !== null) {
        let 单个 = 解析单个工具调用对象(对象['function'] as Record<string, unknown>, 计数器, 工具列表)
        if (单个 !== null) {
          let 已存在 = 所有工具调用.some((t) => t.名称 === 单个.名称 && t.参数片段 === 单个.参数片段)
          if (已存在 === false) {
            所有工具调用.push({ id: `text_extracted_${String(计数器)}`, 名称: 单个.名称, 参数片段: 单个.参数片段 })
            计数器++
          }
        }
      }
    }
  }

  if (所有工具调用.length > 0) {
    return 所有工具调用
  }

  return null
}

function 提取候选json(文本: string): string[] {
  let 候选列表: string[] = []
  let 代码块正则 = /```(?:json)?\s*\n?([\s\S]*?)```/g
  let 匹配: RegExpExecArray | null
  while ((匹配 = 代码块正则.exec(文本)) !== null) {
    let 内容 = 匹配[1] ?? null
    if (内容 !== null) 候选列表.push(内容)
  }
  let 数组正则 = /\[[\s\S]*\]/g
  while ((匹配 = 数组正则.exec(文本)) !== null) {
    候选列表.push(匹配[0])
  }
  let 对象正则 = /\{[\s\S]*\}/g
  while ((匹配 = 对象正则.exec(文本)) !== null) {
    候选列表.push(匹配[0])
  }
  return 候选列表
}

function 尝试解析json(文本: string): unknown | null {
  try {
    return JSON.parse(jsonrepair(文本)) as unknown
  } catch {
    return null
  }
}

function 解析工具调用数组(数组: unknown[], 计数器起始: number, 工具列表: 智能体工具[]): 累积工具调用[] | null {
  let 结果列表: 累积工具调用[] = []
  let 计数器 = 计数器起始
  for (let 项 of 数组) {
    if (typeof 项 !== 'object' || 项 === null) continue
    let 对象 = 项 as Record<string, unknown>
    if (typeof 对象['function'] === 'object' && 对象['function'] !== null) {
      let 调用 = 解析单个工具调用对象(对象['function'] as Record<string, unknown>, 计数器, 工具列表)
      if (调用 !== null) {
        结果列表.push(调用)
        计数器++
        continue
      }
    }
    let 调用 = 解析单个工具调用对象(对象, 计数器, 工具列表)
    if (调用 !== null) {
      结果列表.push(调用)
      计数器++
    }
  }
  if (结果列表.length > 0) return 结果列表
  return null
}

function 解析单个工具调用对象(
  对象: Record<string, unknown>,
  编号: number,
  工具列表: 智能体工具[],
): 累积工具调用 | null {
  let 名称 = 对象['name']
  if (typeof 名称 !== 'string' || 名称.trim() === '') return null
  let 参数 = 对象['arguments'] ?? 对象['parameters'] ?? null
  if (参数 === null) return null
  let 参数片段 = typeof 参数 === 'string' ? 参数 : JSON.stringify(参数)
  let 是已知工具 = 名称 === 提交结果函数名 || 工具列表.some((t) => t.名称 === 名称)
  if (是已知工具 === false) return null
  return { id: `text_extracted_${String(编号)}`, 名称: 名称, 参数片段: 参数片段 }
}

export function 从文本提取结果(文本: string, 预期结果Schema: z.ZodType): Record<string, unknown> | null {
  let 代码块正则 = /```(?:json)?\s*\n?([\s\S]*?)```/g
  let 匹配: RegExpExecArray | null
  while ((匹配 = 代码块正则.exec(文本)) !== null) {
    let 内容 = 匹配[1] ?? null
    if (内容 === null) continue
    let 结果 = 尝试解析并校验(内容, 预期结果Schema)
    if (结果 !== null) return 结果
  }
  let json对象正则 = /\{[\s\S]*\}/g
  while ((匹配 = json对象正则.exec(文本)) !== null) {
    let 结果 = 尝试解析并校验(匹配[0], 预期结果Schema)
    if (结果 !== null) return 结果
  }
  return null
}

function 尝试解析并校验(文本: string, schema: z.ZodType): Record<string, unknown> | null {
  try {
    let 解析结果 = JSON.parse(jsonrepair(文本)) as Record<string, unknown>
    let 校验结果 = schema.safeParse(解析结果)
    if (校验结果.success === true) return 校验结果.data as Record<string, unknown>
  } catch {
    /* 解析失败, 忽略 */
  }
  return null
}
