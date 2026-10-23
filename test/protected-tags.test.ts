import OpenAI from 'openai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { 带记忆的智能体, 记忆等级, type 带记忆的智能体选项 } from '../src/index'
import { 使用共享PGlite } from './helpers/shared-pglite-fixture'

let 流式请求AI模拟 = vi.hoisted(() => vi.fn())

vi.mock('../src/agent/stream-request', () => ({ 流式请求AI: 流式请求AI模拟 }))

type 工具调用 = { 名称: string; 参数: Record<string, unknown> }

describe('受保护标签', () => {
  let 夹具 = 使用共享PGlite()
  let 智能体实例: 带记忆的智能体 | undefined
  let 受保护 = (标签: string): boolean => 标签 === '遗忘豁免' || 标签.startsWith('来源:')

  beforeEach((): void => {
    流式请求AI模拟.mockReset()
  })

  afterEach(async (): Promise<void> => {
    if (智能体实例 !== undefined) {
      await 智能体实例.销毁()
      智能体实例 = undefined
    }
  })

  async function 准备(
    选项: 带记忆的智能体选项,
    等级: 记忆等级 = 记忆等级.一级,
  ): Promise<{ 实例: 带记忆的智能体; id: string }> {
    let 实例 = 夹具.新建智能体({ 二级记忆遗忘分数阈值: 0, ...选项 })
    智能体实例 = 实例
    await 实例.批量注入记忆([
      {
        内容: '原记忆',
        关键词: ['原'],
        标签: ['来源:手动', '遗忘豁免', '普通'],
        评分: 80,
        等级,
        创建时间: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])
    let 记忆 = (await 实例.查询记忆())[0]
    if (记忆 === undefined) throw new Error('注入失败')
    return { 实例, id: 记忆.id }
  }

  async function 让模型调用(实例: 带记忆的智能体, 调用列表: 工具调用[]): Promise<void> {
    流式请求AI模拟
      .mockResolvedValueOnce({
        完整文本: '',
        工具调用列表: 调用列表.map((调用, i) => ({
          id: `call_${String(i)}`,
          名称: 调用.名称,
          参数片段: JSON.stringify(调用.参数),
        })),
        已中断: false,
      })
      .mockResolvedValueOnce({ 完整文本: '{"完成":true}', 工具调用列表: [], 已中断: false })
    await 实例.对话({
      命令: '改标签',
      预期结果Schema: z.object({ 完成: z.boolean() }),
      预期结果描述: '操作是否完成',
      回调: async (): Promise<void> => {},
      openai客户端: new OpenAI({ apiKey: 'test' }),
      模型名称: 'mock-model',
      是否自动召回: false,
    })
  }

  async function 标签(实例: 带记忆的智能体, id: string): Promise<string[]> {
    return [...((await 实例.查找记忆(id))?.标签 ?? [])].sort()
  }

  it('模型用 edit_level_1_memory 删掉受保护标签时被保留，普通标签照常改', async (): Promise<void> => {
    let { 实例, id } = await 准备({ 受保护标签: 受保护 })
    await 让模型调用(实例, [
      { 名称: 'edit_level_1_memory', 参数: { id, 新内容: '新内容', 新关键词: ['新'], 新标签: ['换了'], 新评分: 70 } },
    ])
    expect(await 标签(实例, id)).toEqual([...['来源:手动', '换了', '遗忘豁免']].sort())
    expect((await 实例.查找记忆(id))?.内容).toBe('新内容')
  })

  it('模型用 edit_level_0_memory 删受保护标签被保留、伪造受保护标签被忽略', async (): Promise<void> => {
    let { 实例, id } = await 准备({ 受保护标签: 受保护 }, 记忆等级.零级)
    await 让模型调用(实例, [
      { 名称: 'edit_level_0_memory', 参数: { id, 新内容: '新内容', 新关键词: ['新'], 新标签: ['来源:模型', '换了'] } },
    ])
    expect(await 标签(实例, id)).toEqual([...['来源:手动', '换了', '遗忘豁免']].sort())
  })

  it('overwrite_memory_tags 保留受保护标签并忽略新增的受保护标签，返回给模型的是最终标签', async (): Promise<void> => {
    let { 实例, id } = await 准备({ 受保护标签: 受保护 })
    await 让模型调用(实例, [{ 名称: 'overwrite_memory_tags', 参数: { id, 标签列表: ['甲', '来源:伪造'] } }])
    expect(await 标签(实例, id)).toEqual([...['来源:手动', '甲', '遗忘豁免']].sort())
    let 消息列表 = (流式请求AI模拟.mock.calls[1]?.[2] ?? []) as { role: string; content?: unknown }[]
    let 工具结果 = String(消息列表.find((消息) => 消息.role === 'tool')?.content)
    expect(工具结果).toContain('最新标签列表: 来源:手动, 遗忘豁免, 甲')
    expect(工具结果).not.toContain('来源:伪造')
  })

  it('remove_memory_tags 删不掉受保护标签，能删普通标签', async (): Promise<void> => {
    let { 实例, id } = await 准备({ 受保护标签: 受保护 })
    await 让模型调用(实例, [{ 名称: 'remove_memory_tags', 参数: { id, 标签列表: ['遗忘豁免', '来源:手动', '普通'] } }])
    expect(await 标签(实例, id)).toEqual([...['来源:手动', '遗忘豁免']].sort())
  })

  it('append_memory_tags 追加普通标签生效，追加受保护标签被忽略', async (): Promise<void> => {
    let { 实例, id } = await 准备({ 受保护标签: 受保护 })
    await 让模型调用(实例, [{ 名称: 'append_memory_tags', 参数: { id, 标签列表: ['新增', '来源:伪造'] } }])
    expect(await 标签(实例, id)).toEqual([...['来源:手动', '新增', '普通', '遗忘豁免']].sort())
  })

  it('模型新增记忆时不能带受保护标签', async (): Promise<void> => {
    let { 实例 } = await 准备({ 受保护标签: 受保护 })
    await 让模型调用(实例, [
      { 名称: 'add_level_1_memory', 参数: { 内容: '模型新记忆', 关键词: ['新'], 标签: ['遗忘豁免', '好'], 评分: 60 } },
    ])
    let 新记忆 = (await 实例.查询记忆()).find((记忆) => 记忆.内容 === '模型新记忆')
    expect(新记忆?.标签).toEqual(['好'])
  })

  it('调用方用公开方法改标签不受限制', async (): Promise<void> => {
    let { 实例, id } = await 准备({ 受保护标签: 受保护 })
    await 实例.更新记忆(id, { 标签: ['遗忘豁免'] })
    expect(await 标签(实例, id)).toEqual([...['遗忘豁免']].sort())
    await 实例.更新记忆(id, { 标签: ['来源:手动', '遗忘豁免'] })
    let 新增 = await 实例.添加记忆({
      内容: '调用方添加',
      关键词: ['添'],
      标签: ['来源:手动'],
      评分: 50,
      等级: 记忆等级.二级,
      创建时间: new Date('2026-01-02T00:00:00.000Z'),
    })
    expect(新增.标签).toEqual(['来源:手动'])
    await 实例.批量注入记忆([
      { 内容: '批量', 关键词: ['批'], 标签: ['遗忘豁免'], 评分: 50, 等级: 记忆等级.二级, 创建时间: new Date() },
    ])
    expect((await 实例.查询记忆()).find((记忆) => 记忆.内容 === '批量')?.标签).toEqual(['遗忘豁免'])
  })

  it('不传受保护标签时行为不变：模型可以随意改标签', async (): Promise<void> => {
    let { 实例, id } = await 准备({})
    await 让模型调用(实例, [{ 名称: 'overwrite_memory_tags', 参数: { id, 标签列表: ['来源:伪造'] } }])
    expect(await 标签(实例, id)).toEqual([...['来源:伪造']].sort())
    await 让模型调用(实例, [{ 名称: 'remove_memory_tags', 参数: { id, 标签列表: ['来源:伪造'] } }])
    expect(await 标签(实例, id)).toEqual([...[]].sort())
  })
})
