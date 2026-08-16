import OpenAI from 'openai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { type 智能体事件, 智能体, 智能体工具 } from '../src/index'

let 流式请求AI模拟 = vi.hoisted(() => vi.fn())

vi.mock('../src/agent/stream-request', () => ({ 流式请求AI: 流式请求AI模拟 }))

describe('智能体', () => {
  beforeEach((): void => {
    流式请求AI模拟.mockReset()
  })

  it('执行工具调用后继续请求并返回结构化结果', async (): Promise<void> => {
    流式请求AI模拟
      .mockResolvedValueOnce({
        完整文本: '',
        工具调用列表: [{ id: 'call_add', 名称: 'add', 参数片段: '{"a": 2, "b": 3}' }],
        已中断: false,
      })
      .mockResolvedValueOnce({ 完整文本: '{"答案": 5}', 工具调用列表: [], 已中断: false })

    let 工具 = 智能体工具.创建({
      名称: 'add',
      描述: '计算两个数字之和',
      参数Schema: z.object({ a: z.number(), b: z.number() }),
      返回值Schema: z.object({ 结果: z.enum(['成功', '失败']), 值: z.number() }),
      实现: async ({ a, b }): Promise<{ 结果: '成功'; 值: number }> => ({ 结果: '成功', 值: a + b }),
    })
    let 事件列表: 智能体事件[] = []
    let 智能体实例 = new 智能体({ 工具列表: [工具] })
    let 结果 = await 智能体实例.对话({
      命令: '计算 2 加 3',
      预期结果Schema: z.object({ 答案: z.number() }),
      预期结果描述: '包含答案的对象',
      回调: async (事件): Promise<void> => {
        事件列表.push(事件)
      },
      openai客户端: new OpenAI({ apiKey: 'test' }),
      模型名称: 'mock-model',
    })

    expect(结果.结果).toEqual({ 答案: 5 })
    expect(流式请求AI模拟).toHaveBeenCalledTimes(2)
    expect(事件列表.some((事件) => 事件.类型 === '工具调用结果')).toBe(true)
    expect(结果.消息列表.some((消息) => 消息.role === 'tool' && 消息.content.includes('"值": 5'))).toBe(true)
  })

  it('在结构化文本不合法时请求模型修正', async (): Promise<void> => {
    流式请求AI模拟
      .mockResolvedValueOnce({ 完整文本: '{"答案": "错误类型"}', 工具调用列表: [], 已中断: false })
      .mockResolvedValueOnce({ 完整文本: '{"答案": 42}', 工具调用列表: [], 已中断: false })

    let 事件列表: 智能体事件[] = []
    let 智能体实例 = new 智能体({ 最大校验重试次数: 1 })
    let 结果 = await 智能体实例.对话({
      命令: '返回数字答案',
      预期结果Schema: z.object({ 答案: z.number() }),
      预期结果描述: '答案必须是数字',
      回调: async (事件): Promise<void> => {
        事件列表.push(事件)
      },
      openai客户端: new OpenAI({ apiKey: 'test' }),
      模型名称: 'mock-model',
    })

    expect(结果.结果).toEqual({ 答案: 42 })
    expect(流式请求AI模拟).toHaveBeenCalledTimes(2)
    expect(事件列表.some((事件) => 事件.类型 === '校验失败')).toBe(true)
  })

  it('在请求前已中断时不调用模型', async (): Promise<void> => {
    let 中断控制器 = new AbortController()
    中断控制器.abort()
    let 智能体实例 = new 智能体({})
    let 结果 = await 智能体实例.对话({
      命令: '不应发送请求',
      预期结果Schema: z.object({ 答案: z.number() }),
      预期结果描述: '答案',
      回调: async (): Promise<void> => {},
      openai客户端: new OpenAI({ apiKey: 'test' }),
      模型名称: 'mock-model',
      中断信号: 中断控制器.signal,
    })

    expect(结果.结果).toBeNull()
    expect(结果.结束原因).toBe('中断')
    expect(流式请求AI模拟).not.toHaveBeenCalled()
  })

  it('仅暴露对话与推演，不保留解决问题兼容方法', (): void => {
    expect(智能体.prototype).toHaveProperty('对话')
    expect(智能体.prototype).toHaveProperty('推演')
    expect(智能体.prototype).not.toHaveProperty('解决问题')
  })
})
