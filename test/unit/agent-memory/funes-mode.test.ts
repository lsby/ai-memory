import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { 英文模型语言包 } from '../../../src/agent/model-language'
import { 带记忆的智能体, 记忆等级 } from '../../../src/index'
import { 创建假客户端, 提交 } from '../../helpers/append-only-cache-helper'
import { 使用共享PGlite } from '../../helpers/shared-pglite-fixture'
import { 创建假向量客户端, 创建带向量的PGlite } from '../../helpers/shared-storage-helper'

let 夹具 = 使用共享PGlite()
let 实例列表: 带记忆的智能体[] = []

function 新建(搜索数量: number = 20): 带记忆的智能体 {
  let 实例 = 夹具.新建智能体({
    向量模型: { 类型: '在线', openai客户端: 创建假向量客户端({}), 模型名称: 'fake' },
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
  it('只为模式开启后新写入的消息生成可选向量，不回填已有消息', async (): Promise<void> => {
    let pglite = 创建带向量的PGlite()
    let schema = 夹具.分配schema()
    let 普通实例 = new 带记忆的智能体({
      向量模型: { 类型: '无' },
      存储: { 模式: '外部', pglite, schema },
    })
    let 博闻强记实例: 带记忆的智能体 | undefined
    try {
      let 会话 = await 普通实例.创建会话({ 标题: '向量边界' })
      let 旧消息 = await 普通实例.追加会话消息({
        会话id: 会话.id,
        预期父消息id: null,
        消息: { role: 'user', content: '开启模式以前的消息' },
      })
      expect(旧消息).toMatchObject({ 向量: null, 向量维度: null })
      await 普通实例.销毁()

      博闻强记实例 = new 带记忆的智能体({
        向量模型: { 类型: '在线', openai客户端: 创建假向量客户端({}), 模型名称: 'fake' },
        博闻强记模式: true,
        博闻强记消息搜索数量: 20,
        存储: { 模式: '外部', pglite, schema },
      })
      let 新消息 = await 博闻强记实例.追加会话消息({
        会话id: 会话.id,
        预期父消息id: 旧消息.id,
        消息: { role: 'assistant', content: '开启模式以后的消息' },
      })
      expect(新消息.向量).not.toBeNull()
      expect(新消息.向量维度).toBe(4)
      expect(await 博闻强记实例.读取会话消息(会话.id)).toMatchObject([
        { id: 旧消息.id, 向量: null, 向量维度: null },
        { id: 新消息.id, 向量维度: 4 },
      ])
    } finally {
      await 普通实例.销毁()
      if (博闻强记实例 !== undefined) await 博闻强记实例.销毁()
      await pglite.close()
    }
  })

  it('正常模式不泄露搜索工具、上游 ID、模式提示或记忆来源字段', async (): Promise<void> => {
    let 实例 = 夹具.新建智能体({
      向量模型: { 类型: '在线', openai客户端: 创建假向量客户端({}), 模型名称: 'fake' },
    })
    实例列表.push(实例)
    await 实例.添加记忆({
      内容: 'normal alpha',
      线索: ['normal'],
      评分: 80,
      等级: 记忆等级.二级,
      创建时间: new Date(),
    })
    let 首轮 = 创建假客户端([提交(1)])
    await 实例.对话(对话选项(首轮, '普通会话'))
    let 上游会话 = await 实例.读取当前会话()
    if (上游会话.当前消息id === null) throw new Error('上游会话没有 HEAD')
    await 实例.创建派生会话({
      前驱消息id: 上游会话.当前消息id,
      摘要: '普通摘要',
    })
    let 假 = 创建假客户端([
      {
        工具调用: [
          {
            id: 'normal-extend',
            名称: 'extend_memory',
            参数: { 内容: ['normal'] },
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
      直接联想到的记忆?: unknown[]
    }
    let 记忆列表 = z.array(z.record(z.unknown())).parse(工具结果.直接联想到的记忆 ?? [])
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
        工具调用: [
          {
            id: 'search-current',
            名称: 'search_conversation_messages',
            参数: { 查询内容: 'current-needle', 上下文消息数: 0 },
          },
        ],
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
        工具调用: [
          {
            id: 'search-unrelated',
            名称: 'search_conversation_messages',
            参数: { 查询内容: 'secret-needle', 过滤内容: { 内容过滤正则表达式: 'secret-needle' } },
          },
        ],
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
            参数: { 查询内容: '读取锚点上下文', 过滤内容: { 消息id: 锚点.id }, 上下文消息数: 2 },
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
      前驱消息id: 上游会话.当前消息id,
      摘要: '只是摘要',
    })
    let 派生轮 = 创建假客户端([提交(2)])
    await 实例.对话(对话选项(派生轮, '继续'))
    let 文本 = 派生轮.请求列表[0]?.messages.map((消息) => 消息['content']).filter((内容) => typeof 内容 === 'string')
    expect(文本).toContain(`[博闻强记] 当前会话由上游会话 ${上游会话.id} 压缩而来。`)
  })

  it('extend_memory 返回直接联想到的记忆且不混入聊天记录搜索结果', async (): Promise<void> => {
    let 实例 = 新建()
    let 假 = 创建假客户端([
      {
        工具调用: [
          {
            id: 'add-memory',
            名称: 'add_level_2_memory',
            参数: { 内容: 'alpha 是稳定事实', 线索: ['alpha'], 评分: 80, 消息: '记住 alpha 事实' },
          },
        ],
      },
      {
        工具调用: [
          {
            id: 'extend-memory',
            名称: 'extend_memory',
            参数: { 内容: ['alpha'] },
          },
        ],
      },
      提交(1),
    ])
    await 实例.对话(对话选项(假, '请记住 alpha'))
    let 工具结果 = z
      .object({ 结果: z.literal('成功'), 直接联想到的记忆: z.array(z.object({ 内容: z.string() })) })
      .parse(JSON.parse(读取工具消息(假.请求列表[2], 'extend-memory')))
    expect(工具结果.直接联想到的记忆).toMatchObject([{ 内容: 'alpha 是稳定事实' }])
  })

  it('英文模型语言包下消息搜索工具暴露英文字段并支持英文参数及 null 容错', async (): Promise<void> => {
    let 实例 = 夹具.新建智能体({
      向量模型: { 类型: '在线', openai客户端: 创建假向量客户端({}), 模型名称: 'fake' },
      博闻强记模式: true,
      博闻强记消息搜索数量: 20,
      模型语言包: 英文模型语言包,
    })
    实例列表.push(实例)
    let 假 = 创建假客户端([
      {
        工具调用: [
          {
            id: 'search-english',
            名称: 'search_conversation_messages',
            参数: { query: 'needle', filters: null, context_count: 0 },
          },
        ],
      },
      提交(1),
    ])
    await 实例.对话(对话选项(假, 'say needle'))
    let 首次请求 = 假.请求列表[0]
    let 工具列表 = 首次请求?.tools as Array<{ function?: { name?: string } }> | undefined
    let 工具定义 = 工具列表?.find((t) => t.function?.name === 'search_conversation_messages')
    expect(JSON.stringify(工具定义)).toContain('query')
    expect(JSON.stringify(工具定义)).toContain('context_count')
    expect(JSON.stringify(工具定义)).not.toMatch(/[\u3400-\u9fff]/u)

    let 工具结果 = JSON.parse(读取工具消息(假.请求列表[1], 'search-english')) as {
      status?: string
      messages?: unknown[]
    }
    expect(工具结果.status).toBe('success')
    expect(工具结果.messages?.length).toBeGreaterThan(0)
  })

  it('英文模型语言包完整本地化回忆延伸的定义和嵌套结果', async (): Promise<void> => {
    let 实例 = 夹具.新建智能体({
      向量模型: { 类型: '在线', openai客户端: 创建假向量客户端({}), 模型名称: 'fake' },
      博闻强记模式: true,
      博闻强记消息搜索数量: 20,
      模型语言包: 英文模型语言包,
    })
    实例列表.push(实例)
    let 假 = 创建假客户端([
      {
        工具调用: [
          {
            id: 'add-english-memory',
            名称: 'add_level_2_memory',
            参数: {
              content: 'alpha is a stable fact',
              clues: ['alpha', 'verified'],
              score: 80,
              commit_message: 'Remember the stable alpha fact.',
            },
          },
        ],
      },
      {
        工具调用: [
          {
            id: 'extend-english-memory',
            名称: 'extend_memory',
            参数: { content: ['alpha'] },
          },
        ],
      },
      提交(1),
    ])
    await 实例.对话(对话选项(假, 'remember alpha'))
    let 工具列表 = 假.请求列表[0]?.tools as Array<{ function?: { name?: string } }> | undefined
    let 工具定义 = 工具列表?.find((工具) => 工具.function?.name === 'extend_memory')
    expect(JSON.stringify(工具定义)).not.toMatch(/[\u3400-\u9fff]/u)

    let 工具结果文本 = 读取工具消息(假.请求列表[2], 'extend-english-memory')
    expect(工具结果文本).not.toMatch(/[\u3400-\u9fff]/u)
    let 工具结果 = z
      .object({
        status: z.literal('success'),
        recalled_memories: z.array(
          z.object({
            level: z.literal('level_2'),
            content: z.literal('alpha is a stable fact'),
            clues: z.array(z.string()),
          }),
        ),
        flashing_clues: z.array(z.string()),
      })
      .parse(JSON.parse(工具结果文本))
    expect(工具结果.recalled_memories[0]?.clues).toEqual(['alpha', 'verified'])
  })
})
