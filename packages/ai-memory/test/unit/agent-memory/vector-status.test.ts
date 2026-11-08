import type { PGlite } from '@electric-sql/pglite'
import { 带记忆的智能体, 记忆等级 } from '@lsby/ai-memory'
import type OpenAI from 'openai'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { 创建带向量的PGlite, 文本转向量 } from '../../helpers/shared-storage-helper'

type 假嵌入 = { 客户端: OpenAI; 失败文本: Set<string> }

function 创建假嵌入(): 假嵌入 {
  let 失败文本 = new Set<string>()
  let 客户端 = {
    embeddings: {
      create: async (请求: { input: string }): Promise<{ data: { embedding: number[] }[] }> => {
        if (失败文本.has(请求.input)) throw new Error('假的向量服务故障')
        return { data: [{ embedding: 文本转向量(请求.input) }] }
      },
    },
  } as unknown as OpenAI
  return { 客户端, 失败文本 }
}

let 技能代码 = (名称: string): string => `
skill = {
  name: '${名称}',
  description: '测试技能${名称}',
  parametersSchema: { type: 'object', properties: {}, required: [] },
  returnSchema: { type: 'object', properties: {}, required: [] },
  execute: async function() { return {}; }
}
`

describe('读取向量状态与定向补算', () => {
  let pglite: PGlite
  let schema计数 = 0
  let 实例列表: 带记忆的智能体[] = []
  let 假: 假嵌入

  beforeAll((): void => {
    pglite = 创建带向量的PGlite()
  })
  afterAll(async (): Promise<void> => {
    await pglite.close()
  })
  beforeEach((): void => {
    假 = 创建假嵌入()
    vi.spyOn(console, 'error').mockImplementation((): void => {})
  })
  afterEach(async (): Promise<void> => {
    vi.restoreAllMocks()
    for (let 实例 of 实例列表.reverse()) await 实例.销毁()
    实例列表 = []
  })

  function 开实例(schema: string, 向量: 'on' | 'off'): 带记忆的智能体 {
    let 实例 = new 带记忆的智能体({
      存储: { 模式: '外部', pglite, schema },
      向量模型: 向量 === 'on' ? { 类型: '在线', openai客户端: 假.客户端, 模型名称: 'fake', 维度: 4 } : { 类型: '无' },
      向量召回相似度阈值: 0.5,
    })
    实例列表.push(实例)
    return 实例
  }
  /** 造数据：记忆A(燕麦拿铁; 线索 咖啡/饮品)、记忆B(花生; 线索 过敏)、技能(线索 工具/咖啡)。共 12 行缺向量。 */
  async function 造数据(): Promise<{ schema: string; 无向量: 带记忆的智能体; 记忆A: string; 记忆B: string }> {
    schema计数 += 1
    let schema = `vstatus_${String(schema计数)}`
    let 无向量 = 开实例(schema, 'off')
    let A = await 无向量.添加记忆({
      内容: '喜欢喝燕麦拿铁',
      线索: ['咖啡', '饮品'],
      评分: 50,
      等级: 记忆等级.二级,
      创建时间: new Date(),
    })
    let B = await 无向量.添加记忆({
      内容: '对花生过敏',
      线索: ['过敏'],
      评分: 90,
      等级: 记忆等级.一级,
      创建时间: new Date(),
    })
    await 无向量.创建技能(技能代码('skill_a'), '{}', ['工具', '咖啡'])
    return { schema, 无向量, 记忆A: A.id, 记忆B: B.id }
  }
  async function 缺失计数(schema: string, 表: string, 条件: string = 'true'): Promise<number> {
    let 行 = await pglite.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "${schema}"."${表}" WHERE 向量 IS NULL AND ${条件}`,
    )
    return 行.rows[0]?.n ?? -1
  }

  it('状态正确，且响应里没有内容、线索文字和向量', async (): Promise<void> => {
    let { 无向量, 记忆A, 记忆B } = await 造数据()
    let 状态 = await 无向量.读取向量状态()
    expect(状态.统计).toEqual({ 记忆数: 2, 线索数: 4, 缺失数: 12 })
    expect(状态.记忆.length).toBe(2)
    let a = 状态.记忆.find((项) => 项.id === 记忆A)
    let b = 状态.记忆.find((项) => 项.id === 记忆B)
    expect(a).toMatchObject({ 等级: 记忆等级.二级, 有向量: false, 关联总数: 2, 关联缺失数: 2 })
    expect(b).toMatchObject({ 等级: 记忆等级.一级, 有向量: false, 关联总数: 1, 关联缺失数: 1 })
    expect(a?.创建时间).toBeInstanceOf(Date)
    expect(状态.线索.length).toBe(4)
    expect(状态.线索.every((项) => 项.有向量 === false)).toBe(true)
    // 咖啡被「记忆A」和「技能」各引用一次
    expect(状态.线索.map((项) => 项.使用次数).sort()).toEqual([1, 1, 1, 2])

    let 序列化 = JSON.stringify(状态)
    for (let 敏感 of ['燕麦拿铁', '花生', '咖啡', '饮品', '过敏', '工具', 'skill_a']) expect(序列化).not.toContain(敏感)
    for (let 项 of [...状态.记忆, ...状态.线索]) {
      expect(Object.keys(项)).not.toContain('内容')
      expect(Object.keys(项)).not.toContain('向量')
    }
    expect(Object.keys(状态.记忆[0] ?? {}).sort()).toEqual(
      ['id', '创建时间', '关联总数', '关联缺失数', '有向量', '等级'].sort(),
    )
    expect(Object.keys(状态.线索[0] ?? {}).sort()).toEqual(['id', '使用次数', '有向量'].sort())
  })

  it('读取状态与统计都不产生提交', async (): Promise<void> => {
    let { 无向量 } = await 造数据()
    let 提交数 = (await 无向量.查询记忆提交(1000)).length
    await 无向量.读取向量状态()
    await 无向量.统计向量状态()
    expect((await 无向量.查询记忆提交(1000)).length).toBe(提交数)
  })

  it('统计向量状态与读取状态的统计一致，也和补算的剩余数一致', async (): Promise<void> => {
    let { schema, 无向量 } = await 造数据()
    expect(await 无向量.统计向量状态()).toEqual({ 记忆数: 2, 线索数: 4, 缺失数: 12 })
    let 实例 = 开实例(schema, 'on')
    假.失败文本.add('咖啡')
    let 补算 = await 实例.补算缺失向量({ 单次上限: 1000 })
    let 统计 = await 实例.统计向量状态()
    expect(补算).toEqual({ 已补算数: 11, 剩余数: 1, 失败数: 1 })
    expect(统计.缺失数).toBe(补算.剩余数)
    expect((await 实例.读取向量状态()).统计).toEqual(统计)
    let 状态 = await 实例.读取向量状态()
    expect(状态.线索.filter((项) => 项.有向量 === false).length).toBe(1)
    expect(状态.记忆.every((项) => 项.有向量 === true && 项.关联缺失数 === 0)).toBe(true)
  })

  it('按记忆id补：只补这条记忆本身和它的关联行', async (): Promise<void> => {
    let { schema, 记忆A, 记忆B } = await 造数据()
    let 实例 = 开实例(schema, 'on')
    let 结果 = await 实例.补算缺失向量({ 记忆id: 记忆A })
    // 记忆A 本身 1 + 关联 2；剩余 = 该范围内剩余 0
    expect(结果).toEqual({ 已补算数: 3, 剩余数: 0, 失败数: 0 })
    expect(await 缺失计数(schema, '当前记忆表', `id = '${记忆A}'`)).toBe(0)
    expect(await 缺失计数(schema, '当前记忆表', `id = '${记忆B}'`)).toBe(1)
    expect(await 缺失计数(schema, '当前记忆线索关联表', `记忆id = '${记忆A}'`)).toBe(0)
    expect(await 缺失计数(schema, '当前记忆线索关联表', `记忆id = '${记忆B}'`)).toBe(1)
    expect(await 缺失计数(schema, '当前线索表')).toBe(4)
    expect(await 缺失计数(schema, '当前技能表')).toBe(1)
    expect(await 缺失计数(schema, '当前技能线索关联表')).toBe(2)
    // 全库统计里还剩 9
    expect((await 实例.统计向量状态()).缺失数).toBe(9)
  })

  it('按线索id补：只补这条线索本身，不动关联行', async (): Promise<void> => {
    let { schema, 无向量 } = await 造数据()
    let 线索 = (await 无向量.读取向量状态()).线索
    let 线索行 = await pglite.query<{ id: string }>(`SELECT id FROM "${schema}"."当前线索表" WHERE 内容 = '过敏'`)
    let 目标 = 线索行.rows[0]?.id ?? ''
    expect(线索.some((项) => 项.id === 目标)).toBe(true)
    let 实例 = 开实例(schema, 'on')
    expect(await 实例.补算缺失向量({ 线索id: 目标 })).toEqual({ 已补算数: 1, 剩余数: 0, 失败数: 0 })
    expect(await 缺失计数(schema, '当前线索表')).toBe(3)
    expect(await 缺失计数(schema, '当前线索表', `id = '${目标}'`)).toBe(0)
    expect(await 缺失计数(schema, '当前记忆表')).toBe(2)
    expect(await 缺失计数(schema, '当前记忆线索关联表')).toBe(3)
    expect(await 缺失计数(schema, '当前技能表')).toBe(1)
  })

  it('目标不存在或已补好：返回全 0，不报错，不产生提交', async (): Promise<void> => {
    let { schema, 记忆A } = await 造数据()
    let 实例 = 开实例(schema, 'on')
    expect(await 实例.补算缺失向量({ 记忆id: 'no-such' })).toEqual({ 已补算数: 0, 剩余数: 0, 失败数: 0 })
    expect(await 实例.补算缺失向量({ 线索id: 'no-such' })).toEqual({ 已补算数: 0, 剩余数: 0, 失败数: 0 })
    await 实例.补算缺失向量({ 记忆id: 记忆A })
    let 提交数 = (await 实例.查询记忆提交(1000)).length
    expect(await 实例.补算缺失向量({ 记忆id: 记忆A })).toEqual({ 已补算数: 0, 剩余数: 0, 失败数: 0 })
    expect((await 实例.查询记忆提交(1000)).length).toBe(提交数)
  })

  it('不指定目标时行为不变：补全部五张表', async (): Promise<void> => {
    let { schema } = await 造数据()
    let 实例 = 开实例(schema, 'on')
    expect(await 实例.补算缺失向量({ 单次上限: 1000 })).toEqual({ 已补算数: 12, 剩余数: 0, 失败数: 0 })
  })

  it('记忆id 与 线索id 互斥，同时传报错；空字符串也报错', async (): Promise<void> => {
    let { schema, 记忆A } = await 造数据()
    let 实例 = 开实例(schema, 'on')
    await expect(实例.补算缺失向量({ 记忆id: 记忆A, 线索id: 'x' })).rejects.toThrow(/互斥/)
    await expect(实例.补算缺失向量({ 记忆id: '' })).rejects.toThrow(/非空/)
    expect((await 实例.统计向量状态()).缺失数).toBe(12)
  })

  it('定向补能绕过队头持续失败的行', async (): Promise<void> => {
    let { schema, 记忆B } = await 造数据()
    let 实例 = 开实例(schema, 'on')
    // 队头是「喜欢喝燕麦拿铁」这条记忆，让它持续失败；单次上限 1 时全补永远卡在它身上
    假.失败文本.add('喜欢喝燕麦拿铁')
    expect(await 实例.补算缺失向量({ 单次上限: 1 })).toEqual({ 已补算数: 0, 剩余数: 12, 失败数: 1 })
    expect(await 实例.补算缺失向量({ 单次上限: 1 })).toEqual({ 已补算数: 0, 剩余数: 12, 失败数: 1 })
    // 定向补别的记忆不受影响
    expect(await 实例.补算缺失向量({ 记忆id: 记忆B, 单次上限: 1 })).toMatchObject({ 已补算数: 1, 失败数: 0 })
    expect(await 缺失计数(schema, '当前记忆表', `id = '${记忆B}'`)).toBe(0)
  })
})
