import OpenAI from 'openai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { 带记忆的智能体, 智能体, 记忆等级 } from '../src/index'

let 流式请求AI模拟 = vi.hoisted(() => vi.fn())

vi.mock('../src/agent/stream-request', () => ({ 流式请求AI: 流式请求AI模拟 }))

type 请求消息 = { role: string; content?: string | null }

describe('实例级对话历史', () => {
  let 请求消息快照: 请求消息[][] = []
  let 带记忆实例: 带记忆的智能体 | undefined

  beforeEach((): void => {
    请求消息快照 = []
    流式请求AI模拟.mockReset()
    流式请求AI模拟.mockImplementation(
      async (_客户端, _模型, 消息列表): Promise<{ 完整文本: string; 工具调用列表: []; 已中断: false }> => {
        请求消息快照.push(JSON.parse(JSON.stringify(消息列表)) as 请求消息[])
        return { 完整文本: `{"轮次":${String(请求消息快照.length)}}`, 工具调用列表: [], 已中断: false }
      },
    )
  })

  afterEach(async (): Promise<void> => {
    if (带记忆实例 !== undefined) {
      await 带记忆实例.销毁()
      带记忆实例 = undefined
    }
  })

  function 创建选项(命令: string): {
    命令: string
    预期结果Schema: z.ZodObject<{ 轮次: z.ZodNumber }>
    预期结果描述: string
    回调: () => Promise<void>
    openai客户端: OpenAI
    模型名称: string
  } {
    return {
      命令,
      预期结果Schema: z.object({ 轮次: z.number() }),
      预期结果描述: '当前轮次',
      回调: async (): Promise<void> => {},
      openai客户端: new OpenAI({ apiKey: 'test' }),
      模型名称: 'mock-model',
    }
  }

  it('多轮对话只追加消息，使前一轮请求成为后一轮请求的稳定前缀', async (): Promise<void> => {
    let 智能体实例 = new 智能体({ 系统提示词: '固定系统提示词' })

    await 智能体实例.对话(创建选项('第一轮'))
    await 智能体实例.对话(创建选项('第二轮'))
    await 智能体实例.对话(创建选项('第三轮'))

    let 第一轮请求 = 请求消息快照[0]
    let 第二轮请求 = 请求消息快照[1]
    let 第三轮请求 = 请求消息快照[2]
    if (第一轮请求 === undefined || 第二轮请求 === undefined || 第三轮请求 === undefined) {
      throw new Error('缺少模型请求快照')
    }
    expect(第二轮请求.slice(0, 第一轮请求.length)).toEqual(第一轮请求)
    expect(第三轮请求.slice(0, 第二轮请求.length)).toEqual(第二轮请求)
  })

  it('推演读取对话环境但不会写入历史', async (): Promise<void> => {
    let 智能体实例 = new 智能体({ 系统提示词: '固定系统提示词' })

    await 智能体实例.对话(创建选项('正式对话'))
    await 智能体实例.推演(创建选项('临时推演'))
    await 智能体实例.对话(创建选项('继续正式对话'))

    let 第一轮请求 = 请求消息快照[0]
    let 推演请求 = 请求消息快照[1]
    let 第二轮对话请求 = 请求消息快照[2]
    if (第一轮请求 === undefined || 推演请求 === undefined || 第二轮对话请求 === undefined) {
      throw new Error('缺少模型请求快照')
    }
    expect(推演请求.slice(0, 第一轮请求.length)).toEqual(第一轮请求)
    expect(第二轮对话请求.slice(0, 第一轮请求.length)).toEqual(第一轮请求)
    expect(JSON.stringify(第二轮对话请求)).not.toContain('临时推演')
  })

  it('私有反思可使用记忆工具但不会写入对话历史', async (): Promise<void> => {
    带记忆实例 = new 带记忆的智能体({ 向量模型: { 类型: '无' } })

    await 带记忆实例.对话({ ...创建选项('建立正式会话'), 是否自动召回: false })
    await 带记忆实例.私有反思({ ...创建选项('整理刚才的线索'), 是否自动召回: false })
    await 带记忆实例.对话({ ...创建选项('继续正式会话'), 是否自动召回: false })

    let 私有反思请求 = 请求消息快照[1]
    let 后续对话请求 = 请求消息快照[2]
    let 私有反思工具列表 = 流式请求AI模拟.mock.calls[1]?.[3] as Array<{ function: { name: string } }> | undefined
    if (私有反思请求 === undefined || 后续对话请求 === undefined) {
      throw new Error('缺少模型请求快照')
    }
    expect(JSON.stringify(私有反思请求)).toContain('系统事件:私有反思')
    expect(私有反思工具列表?.map((工具) => 工具.function.name)).toContain('add_level_1_memory')
    expect(JSON.stringify(后续对话请求)).not.toContain('系统事件:私有反思')
  })

  it('会话反思会写入对话历史', async (): Promise<void> => {
    带记忆实例 = new 带记忆的智能体({ 向量模型: { 类型: '无' } })

    await 带记忆实例.对话({ ...创建选项('建立正式会话'), 是否自动召回: false })
    await 带记忆实例.会话反思({ ...创建选项('整理刚才的线索'), 是否自动召回: false })
    await 带记忆实例.对话({ ...创建选项('继续正式会话'), 是否自动召回: false })

    let 后续对话请求 = 请求消息快照[2]
    if (后续对话请求 === undefined) {
      throw new Error('缺少模型请求快照')
    }
    expect(JSON.stringify(后续对话请求)).toContain('系统事件:会话反思')
  })

  it('重置对话后以空历史开始新的可缓存前缀', async (): Promise<void> => {
    let 智能体实例 = new 智能体({ 系统提示词: '固定系统提示词' })

    await 智能体实例.对话(创建选项('旧对话'))
    智能体实例.重置对话()
    await 智能体实例.对话(创建选项('新对话'))

    let 新对话请求 = 请求消息快照[1]
    if (新对话请求 === undefined) throw new Error('缺少新对话请求快照')
    expect(JSON.stringify(新对话请求)).not.toContain('旧对话')
    expect(JSON.stringify(新对话请求)).toContain('新对话')
  })

  it('推演不向带记忆智能体暴露写记忆工具，也不会修改已有记忆', async (): Promise<void> => {
    带记忆实例 = new 带记忆的智能体({ 向量模型: { 类型: '无' } })
    await 带记忆实例.批量注入记忆([
      {
        内容: '原始记忆',
        关键词: ['原始'],
        标签: [],
        评分: 80,
        等级: 记忆等级.一级,
        创建时间: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])

    await 带记忆实例.对话({ ...创建选项('建立会话'), 是否自动召回: false })
    await 带记忆实例.推演({ ...创建选项('检查记忆'), 是否自动召回: false })

    let 推演工具列表 = 流式请求AI模拟.mock.calls[1]?.[3] as Array<{ function: { name: string } }> | undefined
    expect(推演工具列表?.map((工具) => 工具.function.name)).not.toContain('add_level_1_memory')
    expect(await 带记忆实例.查询记忆()).toHaveLength(1)
  })

  it('对话写入记忆后仍不重写已发送的系统前缀', async (): Promise<void> => {
    带记忆实例 = new 带记忆的智能体({ 向量模型: { 类型: '无' } })
    let 响应列表 = [
      {
        完整文本: '',
        工具调用列表: [
          {
            id: 'add_memory',
            名称: 'add_level_1_memory',
            参数片段: JSON.stringify({ 内容: '新写入的记忆', 关键词: ['新记忆'], 标签: [], 评分: 90 }),
          },
        ],
        已中断: false,
      },
      { 完整文本: '{"轮次":1}', 工具调用列表: [], 已中断: false },
      { 完整文本: '{"轮次":2}', 工具调用列表: [], 已中断: false },
    ]
    流式请求AI模拟.mockReset()
    流式请求AI模拟.mockImplementation(async (_客户端, _模型, 消息列表) => {
      请求消息快照.push(JSON.parse(JSON.stringify(消息列表)) as 请求消息[])
      let 响应 = 响应列表.shift()
      if (响应 === undefined) throw new Error('缺少模拟响应')
      return 响应
    })

    await 带记忆实例.对话({ ...创建选项('记住这条信息'), 是否自动召回: false })
    await 带记忆实例.对话({ ...创建选项('继续讨论'), 是否自动召回: false })

    let 首次请求 = 请求消息快照[0]
    let 写入后的下一轮请求 = 请求消息快照[2]
    if (首次请求 === undefined || 写入后的下一轮请求 === undefined) {
      throw new Error('缺少模型请求快照')
    }
    expect(写入后的下一轮请求.slice(0, 首次请求.length)).toEqual(首次请求)
    expect(写入后的下一轮请求[0]).toEqual(首次请求[0])
  })
})
