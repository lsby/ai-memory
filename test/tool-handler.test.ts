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

  it('顺序执行普通工具并拒绝与最终结果混合提交', async (): Promise<void> => {
    let 执行顺序: string[] = []
    let 消息列表: 智能体消息类型[] = []
    let 工具 = 智能体工具.创建({
      名称: 'record',
      描述: '记录执行顺序',
      参数Schema: z.object({ 值: z.string() }),
      返回值Schema: z.object({ 结果: z.enum(['成功', '失败']) }),
      实现: async ({ 值 }): Promise<{ 结果: '成功' }> => {
        执行顺序.push(值)
        return { 结果: '成功' }
      },
    })

    let 处理结果 = await 处理工具调用(
      [
        { id: 'record_call', 名称: 'record', 参数片段: '{"值":"普通工具"}' },
        { id: 'submit_call', 名称: 提交结果函数名, 参数片段: '{"答案":7}' },
      ],
      消息列表,
      '',
      z.object({ 答案: z.number() }),
      async (): Promise<void> => {},
      [工具],
    )

    expect(处理结果).toEqual({ 类型: '继续循环' })
    expect(执行顺序).toEqual(['普通工具'])
    expect(消息列表.filter((消息) => 消息.role === 'tool')).toHaveLength(2)
    expect(JSON.stringify(消息列表)).toContain('请不要将')
  })

  it('为多个最终结果调用逐一补齐失败响应', async (): Promise<void> => {
    let 消息列表: 智能体消息类型[] = []
    let 处理结果 = await 处理工具调用(
      [
        { id: 'submit_1', 名称: 提交结果函数名, 参数片段: '{"答案":1}' },
        { id: 'submit_2', 名称: 提交结果函数名, 参数片段: '{"答案":2}' },
      ],
      消息列表,
      '',
      z.object({ 答案: z.number() }),
      async (): Promise<void> => {},
      [],
    )

    expect(处理结果).toEqual({ 类型: '继续循环' })
    expect(消息列表.filter((消息) => 消息.role === 'tool').map((消息) => 消息.tool_call_id)).toEqual([
      'submit_1',
      'submit_2',
    ])
  })

  it('把中断信号传给工具并阻止后续工具执行', async (): Promise<void> => {
    let 中断控制器 = new AbortController()
    let 第二工具已执行 = false
    let 第一工具 = 智能体工具.创建({
      名称: 'abort_now',
      描述: '触发中断',
      参数Schema: z.object({}),
      返回值Schema: z.object({ 结果: z.enum(['成功', '失败']) }),
      实现: async (_参数, 上下文): Promise<{ 结果: '成功' }> => {
        expect(上下文.中断信号).toBe(中断控制器.signal)
        中断控制器.abort()
        return { 结果: '成功' }
      },
    })
    let 第二工具 = 智能体工具.创建({
      名称: 'must_not_run',
      描述: '不应执行',
      参数Schema: z.object({}),
      返回值Schema: z.object({ 结果: z.enum(['成功', '失败']) }),
      实现: async (): Promise<{ 结果: '成功' }> => {
        第二工具已执行 = true
        return { 结果: '成功' }
      },
    })
    let 消息列表: 智能体消息类型[] = []

    await 处理工具调用(
      [
        { id: 'abort_call', 名称: 'abort_now', 参数片段: '{}' },
        { id: 'skipped_call', 名称: 'must_not_run', 参数片段: '{}' },
      ],
      消息列表,
      '',
      z.object({ 答案: z.number() }),
      async (): Promise<void> => {},
      [第一工具, 第二工具],
      false,
      undefined,
      undefined,
      中断控制器.signal,
    )

    expect(第二工具已执行).toBe(false)
    expect(JSON.stringify(消息列表)).toContain('操作已中断')
  })

  it('多个普通工具严格按模型返回顺序执行', async (): Promise<void> => {
    let 外部状态 = 0
    let 第一工具 = 智能体工具.创建({
      名称: 'write_state',
      描述: '写状态',
      参数Schema: z.object({}),
      返回值Schema: z.object({ 结果: z.enum(['成功', '失败']) }),
      实现: async (): Promise<{ 结果: '成功' }> => {
        await new Promise<void>((resolve) => setTimeout(resolve, 5))
        外部状态 = 42
        return { 结果: '成功' }
      },
    })
    let 第二工具 = 智能体工具.创建({
      名称: 'read_state',
      描述: '读状态',
      参数Schema: z.object({}),
      返回值Schema: z.object({ 结果: z.enum(['成功', '失败']), 值: z.number() }),
      实现: async (): Promise<{ 结果: '成功'; 值: number }> => ({ 结果: '成功', 值: 外部状态 }),
    })
    let 消息列表: 智能体消息类型[] = []

    await 处理工具调用(
      [
        { id: 'write_call', 名称: 'write_state', 参数片段: '{}' },
        { id: 'read_call', 名称: 'read_state', 参数片段: '{}' },
      ],
      消息列表,
      '',
      z.object({ 答案: z.number() }),
      async (): Promise<void> => {},
      [第一工具, 第二工具],
    )

    expect(消息列表[2]).toMatchObject({ role: 'tool', tool_call_id: 'read_call' })
    expect(JSON.stringify(消息列表[2])).toContain('42')
  })
})
