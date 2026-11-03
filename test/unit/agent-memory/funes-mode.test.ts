import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { 带记忆的智能体, 记忆等级 } from '../../../src/index'
import { 创建假客户端, 提交 } from '../../helpers/append-only-cache-helper'
import { 使用共享PGlite } from '../../helpers/shared-pglite-fixture'

let 夹具 = 使用共享PGlite()
let 实例列表: 带记忆的智能体[] = []

function 新建(搜索数量: number = 20): 带记忆的智能体 {
  let 实例 = 夹具.新建智能体({
    向量模型: { 类型: '无' },
    博闻强记模式: true,
    博闻强记消息搜索数量: 搜索数量,
  })
  实例列表.push(实例)
  return 实例
}

function 对话选项(假: ReturnType<typeof 创建假客户端>, 命令: string): Parameters<带记忆的智能体['对话']>[0] {
  return {
    命令,
    预期结果Schema: z.object({ 答案: z.number() }),
    预期结果描述: '数字答案',
    回调: async (): Promise<void> => {},
    openai客户端: 假.客户端,
    模型名称: 'mock-model',
    是否自动召回: false,
  }
}

function 读取工具消息(请求: { messages: Record<string, unknown>[] } | undefined, 调用id: string): string {
  let 消息 = 请求?.messages.find((项) => 项['tool_call_id'] === 调用id)
  let 内容 = 消息?.['content']
  if (typeof 内容 !== 'string') throw new Error(`缺少工具消息: ${调用id}`)
  return 内容
}

afterEach(async (): Promise<void> => {
  for (let 实例 of 实例列表) await 实例.销毁()
  实例列表 = []
})

describe('博闻强记模式', () => {
  it('正常模式不泄露搜索工具、上游 ID、模式提示或记忆来源字段', async (): Promise<void> => {
    let 实例 = 夹具.新建智能体({ 向量模型: { 类型: '无' } })
    实例列表.push(实例)
    await 实例.添加记忆({
      内容: 'normal alpha',
      关键词: ['normal'],
      标签: [],
      评分: 80,
      等级: 记忆等级.二级,
      创建时间: new Date(),
    })
    let 首轮 = 创建假客户端([提交(1)])
    await 实例.对话(对话选项(首轮, '普通会话'))
    let 上游会话 = await 实例.读取当前会话()
    if (上游会话.当前消息id === null) throw new Error('上游会话没有 HEAD')
    await 实例.创建派生会话({
      前驱会话id: 上游会话.id,
      前驱消息id: 上游会话.当前消息id,
      摘要: '普通摘要',
    })
    let 假 = 创建假客户端([
      {
        工具调用: [
          {
            id: 'normal-extend',
            名称: 'extend_memory',
            参数: {
              查询内容: 'normal',
              发散起点数: 1,
              直接返回数: 1,
              最大扩展跳数: 0,
              最小关联阈值: 0,
            },
          },
        ],
      },
      提交(2),
    ])
    await 实例.对话(对话选项(假, '查询 normal'))
    let 首次请求 = 假.请求列表[0]
    let 工具定义 = JSON.stringify(首次请求?.tools ?? [])
    let 消息文本 = JSON.stringify(首次请求?.messages ?? [])
    expect(工具定义).not.toContain('search_conversation_messages')
    expect(工具定义).not.toContain('read_conversation_history')
    expect(消息文本).not.toContain('博闻强记')
    expect(消息文本).not.toContain(上游会话.id)
    let 工具结果 = JSON.parse(读取工具消息(假.请求列表[1], 'normal-extend')) as {
      搜索结果_完整记忆?: string
    }
    let 记忆列表 = z.array(z.record(z.unknown())).parse(JSON.parse(工具结果.搜索结果_完整记忆 ?? '[]'))
    expect(记忆列表).toHaveLength(1)
    expect(记忆列表[0]).not.toHaveProperty('相关消息')
  })

  it('消息搜索只读当前谱系并且结果数受初始化配置限制', async (): Promise<void> => {
    let 实例 = 新建(1)
    let 无关客户端 = 创建假客户端([提交(1)])
    await 实例.对话(对话选项(无关客户端, '无关会话的 secret-needle'))
    await 实例.创建会话({ 标题: '当前会话' })

    let 假 = 创建假客户端([
      {
        工具调用: [{ id: 'search-current', 名称: 'search_conversation_messages', 参数: { text: 'current-needle' } }],
      },
      提交(2),
    ])
    await 实例.对话(对话选项(假, '当前会话有 current-needle，并且再写一次 current-needle'))
    let 当前搜索结果 = JSON.parse(读取工具消息(假.请求列表[1], 'search-current')) as {
      消息列表?: unknown[]
    }
    expect((当前搜索结果 as { messages?: unknown[] }).messages).toHaveLength(1)

    let 无关搜索 = 创建假客户端([
      {
        工具调用: [{ id: 'search-unrelated', 名称: 'search_conversation_messages', 参数: { text: 'secret-needle' } }],
      },
      提交(3),
    ])
    await 实例.对话(对话选项(无关搜索, '不要在命令中重复那个秘密词'))
    let 无关搜索结果 = JSON.parse(读取工具消息(无关搜索.请求列表[1], 'search-unrelated')) as {
      消息列表?: unknown[]
    }
    expect((无关搜索结果 as { messages?: unknown[] }).messages).toEqual([])
  })

  it('消息搜索可以返回命中消息前后指定数量的上下文', async (): Promise<void> => {
    let 实例 = 新建(1)
    await 实例.对话(对话选项(创建假客户端([提交(1)]), '第一轮'))
    await 实例.对话(对话选项(创建假客户端([提交(2)]), '第二轮'))
    let 当前会话 = await 实例.读取当前会话()
    if (当前会话.当前消息id === null) throw new Error('当前会话没有 HEAD')
    let 历史 = await 实例.读取消息历史(当前会话.当前消息id)
    if (历史.length < 5) throw new Error('测试会话不足五条消息')
    let 锚点 = 历史[2]
    if (锚点 === undefined) throw new Error('缺少上下文锚点')
    let 预期id列表 = 历史.slice(0, 5).map((消息) => 消息.id)
    let 搜索 = 创建假客户端([
      {
        工具调用: [
          {
            id: 'search-context',
            名称: 'search_conversation_messages',
            参数: { message_id: 锚点.id, context_count: 2 },
          },
        ],
      },
      提交(3),
    ])
    await 实例.对话(对话选项(搜索, '读取锚点上下文'))
    let 结果 = JSON.parse(读取工具消息(搜索.请求列表[1], 'search-context')) as {
      messages?: Array<{ message_id: string }>
    }
    expect(结果.messages?.map((消息) => 消息.message_id)).toEqual(预期id列表)
  })

  it('压缩派生会话只额外注入直接上游会话 ID', async (): Promise<void> => {
    let 实例 = 新建()
    let 首轮 = 创建假客户端([提交(1)])
    await 实例.对话(对话选项(首轮, '首轮'))
    let 上游会话 = await 实例.读取当前会话()
    if (上游会话.当前消息id === null) throw new Error('上游会话没有 HEAD')
    await 实例.创建派生会话({
      前驱会话id: 上游会话.id,
      前驱消息id: 上游会话.当前消息id,
      摘要: '只是摘要',
    })
    let 派生轮 = 创建假客户端([提交(2)])
    await 实例.对话(对话选项(派生轮, '继续'))
    let 文本 = 派生轮.请求列表[0]?.messages.map((消息) => 消息['content']).filter((内容) => typeof 内容 === 'string')
    expect(文本).toContain(`[博闻强记] 当前会话由上游会话 ${上游会话.id} 压缩而来。`)
  })

  it('extend_memory 的直接命中暂时只返回新增记忆的相关消息', async (): Promise<void> => {
    let 实例 = 新建()
    let 假 = 创建假客户端([
      {
        工具调用: [
          {
            id: 'add-memory',
            名称: 'add_level_2_memory',
            参数: { 内容: 'alpha 是稳定事实', 关键词: ['alpha'], 标签: [], 评分: 80, 消息: '记住 alpha 事实' },
          },
        ],
      },
      {
        工具调用: [
          {
            id: 'extend-memory',
            名称: 'extend_memory',
            参数: { 查询内容: 'alpha', 发散起点数: 1, 直接返回数: 1, 最大扩展跳数: 0, 最小关联阈值: 0 },
          },
        ],
      },
      提交(1),
    ])
    await 实例.对话(对话选项(假, '请记住 alpha'))
    let 工具结果 = JSON.parse(读取工具消息(假.请求列表[2], 'extend-memory')) as {
      搜索结果_完整记忆?: string
    }
    let 记忆列表 = z
      .array(
        z.object({
          相关消息: z.array(z.object({ 消息id: z.string(), 关系: z.literal('新增'), 记忆提交id: z.string() })),
        }),
      )
      .parse(JSON.parse(工具结果.搜索结果_完整记忆 ?? '[]'))
    expect(记忆列表[0]?.相关消息).toHaveLength(1)
  })
})
