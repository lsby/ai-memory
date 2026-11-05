import * as 智能体API from '@lsby/ai-agent'
import { 智能体工具, 智能体消息Schema } from '@lsby/ai-agent'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

describe('@lsby/ai-agent 公共 API', () => {
  it('导出的消息 Schema 可以校验合法消息并拒绝非法 role', () => {
    let 合法消息 = 智能体消息Schema.safeParse({ role: 'user', content: '你好' })
    let 非法消息 = 智能体消息Schema.safeParse({ role: 'unknown', content: '你好' })

    expect(合法消息.success).toBe(true)
    expect(非法消息.success).toBe(false)
  })

  it('工具工厂保留名称、Schema 和异步实现', async () => {
    let 工具 = 智能体工具.创建({
      名称: 'add',
      描述: '计算两数之和',
      参数Schema: z.object({ a: z.number(), b: z.number() }),
      返回值Schema: z.object({ 结果: z.enum(['成功', '失败']), 值: z.number() }),
      实现: async ({ a, b }) => ({ 结果: '成功', 值: a + b }),
    })

    expect(工具.名称).toBe('add')
    expect(工具.参数Schema.parse({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 })
    await expect(工具.实现({ a: 1, b: 2 })).resolves.toEqual({ 结果: '成功', 值: 3 })
  })

  it('不导出任何记忆能力', () => {
    expect(智能体API).toHaveProperty('智能体')
    expect(智能体API).not.toHaveProperty('带记忆的智能体')
    expect(智能体API).not.toHaveProperty('记忆等级')
    expect(智能体API.中文模型语言包).not.toHaveProperty('默认记忆提示词')
  })
})
