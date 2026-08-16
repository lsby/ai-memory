import OpenAI from 'openai'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { 智能体事件, 智能体消息类型, 解决问题选项 } from '../src/agent/types'
import { 运行结果验证器 } from '../src/agent/validator'

describe('结果验证器', () => {
  let 创建选项 = (
    结果验证器: 解决问题选项<z.ZodObject<{ 答案: z.ZodNumber }>>['结果验证器'],
  ): 解决问题选项<z.ZodObject<{ 答案: z.ZodNumber }>> => ({
    命令: '返回答案',
    预期结果Schema: z.object({ 答案: z.number() }),
    预期结果描述: '包含数字答案的对象',
    回调: async (): Promise<void> => {},
    openai客户端: new OpenAI({ apiKey: 'test' }),
    模型名称: 'mock-model',
    结果验证器,
  })

  it('未配置后置验证器时不改变消息或重试次数', async (): Promise<void> => {
    let 消息列表: 智能体消息类型[] = [{ role: 'user', content: '返回答案' }]
    let 事件列表: 智能体事件[] = []
    let 结果 = await 运行结果验证器({ 答案: 42 }, 创建选项(undefined), 消息列表, 0, 1, async (事件): Promise<void> => {
      事件列表.push(事件)
    })

    expect(结果).toBeNull()
    expect(消息列表).toEqual([{ role: 'user', content: '返回答案' }])
    expect(事件列表).toEqual([])
  })

  it('后置验证失败时通知回调、增加重试次数并追加纠正消息', async (): Promise<void> => {
    let 消息列表: 智能体消息类型[] = [{ role: 'user', content: '返回答案' }]
    let 事件列表: 智能体事件[] = []
    let 结果 = await 运行结果验证器(
      { 答案: 42 },
      创建选项(async (): Promise<{ 通过: false; 错误信息: string }> => ({ 通过: false, 错误信息: '答案需要是偶数' })),
      消息列表,
      0,
      1,
      async (事件): Promise<void> => {
        事件列表.push(事件)
      },
    )

    expect(结果).toEqual({ 新校验失败次数: 1 })
    expect(事件列表).toEqual([{ 类型: '校验失败', 错误信息: '答案需要是偶数', 当前次数: 1, 最大次数: 1 }])
    expect(消息列表).toHaveLength(2)
    expect(消息列表[1]).toMatchObject({ role: 'user', isSystemCorrection: true })
  })

  it('超过后置验证最大重试次数时抛出最后一次错误', async (): Promise<void> => {
    let 消息列表: 智能体消息类型[] = []
    let 选项 = 创建选项(async (): Promise<{ 通过: false; 错误信息: string }> => ({
      通过: false,
      错误信息: '仍然不符合要求',
    }))

    await expect(运行结果验证器({ 答案: 42 }, 选项, 消息列表, 1, 1, async (): Promise<void> => {})).rejects.toThrow(
      '仍然不符合要求',
    )
    expect(消息列表).toEqual([])
  })
})
