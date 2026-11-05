import { 带记忆的智能体, 记忆等级 } from '@lsby/ai-memory'
import OpenAI from 'openai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { 使用共享PGlite } from '../../helpers/shared-pglite-fixture'

let 流式请求AI模拟 = vi.hoisted(() => vi.fn())

vi.mock('../../../../ai-agent/src/core/stream-request', () => ({ 流式请求AI: 流式请求AI模拟 }))

describe('记忆线索工具', () => {
  let 夹具 = 使用共享PGlite()
  let 智能体实例: 带记忆的智能体 | undefined

  beforeEach((): void => {
    流式请求AI模拟.mockReset()
  })

  afterEach(async (): Promise<void> => {
    if (智能体实例 !== undefined) await 智能体实例.销毁()
    智能体实例 = undefined
  })

  async function 准备(): Promise<{ 实例: 带记忆的智能体; id: string }> {
    let 实例 = 夹具.新建智能体({ 向量模型: { 类型: '无' }, 二级记忆遗忘分数阈值: 0 })
    智能体实例 = 实例
    let 记忆 = await 实例.添加记忆({
      内容: '原记忆',
      线索: ['原线索'],
      评分: 80,
      等级: 记忆等级.一级,
      创建时间: new Date('2026-01-01T00:00:00.000Z'),
    })
    return { 实例, id: 记忆.id }
  }

  async function 让模型调用(实例: 带记忆的智能体, 名称: string, 参数: Record<string, unknown>): Promise<void> {
    流式请求AI模拟
      .mockResolvedValueOnce({
        完整文本: '',
        工具调用列表: [{ id: 'call_0', 名称, 参数片段: JSON.stringify({ ...参数, 消息: '更新联想线索' }) }],
        已中断: false,
      })
      .mockResolvedValueOnce({ 完整文本: '{"完成":true}', 工具调用列表: [], 已中断: false })
    await 实例.对话({
      命令: '更新线索',
      预期结果Schema: z.object({ 完成: z.boolean() }),
      预期结果描述: '操作是否完成',
      回调: async (): Promise<void> => {},
      openai客户端: new OpenAI({ apiKey: 'test' }),
      模型名称: 'mock-model',
      是否自动召回: false,
    })
  }

  it('支持追加、移除和覆盖线索', async (): Promise<void> => {
    let { 实例, id } = await 准备()
    await 让模型调用(实例, 'append_memory_clues', { id, 线索: ['新线索'] })
    expect((await 实例.查找记忆(id))?.线索).toEqual(['原线索', '新线索'])
    await 让模型调用(实例, 'remove_memory_clues', { id, 线索: ['原线索'] })
    expect((await 实例.查找记忆(id))?.线索).toEqual(['新线索'])
    await 让模型调用(实例, 'overwrite_memory_clues', { id, 线索: ['最终线索'] })
    expect((await 实例.查找记忆(id))?.线索).toEqual(['最终线索'])
  })

  it('公开管理接口可以直接更新线索', async (): Promise<void> => {
    let { 实例, id } = await 准备()
    await 实例.更新记忆(id, { 线索: ['直接更新'] })
    expect((await 实例.查找记忆(id))?.线索).toEqual(['直接更新'])
    expect(await 实例.查询线索()).toMatchObject([{ 内容: '直接更新' }])
    expect(await 实例.查询记忆线索关联(id)).toMatchObject([{ 记忆id: id }])
  })
})
