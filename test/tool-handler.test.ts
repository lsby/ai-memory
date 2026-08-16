import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { 提交结果函数名 } from '../src/agent/constants'
import { 处理工具调用 } from '../src/agent/tool-handler'
import { 智能体工具, type 智能体事件, type 智能体消息类型 } from '../src/index'

describe('工具调用处理器', () => {
  it('将未知工具转换为工具错误消息并继续循环', async (): Promise<void> => {
    let 消息列表: 智能体消息类型[] = []
    let 事件列表: 智能体事件[] = []
    let 处理结果 = await 处理工具调用(
      [{ id: 'unknown_call', 名称: 'unknown_tool', 参数片段: '{}' }],
      消息列表,
      '',
      z.object({ 答案: z.number() }),
      async (事件): Promise<void> => {
        事件列表.push(事件)
      },
      [],
    )

    expect(处理结果).toEqual({ 类型: '继续循环' })
    expect(事件列表.some((事件) => 事件.类型 === '工具调用失败')).toBe(true)
    expect(消息列表).toHaveLength(2)
    expect(消息列表[1]).toMatchObject({ role: 'tool', tool_call_id: 'unknown_call' })
  })

  it('截断过长的工具返回文本', async (): Promise<void> => {
    let 消息列表: 智能体消息类型[] = []
    let 工具 = 智能体工具.创建({
      名称: 'long_output',
      描述: '返回很长的文本',
      参数Schema: z.object({}),
      返回值Schema: z.object({ 结果: z.enum(['成功', '失败']), 内容: z.string() }),
      实现: async (): Promise<{ 结果: '成功'; 内容: string }> => ({ 结果: '成功', 内容: 'x'.repeat(100) }),
    })

    await 处理工具调用(
      [{ id: 'long_call', 名称: 'long_output', 参数片段: '{}' }],
      消息列表,
      '',
      z.object({ 答案: z.number() }),
      async (): Promise<void> => {},
      [工具],
      true,
      undefined,
      50,
    )

    let 工具消息 = 消息列表[1]
    expect(工具消息).toMatchObject({ role: 'tool', tool_call_id: 'long_call' })
    if (工具消息 !== undefined && 工具消息.role === 'tool') {
      expect(工具消息.content).toContain('因长度限制被截断')
      expect(工具消息.content.length).toBeLessThan(100)
    }
  })

  it('接受符合预期 Schema 的原生最终结果调用', async (): Promise<void> => {
    let 消息列表: 智能体消息类型[] = []
    let 处理结果 = await 处理工具调用(
      [{ id: 'submit_call', 名称: 提交结果函数名, 参数片段: '{"答案": 7}' }],
      消息列表,
      '',
      z.object({ 答案: z.number() }),
      async (): Promise<void> => {},
      [],
    )

    expect(处理结果).toEqual({ 类型: '最终结果', 数据: { 答案: 7 } })
    expect(消息列表).toHaveLength(2)
    expect(消息列表[1]).toMatchObject({ role: 'tool', tool_call_id: 'submit_call' })
  })
})
