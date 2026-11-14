import type { PGlite } from '@electric-sql/pglite'
import { 带记忆的智能体, 记忆等级 } from '@lsby/ai-memory'
import type OpenAI from 'openai'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { 创建带向量的PGlite, 文本转向量 } from '../../helpers/shared-storage-helper'

describe('添加记忆不计算向量', () => {
  let pglite: PGlite
  let schema计数 = 0
  let 实例列表: 带记忆的智能体[] = []
  let 请求文本: string[] = []

  let 客户端 = {
    embeddings: {
      create: async (请求: { input: string }): Promise<{ data: { embedding: number[] }[] }> => {
        请求文本.push(请求.input)
        return { data: [{ embedding: 文本转向量(请求.input) }] }
      },
    },
  } as unknown as OpenAI

  beforeAll((): void => {
    pglite = 创建带向量的PGlite()
  })
  afterAll(async (): Promise<void> => {
    await pglite.close()
  })
  afterEach(async (): Promise<void> => {
    vi.restoreAllMocks()
    for (let 实例 of 实例列表.reverse()) await 实例.销毁()
    实例列表 = []
    请求文本 = []
  })

  function 开实例(): 带记忆的智能体 {
    schema计数 += 1
    let 实例 = new 带记忆的智能体({
      存储: { 模式: '外部', pglite, schema: `skipvec_${String(schema计数)}` },
      向量模型: { 类型: '在线', openai客户端: 客户端, 模型名称: 'fake', 维度: 4 },
      向量召回相似度阈值: 0.5,
    })
    实例列表.push(实例)
    return 实例
  }

  let 记忆项 = (内容: string, 线索: string[]): Parameters<带记忆的智能体['添加记忆']>[0] => ({
    内容,
    线索,
    评分: 50,
    等级: 记忆等级.二级,
    创建时间: new Date(),
  })

  it('计算向量为 false 时不调用向量接口，三类向量都为空', async (): Promise<void> => {
    let 实例 = 开实例()
    let 记忆 = await 实例.添加记忆(记忆项('喜欢喝燕麦拿铁', ['咖啡', '饮品']), undefined, undefined, {
      计算向量: false,
    })
    expect(请求文本).toEqual([])
    expect(记忆.内容).toBe('喜欢喝燕麦拿铁')
    let 状态 = await 实例.读取向量状态()
    expect(状态.统计).toEqual({ 记忆数: 1, 线索数: 2, 缺失数: 5 })
    expect(状态.记忆[0]).toMatchObject({ id: 记忆.id, 有向量: false, 关联总数: 2, 关联缺失数: 2 })
    expect(状态.线索.every((项) => 项.有向量 === false)).toBe(true)
  })

  it('之后按记忆id补算能补齐三类向量', async (): Promise<void> => {
    let 实例 = 开实例()
    let 记忆 = await 实例.添加记忆(记忆项('喜欢喝燕麦拿铁', ['咖啡', '饮品']), undefined, undefined, {
      计算向量: false,
    })
    expect(await 实例.补算缺失向量({ 记忆id: 记忆.id })).toEqual({ 已补算数: 3, 剩余数: 0, 失败数: 0 })
    let 状态 = await 实例.读取向量状态()
    expect(状态.记忆[0]).toMatchObject({ 有向量: true, 关联缺失数: 0 })
    expect(状态.线索.filter((项) => 项.有向量 === false).length).toBe(2)
    expect(await 实例.补算缺失向量()).toEqual({ 已补算数: 2, 剩余数: 0, 失败数: 0 })
    expect((await 实例.统计向量状态()).缺失数).toBe(0)
  })

  it('已存在且有向量的线索照常复用，只有新线索留空', async (): Promise<void> => {
    let 实例 = 开实例()
    await 实例.添加记忆(记忆项('喜欢喝燕麦拿铁', ['咖啡']))
    请求文本 = []
    await 实例.添加记忆(记忆项('每天早上喝美式', ['咖啡', '早餐']), undefined, undefined, { 计算向量: false })
    expect(请求文本).toEqual([])
    let 状态 = await 实例.读取向量状态()
    expect(状态.线索.filter((项) => 项.有向量 === false).length).toBe(1)
    expect(状态.统计.缺失数).toBe(1 + 1 + 2)
  })

  it('不传选项或 计算向量 为 true 时仍同步计算向量', async (): Promise<void> => {
    let 实例 = 开实例()
    await 实例.添加记忆(记忆项('喜欢喝燕麦拿铁', ['咖啡', '饮品']))
    expect(请求文本.length).toBeGreaterThan(0)
    expect((await 实例.统计向量状态()).缺失数).toBe(0)
    await 实例.添加记忆(记忆项('对花生过敏', ['过敏']), undefined, undefined, { 计算向量: true })
    expect((await 实例.统计向量状态()).缺失数).toBe(0)
  })
})
