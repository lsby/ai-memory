import type { 智能体事件, 智能体消息类型 } from '@lsby/ai-agent'
import OpenAI from 'openai'
import { describe, expect, it, vi } from 'vitest'
import { 工具调用引导前缀 } from '../../../src/constants'
import { 流式请求AI } from '../../../src/core/stream-request'

async function* 创建空流(): AsyncGenerator<{ choices: [] }> {
  yield { choices: [] }
}

async function* 创建文本流(内容: string): AsyncGenerator<{ choices: [{ delta: { content: string } }] }> {
  yield { choices: [{ delta: { content: 内容 } }] }
}

async function* 创建带用量的流(): AsyncGenerator<
  | { choices: [{ delta: { content: string } }]; usage?: undefined }
  | { choices: []; usage: { prompt_tokens: number; completion_tokens: number } }
> {
  yield { choices: [{ delta: { content: '完成' } }] }
  yield { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } }
}

type 工具调用块 = { index: number; id?: string; function?: { name?: string; arguments?: string } }

async function* 创建工具调用流(
  块列表: 工具调用块[],
): AsyncGenerator<{ choices: [{ delta: { tool_calls: 工具调用块[] } }] }> {
  for (let 块 of 块列表) {
    yield { choices: [{ delta: { tool_calls: [块] } }] }
  }
}

describe('模型请求序列化', () => {
  it('不会把会话内部治理字段发送给模型提供商', async (): Promise<void> => {
    let 客户端 = new OpenAI({ apiKey: 'test' })
    let 创建请求模拟 = vi.spyOn(客户端.chat.completions, 'create').mockReturnValue(创建空流() as never)
    let 消息列表: 智能体消息类型[] = [
      { role: 'system', content: '系统提示' },
      {
        role: 'user',
        content: '内部记忆状态',
        isSystemInjection: true,
        systemInjectionKind: 'memory-state',
        systemInjectionFingerprint: 'fingerprint',
      },
      { role: 'user', content: '纠正消息', isSystemCorrection: true },
    ]

    await 流式请求AI(客户端, 'mock-model', 消息列表, [], async (): Promise<void> => {}, undefined)

    let 请求配置 = 创建请求模拟.mock.calls[0]?.[0]
    if (请求配置 === undefined) throw new Error('模型请求未发出')
    let 序列化结果 = JSON.stringify(请求配置.messages)
    expect(序列化结果).toContain('内部记忆状态')
    expect(序列化结果).not.toContain('isSystemInjection')
    expect(序列化结果).not.toContain('isSystemCorrection')
    expect(序列化结果).not.toContain('systemInjectionKind')
    expect(序列化结果).not.toContain('systemInjectionFingerprint')
  })

  it('区分提供商原始返回与内核补全的引导前缀', async (): Promise<void> => {
    let 客户端 = new OpenAI({ apiKey: 'test' })
    let 创建请求模拟 = vi.spyOn(客户端.chat.completions, 'create').mockReturnValue(创建文本流('片段') as never)

    let 结果 = await 流式请求AI(
      客户端,
      'mock-model',
      [{ role: 'user', content: '请求' }],
      [],
      async (): Promise<void> => {},
      undefined,
      false,
      true,
    )

    let 请求配置 = 创建请求模拟.mock.calls[0]?.[0]
    if (请求配置 === undefined) throw new Error('模型请求未发出')
    expect(请求配置.messages.at(-1)).toEqual({ role: 'assistant', content: 工具调用引导前缀 })
    expect(结果.原始完整文本).toBe('片段')
    expect(结果.完整文本).toBe(`${工具调用引导前缀}片段`)
  })

  it('请求并读取流式响应末尾的实际 token 用量', async (): Promise<void> => {
    let 客户端 = new OpenAI({ apiKey: 'test' })
    let 创建请求模拟 = vi.spyOn(客户端.chat.completions, 'create').mockReturnValue(创建带用量的流() as never)

    let 结果 = await 流式请求AI(
      客户端,
      'mock-model',
      [{ role: 'user', content: '请求' }],
      [],
      async (): Promise<void> => {},
      undefined,
    )

    let 请求配置 = 创建请求模拟.mock.calls[0]?.[0]
    if (请求配置 === undefined) throw new Error('模型请求未发出')
    expect(请求配置.stream_options).toEqual({ include_usage: true })
    expect(结果).toMatchObject({ 完整文本: '完成', 输入token数: 12, 输出token数: 3 })
  })

  it('工具调用参数分多块到达时依次发出参数片段事件并带上已累积参数', async (): Promise<void> => {
    let 客户端 = new OpenAI({ apiKey: 'test' })
    vi.spyOn(客户端.chat.completions, 'create').mockReturnValue(
      创建工具调用流([
        { index: 0, id: 'call-1', function: { name: '__submit_result__', arguments: '' } },
        { index: 0, function: { arguments: '{"reply":' } },
        { index: 0, function: { arguments: '"你好' } },
        { index: 0, function: { arguments: '"}' } },
      ]) as never,
    )
    let 事件列表: 智能体事件[] = []

    let 结果 = await 流式请求AI(
      客户端,
      'mock-model',
      [{ role: 'user', content: '请求' }],
      [],
      async (事件): Promise<void> => {
        事件列表.push(事件)
      },
      undefined,
      true,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { id: 'req-1', 序号: 2, 前缀id: 'prefix-1' },
    )

    let 参数事件 = 事件列表.filter((事件) => 事件.类型 === '工具调用参数片段')
    expect(参数事件).toEqual(
      [
        ['{"reply":', '{"reply":'],
        ['"你好', '{"reply":"你好'],
        ['"}', '{"reply":"你好"}'],
      ].map(([片段, 已累积参数]) => ({
        类型: '工具调用参数片段',
        工具调用索引: 0,
        id: 'call-1',
        工具名称: '__submit_result__',
        片段,
        已累积参数,
        模型请求id: 'req-1',
        模型请求序号: 2,
        前缀id: 'prefix-1',
      })),
    )
    expect(结果.工具调用列表).toEqual([{ id: 'call-1', 名称: '__submit_result__', 参数片段: '{"reply":"你好"}' }])
  })

  it('并行工具调用按索引分开累积，空参数块不发事件', async (): Promise<void> => {
    let 客户端 = new OpenAI({ apiKey: 'test' })
    vi.spyOn(客户端.chat.completions, 'create').mockReturnValue(
      创建工具调用流([
        { index: 0, id: 'a', function: { name: '工具甲', arguments: '' } },
        { index: 1, id: 'b', function: { name: '工具乙', arguments: '{"x"' } },
        { index: 0, function: { arguments: '{"y":' } },
        { index: 1, function: { arguments: ':1}' } },
        { index: 0, function: { arguments: '2}' } },
      ]) as never,
    )
    let 事件列表: 智能体事件[] = []

    await 流式请求AI(
      客户端,
      'mock-model',
      [{ role: 'user', content: '请求' }],
      [],
      async (事件): Promise<void> => {
        事件列表.push(事件)
      },
      undefined,
    )

    let 摘要 = 事件列表.flatMap((事件) =>
      事件.类型 === '工具调用参数片段'
        ? [`${String(事件.工具调用索引)}|${事件.id}|${事件.工具名称}|${事件.已累积参数}`]
        : [],
    )
    expect(摘要).toEqual(['1|b|工具乙|{"x"', '0|a|工具甲|{"y":', '1|b|工具乙|{"x":1}', '0|a|工具甲|{"y":2}'])
  })

  it('参数片段回调抛错不影响流和最终结果', async (): Promise<void> => {
    let 客户端 = new OpenAI({ apiKey: 'test' })
    vi.spyOn(客户端.chat.completions, 'create').mockReturnValue(
      创建工具调用流([
        { index: 0, id: 'a', function: { name: '工具甲', arguments: '{"k":' } },
        { index: 0, function: { arguments: '1}' } },
      ]) as never,
    )
    let 错误输出 = vi.spyOn(console, 'error').mockImplementation((): void => {})
    let 调用次数 = 0

    let 结果 = await 流式请求AI(
      客户端,
      'mock-model',
      [{ role: 'user', content: '请求' }],
      [],
      async (事件): Promise<void> => {
        if (事件.类型 === '工具调用参数片段') {
          调用次数 += 1
          throw new Error('回调故障')
        }
      },
      undefined,
    )

    expect(调用次数).toBe(2)
    expect(结果.已中断).toBe(false)
    expect(结果.工具调用列表).toEqual([{ id: 'a', 名称: '工具甲', 参数片段: '{"k":1}' }])
    expect(错误输出).toHaveBeenCalled()
    错误输出.mockRestore()
  })
})
