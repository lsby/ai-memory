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

  it('拒绝重复工具名称和内置结果提交保留名称', (): void => {
    let 创建工具 = (名称: string): 智能体工具 =>
      智能体工具.创建({
        名称,
        描述: '测试工具',
        参数Schema: z.object({}),
        返回值Schema: z.object({ 结果: z.enum(['成功', '失败']) }),
        实现: async (): Promise<{ 结果: '成功' }> => ({ 结果: '成功' }),
      })

    expect(() => new 智能体({ 工具列表: [创建工具('duplicate'), 创建工具('duplicate')] })).toThrow('工具名称重复')
    expect(() => new 智能体({ 工具列表: [创建工具('__submit_result__')] })).toThrow('保留名称')
  })

  it('拒绝不能映射为结果提交参数的非对象 Schema', async (): Promise<void> => {
    let 智能体实例 = new 智能体({})
    await expect(
      智能体实例.对话({
        命令: '返回文本',
        预期结果Schema: z.string(),
        预期结果描述: '文本',
        回调: async (): Promise<void> => {},
        openai客户端: new OpenAI({ apiKey: 'test' }),
        模型名称: 'mock-model',
      }),
    ).rejects.toThrow('根节点必须是对象')
    expect(流式请求AI模拟).not.toHaveBeenCalled()
  })

  it('工具提示明确声明多个调用会按顺序而非并发执行', (): void => {
    let 工具 = 智能体工具.创建({
      名称: 'ordered_tool',
      描述: '顺序工具',
      参数Schema: z.object({}),
      返回值Schema: z.object({ 结果: z.enum(['成功', '失败']) }),
      实现: async (): Promise<{ 结果: '成功' }> => ({ 结果: '成功' }),
    })
    let 智能体实例 = new 智能体({ 工具列表: [工具] })
    let 提示词 = 智能体实例.组装系统提示词({
      命令: '',
      预期结果Schema: z.object({ 完成: z.boolean() }),
      预期结果描述: '完成状态',
      回调: async (): Promise<void> => {},
      openai客户端: new OpenAI({ apiKey: 'test' }),
      模型名称: 'mock-model',
    })

    expect(提示词).toContain('按返回顺序依次执行')
    expect(提示词).not.toContain('并发执行以极大提高效率')
  })

  it('轮次间延迟结束后移除中断监听器', async (): Promise<void> => {
    流式请求AI模拟
      .mockResolvedValueOnce({
        完整文本: '',
        工具调用列表: [{ id: 'noop_call', 名称: 'noop', 参数片段: '{}' }],
        已中断: false,
      })
      .mockResolvedValueOnce({ 完整文本: '{"答案":1}', 工具调用列表: [], 已中断: false })
    let 工具 = 智能体工具.创建({
      名称: 'noop',
      描述: '空操作',
      参数Schema: z.object({}),
      返回值Schema: z.object({ 结果: z.enum(['成功', '失败']) }),
      实现: async (): Promise<{ 结果: '成功' }> => ({ 结果: '成功' }),
    })
    let 中断控制器 = new AbortController()
    let 添加监听模拟 = vi.spyOn(中断控制器.signal, 'addEventListener')
    let 移除监听模拟 = vi.spyOn(中断控制器.signal, 'removeEventListener')
    let 智能体实例 = new 智能体({ 工具列表: [工具], 请求AI时间间隔ms: 1 })

    await 智能体实例.对话({
      命令: '执行两轮',
      预期结果Schema: z.object({ 答案: z.number() }),
      预期结果描述: '答案',
      回调: async (): Promise<void> => {},
      openai客户端: new OpenAI({ apiKey: 'test' }),
      模型名称: 'mock-model',
      中断信号: 中断控制器.signal,
    })

    expect(添加监听模拟).toHaveBeenCalledWith('abort', expect.any(Function), { once: true })
    expect(移除监听模拟).toHaveBeenCalledWith('abort', 添加监听模拟.mock.calls[0]?.[1])
  })
})
