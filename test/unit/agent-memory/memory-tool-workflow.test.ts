import OpenAI from 'openai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { 带记忆的智能体, 记忆等级 } from '../../../src/index'
import { 使用共享PGlite } from '../../helpers/shared-pglite-fixture'

let 流式请求AI模拟 = vi.hoisted(() => vi.fn())

vi.mock('../../../src/agent/core/stream-request', () => ({ 流式请求AI: 流式请求AI模拟 }))

describe('记忆工具工作流', () => {
  let 夹具 = 使用共享PGlite()
  let 智能体实例: 带记忆的智能体 | undefined

  beforeEach((): void => {
    流式请求AI模拟.mockReset()
  })

  afterEach(async (): Promise<void> => {
    if (智能体实例 !== undefined) {
      await 智能体实例.销毁()
      智能体实例 = undefined
    }
  })

  it('通过模型工具调用写入一级记忆', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体({ 向量模型: { 类型: '无' }, 二级记忆遗忘分数阈值: 0 })
    流式请求AI模拟
      .mockResolvedValueOnce({
        完整文本: '',
        工具调用列表: [
          {
            id: 'add_memory',
            名称: 'add_level_1_memory',
            参数片段: JSON.stringify({
              内容: '模型写入的记忆',
              关键词: ['模型', '写入'],
              标签: ['自动'],
              评分: 88,
              消息: '这条信息会影响后续回答，值得长期记忆',
            }),
          },
        ],
        已中断: false,
      })
      .mockResolvedValueOnce({ 完整文本: '{"完成":true}', 工具调用列表: [], 已中断: false })

    let 结果 = await 智能体实例.对话({
      命令: '保存一条记忆',
      预期结果Schema: z.object({ 完成: z.boolean() }),
      预期结果描述: '操作是否完成',
      回调: async (): Promise<void> => {},
      openai客户端: new OpenAI({ apiKey: 'test' }),
      模型名称: 'mock-model',
      是否自动召回: false,
    })

    let 记忆 = (await 智能体实例.查询记忆())[0]
    if (记忆 === undefined) throw new Error('模型未写入记忆')
    expect(结果.结果).toEqual({ 完成: true })
    expect(记忆).toMatchObject({
      内容: '模型写入的记忆',
      关键词: ['模型', '写入'],
      标签: ['自动'],
      等级: 记忆等级.一级,
      评分: 88,
    })
    expect((await 智能体实例.查询记忆提交())[0]?.提交说明).toBe('这条信息会影响后续回答，值得长期记忆')
  })

  it('模型写工具缺少提交消息时快速失败且不产生记忆提交', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体({ 向量模型: { 类型: '无' }, 二级记忆遗忘分数阈值: 0 })
    流式请求AI模拟
      .mockResolvedValueOnce({
        完整文本: '',
        工具调用列表: [
          {
            id: 'missing_message',
            名称: 'add_level_1_memory',
            参数片段: JSON.stringify({ 内容: '不应写入', 关键词: ['无消息'], 标签: [], 评分: 88 }),
          },
        ],
        已中断: false,
      })
      .mockResolvedValueOnce({ 完整文本: '{"完成":true}', 工具调用列表: [], 已中断: false })

    await 智能体实例.对话({
      命令: '尝试保存一条没有提交消息的记忆',
      预期结果Schema: z.object({ 完成: z.boolean() }),
      预期结果描述: '操作是否完成',
      回调: async (): Promise<void> => {},
      openai客户端: new OpenAI({ apiKey: 'test' }),
      模型名称: 'mock-model',
      是否自动召回: false,
    })

    expect(await 智能体实例.查询记忆()).toEqual([])
    expect(await 智能体实例.查询记忆提交()).toEqual([])
  })

  it('在一次模型响应中顺序更新关键词和标签', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体({ 向量模型: { 类型: '无' }, 二级记忆遗忘分数阈值: 0 })
    await 智能体实例.批量注入记忆([
      {
        内容: '待更新记忆',
        关键词: ['旧关键词'],
        标签: ['旧标签'],
        评分: 80,
        等级: 记忆等级.一级,
        创建时间: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])
    let 记忆 = (await 智能体实例.查询记忆())[0]
    if (记忆 === undefined) throw new Error('未找到待更新的记忆')
    let 基线提交id = await 智能体实例.查询当前记忆提交id()
    if (基线提交id === null) throw new Error('未找到待更新记忆的基线提交')

    流式请求AI模拟.mockResolvedValueOnce({ 完整文本: '{"完成":true}', 工具调用列表: [], 已中断: false })
    await 智能体实例.对话({
      命令: '建立会话基线',
      预期结果Schema: z.object({ 完成: z.boolean() }),
      预期结果描述: '操作是否完成',
      回调: async (): Promise<void> => {},
      openai客户端: new OpenAI({ apiKey: 'test' }),
      模型名称: 'mock-model',
      是否自动召回: false,
    })
    let 基线上下文消息id = (await 智能体实例.读取当前会话()).当前消息id
    if (基线上下文消息id === null) throw new Error('未找到工具调用前的上下文消息')

    流式请求AI模拟
      .mockResolvedValueOnce({
        完整文本: '',
        工具调用列表: [
          {
            id: 'append_keyword',
            名称: 'append_memory_keywords',
            参数片段: JSON.stringify({ id: 记忆.id, 关键词列表: ['新关键词'], 消息: '补充便于检索的新关键词' }),
          },
          {
            id: 'overwrite_tag',
            名称: 'overwrite_memory_tags',
            参数片段: JSON.stringify({ id: 记忆.id, 标签列表: ['新标签'], 消息: '重新归类这条记忆' }),
          },
        ],
        已中断: false,
      })
      .mockResolvedValueOnce({ 完整文本: '{"完成":true}', 工具调用列表: [], 已中断: false })

    await 智能体实例.对话({
      命令: '更新记忆元数据',
      预期结果Schema: z.object({ 完成: z.boolean() }),
      预期结果描述: '操作是否完成',
      回调: async (): Promise<void> => {},
      openai客户端: new OpenAI({ apiKey: 'test' }),
      模型名称: 'mock-model',
      是否自动召回: false,
    })

    let 已更新记忆 = await 智能体实例.查找记忆(记忆.id)
    expect(已更新记忆).toMatchObject({ 关键词: ['旧关键词', '新关键词'], 标签: ['新标签'] })
    let 当前会话 = await 智能体实例.读取当前会话()
    let 本轮用户消息 = (await 智能体实例.读取会话消息(当前会话.id)).find(
      (消息) => 消息.消息.role === 'user' && 消息.消息.content === '更新记忆元数据',
    )
    if (本轮用户消息 === undefined) throw new Error('未找到工具调用前持久化的本轮用户消息')
    expect(本轮用户消息.父消息id).toBe(基线上下文消息id)

    let 提交列表 = await 智能体实例.查询记忆提交()
    let 追加关键词提交 = 提交列表.find((提交) => 提交.提交说明 === '补充便于检索的新关键词')
    let 覆盖标签提交 = 提交列表.find((提交) => 提交.提交说明 === '重新归类这条记忆')
    if (追加关键词提交 === undefined || 覆盖标签提交 === undefined) throw new Error('未找到模型工具产生的记忆提交')
    let 工具日志 = (await 智能体实例.查询交互日志()).filter(
      (日志) => 日志.事件类型 === '工具调用开始' || 日志.事件类型 === '工具调用结果',
    )
    let 查询调用日志 = (调用id: string): typeof 工具日志 =>
      工具日志.filter(
        (日志) =>
          typeof 日志.事件内容 === 'object' &&
          日志.事件内容 !== null &&
          Array.isArray(日志.事件内容) === false &&
          日志.事件内容['id'] === 调用id,
      )
    expect(查询调用日志('append_keyword').map((日志) => 日志.当时记忆提交id)).toEqual([基线提交id, 追加关键词提交.id])
    expect(查询调用日志('overwrite_tag').map((日志) => 日志.当时记忆提交id)).toEqual([
      追加关键词提交.id,
      覆盖标签提交.id,
    ])
    expect(查询调用日志('append_keyword').map((日志) => 日志.上下文头消息id)).toEqual([
      本轮用户消息.id,
      本轮用户消息.id,
    ])
    expect(查询调用日志('overwrite_tag').map((日志) => 日志.上下文头消息id)).toEqual([本轮用户消息.id, 本轮用户消息.id])
  })
})
