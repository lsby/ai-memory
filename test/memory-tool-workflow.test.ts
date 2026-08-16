import OpenAI from 'openai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { 带记忆的智能体, 记忆等级 } from '../src/index'

let 流式请求AI模拟 = vi.hoisted(() => vi.fn())

vi.mock('../src/agent/stream-request', () => ({ 流式请求AI: 流式请求AI模拟 }))

describe('记忆工具工作流', () => {
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
    智能体实例 = new 带记忆的智能体({ 向量模型: { 类型: '无' }, 二级记忆遗忘分数阈值: 0 })
    流式请求AI模拟
      .mockResolvedValueOnce({
        完整文本: '',
        工具调用列表: [
          {
            id: 'add_memory',
            名称: 'add_level_1_memory',
            参数片段: JSON.stringify({ 内容: '模型写入的记忆', 关键词: ['模型', '写入'], 标签: ['自动'], 评分: 88 }),
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
  })

  it('在一次模型响应中顺序更新关键词和标签', async (): Promise<void> => {
    智能体实例 = new 带记忆的智能体({ 向量模型: { 类型: '无' }, 二级记忆遗忘分数阈值: 0 })
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

    流式请求AI模拟
      .mockResolvedValueOnce({
        完整文本: '',
        工具调用列表: [
          {
            id: 'append_keyword',
            名称: 'append_memory_keywords',
            参数片段: JSON.stringify({ id: 记忆.id, 关键词列表: ['新关键词'] }),
          },
          {
            id: 'overwrite_tag',
            名称: 'overwrite_memory_tags',
            参数片段: JSON.stringify({ id: 记忆.id, 标签列表: ['新标签'] }),
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
  })
})
