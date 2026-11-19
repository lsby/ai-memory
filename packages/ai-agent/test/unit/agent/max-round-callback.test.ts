import { type 智能体事件, type 超轮次回调参数, 智能体, 智能体工具 } from '@lsby/ai-agent'
import OpenAI from 'openai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

let 流式请求AI模拟 = vi.hoisted(() => vi.fn())

vi.mock('../../../src/core/stream-request', () => ({ 流式请求AI: 流式请求AI模拟 }))

let 结果Schema = z.object({ 答案: z.number() })
type 回调函数 = (参数: 超轮次回调参数) => Promise<Record<string, unknown> | null>

describe('超出最大轮次时的超轮次回调', () => {
  let 查询工具 = 智能体工具.创建({
    名称: 'search',
    描述: '查询资料',
    参数Schema: z.object({}),
    返回值Schema: z.object({ 结果: z.enum(['成功', '失败']) }),
    实现: async (): Promise<{ 结果: '成功' }> => ({ 结果: '成功' }),
  })

  beforeEach((): void => {
    流式请求AI模拟.mockReset()
    流式请求AI模拟.mockResolvedValue({
      完整文本: '',
      工具调用列表: [{ id: 'call_search', 名称: 'search', 参数片段: '{}' }],
      已中断: false,
    })
  })

  let 运行 = async (
    超轮次回调?: 回调函数,
  ): Promise<{ 结果: Awaited<ReturnType<智能体['对话']>>; 事件列表: 智能体事件[] }> => {
    let 事件列表: 智能体事件[] = []
    let 实例 = new 智能体({ 系统提示词: '固定系统提示词', 工具列表: [查询工具], 最大循环轮次: 2 })
    let 结果 = await 实例.对话({
      命令: '回答问题',
      预期结果Schema: 结果Schema,
      预期结果描述: '答案',
      回调: async (事件): Promise<void> => {
        事件列表.push(事件)
      },
      openai客户端: new OpenAI({ apiKey: 'test' }),
      模型名称: 'mock-model',
      ...(超轮次回调 !== undefined ? { 超轮次回调 } : {}),
    })
    return { 结果, 事件列表 }
  }

  it('不传回调时保持旧行为', async (): Promise<void> => {
    let { 结果 } = await 运行()
    expect(结果.结果).toBeNull()
    expect(结果.结束原因).toBe('超出最大轮次')
    expect(流式请求AI模拟).toHaveBeenCalledTimes(2)
  })

  it('回调返回合法结果时成功返回, 会话历史里有这次提交', async (): Promise<void> => {
    let { 结果, 事件列表 } = await 运行(async () => ({ 答案: 8 }))
    expect(结果.结果).toEqual({ 答案: 8 })
    expect(结果.结束原因).toBeUndefined()
    expect(流式请求AI模拟).toHaveBeenCalledTimes(2)
    expect(事件列表.some((事件) => 事件.类型 === '最终结果')).toBe(true)
    expect(
      事件列表.some((事件) => 事件.类型 === '工具调用开始' && 事件.id.startsWith('call_max_round_callback_')),
    ).toBe(true)
    let 最后消息 = 结果.消息列表[结果.消息列表.length - 1]
    expect(最后消息).toMatchObject({ role: 'assistant' })
    expect(JSON.stringify(最后消息)).toContain('答案')
  })

  it('回调拿到的消息列表是含系统提示词的副本', async (): Promise<void> => {
    let 拿到: 超轮次回调参数 | null = null
    let { 结果 } = await 运行(async (参数) => {
      拿到 = 参数
      参数.消息列表.length = 0
      return null
    })
    expect(拿到).not.toBeNull()
    expect((拿到 as unknown as 超轮次回调参数).最大循环轮次).toBe(2)
    expect(结果.消息列表[0]).toMatchObject({ role: 'system' })
    expect(JSON.stringify(结果.消息列表[0])).toContain('固定系统提示词')
    expect(结果.消息列表.length).toBeGreaterThan(1)
  })

  it('回调返回 null 时以超出最大轮次结束', async (): Promise<void> => {
    let { 结果 } = await 运行(async () => null)
    expect(结果.结果).toBeNull()
    expect(结果.结束原因).toBe('超出最大轮次')
  })

  it('回调返回不合法结果时以超出最大轮次结束', async (): Promise<void> => {
    let { 结果 } = await 运行(async () => ({ 答案: '不是数字' }))
    expect(结果.结果).toBeNull()
    expect(结果.结束原因).toBe('超出最大轮次')
  })

  it('回调抛错时以超出最大轮次结束而不是抛出', async (): Promise<void> => {
    let { 结果, 事件列表 } = await 运行(async () => {
      throw new Error('外部请求失败')
    })
    expect(结果.结果).toBeNull()
    expect(结果.结束原因).toBe('超出最大轮次')
    expect(事件列表.some((事件) => 事件.类型 === '流程信息' && 事件.内容.includes('外部请求失败'))).toBe(true)
  })
})
