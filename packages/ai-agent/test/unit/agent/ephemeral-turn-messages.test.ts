import { 智能体, 智能体工具 } from '@lsby/ai-agent'
import OpenAI from 'openai'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

type 流块 = {
  choices: [
    {
      delta: {
        content?: string
        tool_calls?: Array<{ index: number; id: string; function: { name: string; arguments: string } }>
      }
    },
  ]
}

async function* 文本流(内容: string): AsyncGenerator<流块> {
  yield { choices: [{ delta: { content: 内容 } }] }
}

async function* 工具调用流(): AsyncGenerator<流块> {
  yield {
    choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_echo', function: { name: 'echo', arguments: '{}' } }] } }],
  }
}

let 结果Schema = z.object({ 答案: z.number() })

function 创建客户端(流列表: Array<() => AsyncGenerator<流块>>): {
  客户端: OpenAI
  请求消息列表: () => Array<Array<{ role: string; content: unknown }>>
} {
  let 客户端 = new OpenAI({ apiKey: 'test' })
  let 序号 = 0
  let 模拟 = vi.spyOn(客户端.chat.completions, 'create').mockImplementation(() => {
    let 生成 = 流列表[序号]
    序号++
    if (生成 === undefined) throw new Error('没有更多模拟响应')
    return 生成() as never
  })
  return {
    客户端,
    请求消息列表: (): Array<Array<{ role: string; content: unknown }>> =>
      模拟.mock.calls.map(
        (调用) => JSON.parse(JSON.stringify(调用[0].messages)) as Array<{ role: string; content: unknown }>,
      ),
  }
}

function 公共选项(客户端: OpenAI, 命令: string): Parameters<智能体['对话']>[0] {
  return {
    命令,
    预期结果Schema: 结果Schema,
    预期结果描述: '答案',
    回调: async (): Promise<void> => {},
    openai客户端: 客户端,
    模型名称: 'mock-model',
  }
}

let 回显工具 = 智能体工具.创建({
  名称: 'echo',
  描述: '回显',
  参数Schema: z.object({}),
  返回值Schema: z.object({ 结果: z.enum(['成功', '失败']) }),
  实现: async (): Promise<{ 结果: '成功' }> => ({ 结果: '成功' }),
})

describe('本轮临时消息', () => {
  it('放在用户命令之后发给模型, 且不进入返回的消息列表和新增上下文', async (): Promise<void> => {
    let { 客户端, 请求消息列表 } = 创建客户端([(): AsyncGenerator<流块> => 文本流('{"答案": 1}')])
    let 结果 = await new 智能体({}).对话({ ...公共选项(客户端, '命令A'), 本轮临时消息: ['临时一', '临时二'] })

    let 请求 = 请求消息列表()[0] ?? []
    let 命令位置 = 请求.findIndex((消息) => 消息.content === '命令A')
    expect(命令位置).toBeGreaterThan(-1)
    expect(请求[命令位置 + 1]).toMatchObject({ role: 'user', content: '临时一' })
    expect(请求[命令位置 + 2]).toMatchObject({ role: 'user', content: '临时二' })
    expect(JSON.stringify(结果.消息列表)).not.toContain('临时')
    expect(JSON.stringify(结果.新增上下文)).not.toContain('临时')
  })

  it('工具调用多轮时每次请求都带着, 位置不变', async (): Promise<void> => {
    let { 客户端, 请求消息列表 } = 创建客户端([
      (): AsyncGenerator<流块> => 工具调用流(),
      (): AsyncGenerator<流块> => 文本流('{"答案": 2}'),
    ])
    let 结果 = await new 智能体({ 工具列表: [回显工具] }).对话({
      ...公共选项(客户端, '命令B'),
      本轮临时消息: ['临时X'],
    })

    let 请求列表 = 请求消息列表()
    expect(请求列表).toHaveLength(2)
    for (let 请求 of 请求列表) {
      let 命令位置 = 请求.findIndex((消息) => 消息.content === '命令B')
      expect(请求[命令位置 + 1]).toMatchObject({ role: 'user', content: '临时X' })
    }
    expect((请求列表[1] ?? []).length).toBeGreaterThan((请求列表[0] ?? []).length)
    expect(JSON.stringify(结果.消息列表)).not.toContain('临时X')
  })

  it('下一回合不传就没有, 历史里也没有上一回合的临时消息', async (): Promise<void> => {
    let { 客户端, 请求消息列表 } = 创建客户端([
      (): AsyncGenerator<流块> => 文本流('{"答案": 1}'),
      (): AsyncGenerator<流块> => 文本流('{"答案": 2}'),
    ])
    let 实例 = new 智能体({})
    await 实例.对话({ ...公共选项(客户端, '第一回合'), 本轮临时消息: ['只此一回'] })
    await 实例.对话(公共选项(客户端, '第二回合'))

    let 请求列表 = 请求消息列表()
    expect(JSON.stringify(请求列表[0])).toContain('只此一回')
    expect(JSON.stringify(请求列表[1])).not.toContain('只此一回')
    expect(JSON.stringify(实例.读取对话历史())).not.toContain('只此一回')
  })

  it('命令为空时放在本轮最后一条注入之后', async (): Promise<void> => {
    let { 客户端, 请求消息列表 } = 创建客户端([(): AsyncGenerator<流块> => 文本流('{"答案": 1}')])
    await new 智能体({}).对话({
      ...公共选项(客户端, ''),
      追加注入消息: [{ 类型: '通知', 内容: '系统通知内容' }],
      本轮临时消息: ['临时Y'],
    })

    let 请求 = 请求消息列表()[0] ?? []
    let 注入位置 = 请求.findIndex((消息) => 消息.content === '系统通知内容')
    expect(注入位置).toBeGreaterThan(-1)
    expect(请求[注入位置 + 1]).toMatchObject({ role: 'user', content: '临时Y' })
    expect(请求).toHaveLength(注入位置 + 2)
  })

  it('不传或传空数组时请求内容和原来完全一致', async (): Promise<void> => {
    let 甲 = 创建客户端([(): AsyncGenerator<流块> => 文本流('{"答案": 1}')])
    await new 智能体({}).对话(公共选项(甲.客户端, '同一命令'))
    let 乙 = 创建客户端([(): AsyncGenerator<流块> => 文本流('{"答案": 1}')])
    await new 智能体({}).对话({ ...公共选项(乙.客户端, '同一命令'), 本轮临时消息: [] })

    expect(乙.请求消息列表()).toEqual(甲.请求消息列表())
  })

  it('无状态单回合执行也只在请求里带临时消息, 不影响前缀判断', async (): Promise<void> => {
    let 第一次 = 创建客户端([(): AsyncGenerator<流块> => 文本流('{"答案": 1}')])
    let 实例 = new 智能体({})
    let 首回合 = await 实例.执行回合({ ...公共选项(第一次.客户端, '首回合'), 消息历史: [] })
    let 第二次 = 创建客户端([(): AsyncGenerator<流块> => 文本流('{"答案": 2}')])
    let 次回合 = await 实例.执行回合({
      ...公共选项(第二次.客户端, '次回合'),
      消息历史: 首回合.消息列表,
      本轮临时消息: ['不进历史'],
    })

    expect(次回合.结果).toEqual({ 答案: 2 })
    expect(次回合.结束原因).toBeUndefined()
    expect(JSON.stringify(次回合.消息列表)).not.toContain('不进历史')
    expect(JSON.stringify(第二次.请求消息列表()[0])).toContain('不进历史')
  })
})
