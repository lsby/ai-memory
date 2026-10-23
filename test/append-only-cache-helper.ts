import OpenAI from 'openai'
import { expect, vi } from 'vitest'
import { z } from 'zod'
import { 智能体工具 } from '../src/index'

export type 脚本项 = {
  文本?: string
  工具调用?: { id: string; 名称: string; 参数: Record<string, unknown> }[]
  用量?: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens: number } }
  /** 模拟请求过程中被中断 */
  中断?: boolean
}

export type 请求记录 = { messages: Record<string, unknown>[]; tools?: unknown[] }

export type 假客户端 = { 客户端: OpenAI; 请求列表: 请求记录[]; 剩余脚本: () => number }

async function* 创建响应流(项: 脚本项): AsyncGenerator<Record<string, unknown>> {
  if (项.文本 !== undefined) yield { choices: [{ delta: { content: 项.文本 } }] }
  if (项.工具调用 !== undefined) {
    yield {
      choices: [
        {
          delta: {
            tool_calls: 项.工具调用.map((调用, index) => ({
              index,
              id: 调用.id,
              function: { name: 调用.名称, arguments: JSON.stringify(调用.参数) },
            })),
          },
        },
      ],
    }
  }
  if (项.用量 !== undefined) yield { choices: [], usage: 项.用量 }
}

/** 假的 openai 客户端: 按脚本依次返回响应, 并记录每次实际发出的请求体(深拷贝) */
export function 创建假客户端(脚本: 脚本项[]): 假客户端 {
  let 客户端 = new OpenAI({ apiKey: 'test' })
  let 请求列表: 请求记录[] = []
  vi.spyOn(客户端.chat.completions, 'create').mockImplementation((async (配置: unknown) => {
    请求列表.push(JSON.parse(JSON.stringify(配置)) as 请求记录)
    let 项 = 脚本.shift()
    if (项 === undefined) throw new Error('脚本已用完')
    if (项.中断 === true) {
      let 错误 = new Error('Request was aborted.')
      错误.name = 'AbortError'
      throw 错误
    }
    return 创建响应流(项)
  }) as never)
  return { 客户端, 请求列表, 剩余脚本: (): number => 脚本.length }
}

export let 加法工具 = 智能体工具.创建({
  名称: 'add',
  描述: '计算两个数字之和',
  参数Schema: z.object({ a: z.number(), b: z.number() }),
  返回值Schema: z.object({ 结果: z.enum(['成功', '失败']), 值: z.number() }),
  实现: async ({ a, b }): Promise<{ 结果: '成功'; 值: number }> => ({ 结果: '成功', 值: a + b }),
})

export let 报错工具 = 智能体工具.创建({
  名称: 'boom',
  描述: '总是抛出错误',
  参数Schema: z.object({}),
  返回值Schema: z.object({ 结果: z.enum(['成功', '失败']) }),
  实现: async (): Promise<{ 结果: '成功' }> => {
    throw new Error('工具炸了')
  },
})

export let 结果Schema = z.object({ 答案: z.number() })

export function 创建选项(
  假: 假客户端,
  命令: string,
): {
  命令: string
  预期结果Schema: typeof 结果Schema
  预期结果描述: string
  回调: () => Promise<void>
  openai客户端: OpenAI
  模型名称: string
} {
  return {
    命令,
    预期结果Schema: 结果Schema,
    预期结果描述: '数字答案',
    回调: async (): Promise<void> => {},
    openai客户端: 假.客户端,
    模型名称: 'mock-model',
  }
}

export function 提交(答案: number, id: string = 'call_submit'): 脚本项 {
  return { 工具调用: [{ id, 名称: '__submit_result__', 参数: { 答案 } }] }
}

/** 相邻两次请求: 前一次的消息必须逐条、逐字段(按序列化后的字节)成为后一次的开头, 工具定义完全相等 */
export function 断言前缀稳定(请求列表: 请求记录[]): void {
  expect(请求列表.length).toBeGreaterThan(1)
  for (let i = 1; i < 请求列表.length; i++) {
    let 上一次 = 请求列表[i - 1]
    let 这一次 = 请求列表[i]
    if (上一次 === undefined || 这一次 === undefined) throw new Error('缺少请求')
    expect(这一次.messages.length).toBeGreaterThanOrEqual(上一次.messages.length)
    for (let j = 0; j < 上一次.messages.length; j++) {
      expect(JSON.stringify(这一次.messages[j])).toBe(JSON.stringify(上一次.messages[j]))
    }
    expect(JSON.stringify(这一次.tools)).toBe(JSON.stringify(上一次.tools))
  }
}
