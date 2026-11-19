import { type 智能体事件, 智能体, 智能体工具 } from '@lsby/ai-agent'
import OpenAI from 'openai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

let 流式请求AI模拟 = vi.hoisted(() => vi.fn())

vi.mock('../../../src/core/stream-request', () => ({ 流式请求AI: 流式请求AI模拟 }))

let 工具调用响应 = (名称: string, 参数: string = '{}'): object => ({
  完整文本: '',
  工具调用列表: [{ id: `call_${名称}`, 名称, 参数片段: 参数 }],
  已中断: false,
})

describe('超出最大轮次时的收尾请求', () => {
  let 查询执行次数 = 0
  let 查询工具 = 智能体工具.创建({
    名称: 'search',
    描述: '查询资料',
    参数Schema: z.object({}),
    返回值Schema: z.object({ 结果: z.enum(['成功', '失败']) }),
    实现: async (): Promise<{ 结果: '成功' }> => {
      查询执行次数++
      return { 结果: '成功' }
    },
  })

  beforeEach((): void => {
    流式请求AI模拟.mockReset()
    查询执行次数 = 0
  })

  let 运行 = async (
    选项: { 超轮次收尾?: boolean } = {},
  ): Promise<{ 结果: Awaited<ReturnType<智能体['对话']>>; 事件列表: 智能体事件[] }> => {
    let 事件列表: 智能体事件[] = []
    let 智能体实例 = new 智能体({ 工具列表: [查询工具], 最大循环轮次: 2, ...选项 })
    let 结果 = await 智能体实例.对话({
      命令: '回答问题',
      预期结果Schema: z.object({ 答案: z.number() }),
      预期结果描述: '答案',
      回调: async (事件): Promise<void> => {
        事件列表.push(事件)
      },
      openai客户端: new OpenAI({ apiKey: 'test' }),
      模型名称: 'mock-model',
    })
    return { 结果, 事件列表 }
  }

  it('正常轮次用完后收尾请求提交结果则正常返回', async (): Promise<void> => {
    流式请求AI模拟
      .mockResolvedValueOnce(工具调用响应('search'))
      .mockResolvedValueOnce(工具调用响应('search'))
      .mockResolvedValueOnce(工具调用响应('__submit_result__', '{"答案": 7}'))

    let { 结果, 事件列表 } = await 运行()

    expect(结果.结果).toEqual({ 答案: 7 })
    expect(结果.结束原因).toBeUndefined()
    expect(流式请求AI模拟).toHaveBeenCalledTimes(3)
    expect(查询执行次数).toBe(2)
    expect(结果.消息列表.some((消息) => 消息.role === 'user' && 消息.isSystemCorrection === true)).toBe(true)
    expect(事件列表.some((事件) => 事件.类型 === '流程信息' && 事件.内容.includes('收尾请求'))).toBe(true)
  })

  it('收尾请求里模型仍调用其他工具时不执行并以超出最大轮次结束', async (): Promise<void> => {
    流式请求AI模拟.mockResolvedValue(工具调用响应('search'))

    let { 结果 } = await 运行()

    expect(结果.结果).toBeNull()
    expect(结果.结束原因).toBe('超出最大轮次')
    expect(流式请求AI模拟).toHaveBeenCalledTimes(3)
    expect(查询执行次数).toBe(2)
  })

  it('收尾请求返回空内容时以超出最大轮次结束且只请求一次', async (): Promise<void> => {
    流式请求AI模拟
      .mockResolvedValueOnce(工具调用响应('search'))
      .mockResolvedValueOnce(工具调用响应('search'))
      .mockResolvedValue({ 完整文本: '', 工具调用列表: [], 已中断: false })

    let { 结果 } = await 运行()

    expect(结果.结束原因).toBe('超出最大轮次')
    expect(流式请求AI模拟).toHaveBeenCalledTimes(3)
  })

  it('超轮次收尾为 false 时保持旧行为不发收尾请求', async (): Promise<void> => {
    流式请求AI模拟.mockResolvedValue(工具调用响应('search'))

    let { 结果 } = await 运行({ 超轮次收尾: false })

    expect(结果.结果).toBeNull()
    expect(结果.结束原因).toBe('超出最大轮次')
    expect(流式请求AI模拟).toHaveBeenCalledTimes(2)
  })

  it('收尾请求带的工具列表和普通轮一致', async (): Promise<void> => {
    流式请求AI模拟
      .mockResolvedValueOnce(工具调用响应('search'))
      .mockResolvedValueOnce(工具调用响应('search'))
      .mockResolvedValueOnce(工具调用响应('__submit_result__', '{"答案": 1}'))

    await 运行()

    let 请求参数列表 = 流式请求AI模拟.mock.calls as unknown[][]
    let 普通轮工具列表 = 请求参数列表[0]?.[3]
    let 收尾轮工具列表 = 请求参数列表[2]?.[3]
    expect(Array.isArray(收尾轮工具列表)).toBe(true)
    expect(收尾轮工具列表).toEqual(普通轮工具列表)
  })
})
