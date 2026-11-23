import { 带记忆的智能体 } from '@lsby/ai-memory'
import OpenAI from 'openai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { 使用共享PGlite } from '../../helpers/shared-pglite-fixture'

let 流式请求AI模拟 = vi.hoisted(() => vi.fn())

vi.mock('../../../../ai-agent/src/core/stream-request', () => ({ 流式请求AI: 流式请求AI模拟 }))

type 临时消息参数 = { 插入位置: number; 内容列表: string[] } | undefined

describe('本轮临时消息透传', () => {
  let 夹具 = 使用共享PGlite()
  let 实例: 带记忆的智能体 | undefined
  let 消息快照: Array<Array<{ role: string; content?: string | null }>> = []

  beforeEach((): void => {
    消息快照 = []
    流式请求AI模拟.mockReset()
    流式请求AI模拟.mockImplementation(
      async (_客户端, _模型, 消息列表): Promise<{ 完整文本: string; 工具调用列表: []; 已中断: false }> => {
        消息快照.push(JSON.parse(JSON.stringify(消息列表)) as Array<{ role: string; content?: string | null }>)
        return { 完整文本: '{"轮次":1}', 工具调用列表: [], 已中断: false }
      },
    )
  })

  afterEach(async (): Promise<void> => {
    if (实例 !== undefined) {
      await 实例.销毁()
      实例 = undefined
    }
  })

  function 选项(命令: string): {
    命令: string
    预期结果Schema: z.ZodObject<{ 轮次: z.ZodNumber }>
    预期结果描述: string
    回调: () => Promise<void>
    openai客户端: OpenAI
    模型名称: string
    是否自动召回: false
  } {
    return {
      命令,
      预期结果Schema: z.object({ 轮次: z.number() }),
      预期结果描述: '当前轮次',
      回调: async (): Promise<void> => {},
      openai客户端: new OpenAI({ apiKey: 'test' }),
      模型名称: 'mock-model',
      是否自动召回: false,
    }
  }

  it('透传到模型请求, 位置在用户命令之后, 且不进入历史和返回内容', async (): Promise<void> => {
    实例 = 夹具.新建智能体({ 向量模型: { 类型: '无' } })

    let 结果 = await 实例.对话({ ...选项('第一回合'), 本轮临时消息: ['台词一', '台词二'] })
    await 实例.对话(选项('第二回合'))

    let 临时参数 = 流式请求AI模拟.mock.calls[0]?.[15] as 临时消息参数
    let 第一回合消息 = 消息快照[0] ?? []
    let 命令位置 = 第一回合消息.findIndex((消息) => 消息.content === '第一回合')
    expect(临时参数?.内容列表).toEqual(['台词一', '台词二'])
    expect(临时参数?.插入位置).toBe(命令位置 + 1)
    expect(JSON.stringify(结果.消息列表)).not.toContain('台词')
    expect(JSON.stringify(结果.新增上下文)).not.toContain('台词')
    expect(JSON.stringify(消息快照[1])).not.toContain('台词')
    expect(流式请求AI模拟.mock.calls[1]?.[15]).toBeUndefined()
  })
})
