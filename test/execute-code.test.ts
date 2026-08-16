import OpenAI from 'openai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { 带记忆的智能体 } from '../src/index'

let 流式请求AI模拟 = vi.hoisted(() => vi.fn())

vi.mock('../src/agent/stream-request', () => ({ 流式请求AI: 流式请求AI模拟 }))

describe('带记忆的智能体的代码执行能力', () => {
  let 智能体实例: 带记忆的智能体 | undefined

  beforeEach((): void => {
    流式请求AI模拟.mockReset()
  })

  afterEach(async (): Promise<void> => {
    if (智能体实例 !== undefined) {
      await 智能体实例.销毁()
      智能体实例 = undefined
    }
  })

  async function 通过公开接口执行代码(代码: string): Promise<string> {
    智能体实例 = new 带记忆的智能体({ 向量模型: { 类型: '无' } })
    流式请求AI模拟
      .mockResolvedValueOnce({
        完整文本: '',
        工具调用列表: [{ id: 'execute_code', 名称: 'execute_code', 参数片段: JSON.stringify({ 代码 }) }],
        已中断: false,
      })
      .mockResolvedValueOnce({ 完整文本: '{"完成":true}', 工具调用列表: [], 已中断: false })

    let 结果 = await 智能体实例.对话({
      命令: '执行代码',
      预期结果Schema: z.object({ 完成: z.boolean() }),
      预期结果描述: '执行是否完成',
      回调: async (): Promise<void> => {},
      openai客户端: new OpenAI({ apiKey: 'test' }),
      模型名称: 'mock-model',
      是否自动召回: false,
    })
    expect(结果.结果).toEqual({ 完成: true })
    let 工具消息 = 结果.消息列表.find((消息) => 消息.role === 'tool')
    if (工具消息 === undefined) throw new Error('未收到代码执行工具的返回消息')
    return 工具消息.content
  }

  it('通过公开智能体接口返回 console 输出和计算结果', async (): Promise<void> => {
    let 工具输出 = await 通过公开接口执行代码(`
console.log('开始计算', 6);
return { 答案: 6 * 7 };
      `)

    expect(工具输出).toContain('开始计算 6')
    expect(工具输出).toContain('42')
  })

  it('通过公开智能体接口将运行时异常转为失败结果', async (): Promise<void> => {
    let 工具输出 = await 通过公开接口执行代码("throw new Error('测试异常')")

    expect(工具输出).toContain('"结果": "失败"')
    expect(工具输出).toContain('测试异常')
  })

  it('通过公开智能体接口在异步代码永不结束时返回超时失败结果', async (): Promise<void> => {
    let 工具输出 = await 通过公开接口执行代码('await new Promise(() => {})')

    expect(工具输出).toContain('"结果": "失败"')
    expect(工具输出).toContain('代码执行超时')
  }, 10000)
})
