import OpenAI from 'openai'
import { describe, expect, it, vi } from 'vitest'
import { 流式请求AI } from '../src/agent/stream-request'
import type { 智能体消息类型 } from '../src/index'

async function* 创建空流(): AsyncGenerator<{ choices: [] }> {
  yield { choices: [] }
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
})
