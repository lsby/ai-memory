import type { PGlite } from '@electric-sql/pglite'
import { 带记忆的智能体, 记忆等级 } from '@lsby/ai-memory'
import { Kysely } from 'kysely'
import type OpenAI from 'openai'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { 构建智能体配置 } from '../../../src/config'
import { 带互斥的PGlite方言 } from '../../../src/storage/connection'
import { 查询记忆工具 } from '../../../src/tools/associative-search'
import { 获取向量 } from '../../../src/tools/get-vector'
import type { 记忆数据库 } from '../../../src/types'
import { 创建带向量的PGlite, 文本转向量 } from '../../helpers/shared-storage-helper'

type 假嵌入 = {
  客户端: OpenAI
  请求文本: string[]
  失败文本: Set<string>
  全部失败: { 值: boolean }
}

/** 假的嵌入客户端：不连任何真实服务，向量由文本确定地算出来。 */
function 创建假嵌入(): 假嵌入 {
  let 请求文本: string[] = []
  let 失败文本 = new Set<string>()
  let 全部失败 = { 值: false }
  let 客户端 = {
    embeddings: {
      create: async (请求: { input: string }): Promise<{ data: { embedding: number[] }[] }> => {
        请求文本.push(请求.input)
        if (全部失败.值 === true || 失败文本.has(请求.input)) throw new Error('假的向量服务故障')
        return { data: [{ embedding: 文本转向量(请求.input) }] }
      },
    },
  } as unknown as OpenAI
  return { 客户端, 请求文本, 失败文本, 全部失败 }
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

describe('补算缺失向量', () => {
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

  function 新schema(): string {
    schema计数 += 1
    return `backfill_${String(schema计数)}`
  }
  function 开实例(schema: string, 向量: 'on' | 'off', 只读: boolean = false): 带记忆的智能体 {
    let 实例 = new 带记忆的智能体({
      存储: { 模式: '外部', pglite, schema },
      向量模型: 向量 === 'on' ? { 类型: '在线', openai客户端: 假.客户端, 模型名称: 'fake', 维度: 4 } : { 类型: '无' },
      只读模式: 只读,
      向量召回相似度阈值: 0.5,
    })
    实例列表.push(实例)
    return 实例
  }
  /** 先用「无向量模型」的实例写入数据，得到一批 向量 IS NULL 的行。 */
  async function 造缺向量数据(schema: string): Promise<带记忆的智能体> {
    let 无向量 = 开实例(schema, 'off')
    await 无向量.添加记忆({
      内容: '喜欢喝燕麦拿铁',
      线索: ['咖啡', '饮品'],
      评分: 50,
      等级: 记忆等级.二级,
      创建时间: new Date(),
    })
    await 无向量.添加记忆({ 内容: '对花生过敏', 线索: ['过敏'], 评分: 90, 等级: 记忆等级.一级, 创建时间: new Date() })
    await 无向量.创建技能(技能代码('skill_a'), '{}', ['工具', '咖啡'])
    return 无向量
  }
  async function 缺失计数(schema: string): Promise<Record<string, number>> {
    let 结果: Record<string, number> = {}
    for (let 表 of ['当前记忆表', '当前线索表', '当前记忆线索关联表', '当前技能表', '当前技能线索关联表']) {
      let 行 = await pglite.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM "${schema}"."${表}" WHERE 向量 IS NULL`,
      )
      结果[表] = 行.rows[0]?.n ?? -1
    }
    return 结果
  }

  it('补齐记忆、线索、关联、技能、技能关联五张表，文本规则与正常写入一致', async (): Promise<void> => {
    let schema = 新schema()
    await 造缺向量数据(schema)
    let 前 = await 缺失计数(schema)
    expect(前).toEqual({ 当前记忆表: 2, 当前线索表: 4, 当前记忆线索关联表: 3, 当前技能表: 1, 当前技能线索关联表: 2 })

    let 有向量 = 开实例(schema, 'on')
    let 结果 = await 有向量.补算缺失向量({ 单次上限: 1000 })
    expect(结果).toEqual({ 已补算数: 12, 剩余数: 0, 失败数: 0 })
    expect(Object.values(await 缺失计数(schema)).every((n) => n === 0)).toBe(true)

    // 抽查各表的向量就是「正常写入时会用的那段文本」算出来的
    let 读向量 = async (sql: string): Promise<number[]> => {
      let 行 = await pglite.query<{ v: string }>(sql)
      return JSON.parse(行.rows[0]?.v ?? '[]') as number[]
    }
    let 期望 = (文本: string): number[] => 文本转向量(文本)
    expect(await 读向量(`SELECT 向量::text AS v FROM "${schema}"."当前记忆表" WHERE 内容 = '对花生过敏'`)).toEqual(
      期望('对花生过敏').map((x) => expect.closeTo(x, 5)),
    )
    expect(await 读向量(`SELECT 向量::text AS v FROM "${schema}"."当前线索表" WHERE 内容 = '过敏'`)).toEqual(
      期望('过敏').map((x) => expect.closeTo(x, 5)),
    )
    expect(
      await 读向量(
        `SELECT 关联.向量::text AS v FROM "${schema}"."当前记忆线索关联表" 关联 JOIN "${schema}"."当前线索表" 线索 ON 线索.id = 关联.线索id WHERE 线索.内容 = '过敏'`,
      ),
    ).toEqual(期望('这条记忆通过线索「过敏」被联想到：\n对花生过敏').map((x) => expect.closeTo(x, 5)))
    expect(await 读向量(`SELECT 向量::text AS v FROM "${schema}"."当前技能表"`)).toEqual(
      期望('skill_a 测试技能skill_a').map((x) => expect.closeTo(x, 5)),
    )
    expect(
      await 读向量(
        `SELECT 关联.向量::text AS v FROM "${schema}"."当前技能线索关联表" 关联 JOIN "${schema}"."当前线索表" 线索 ON 线索.id = 关联.线索id WHERE 线索.内容 = '工具'`,
      ),
    ).toEqual(期望('技能「skill_a」通过线索「工具」被联想到：\n测试技能skill_a').map((x) => expect.closeTo(x, 5)))
    let 维度 = await pglite.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "${schema}"."当前记忆表" WHERE 向量维度 = 4 AND 向量维度 = vector_dims(向量)`,
    )
    expect(维度.rows[0]?.n).toBe(2)
  })

  it('幂等：补完后再调用什么都不做，也不产生新的提交', async (): Promise<void> => {
    let schema = 新schema()
    await 造缺向量数据(schema)
    let 实例 = 开实例(schema, 'on')
    await 实例.补算缺失向量()
    let 提交数 = (await 实例.查询记忆提交(1000)).length
    let 请求数 = 假.请求文本.length
    expect(await 实例.补算缺失向量()).toEqual({ 已补算数: 0, 剩余数: 0, 失败数: 0 })
    expect((await 实例.查询记忆提交(1000)).length).toBe(提交数)
    expect(假.请求文本.length).toBe(请求数)
  })

  it('部分失败：失败的行保持 NULL、不抛错，下次还能补', async (): Promise<void> => {
    let schema = 新schema()
    await 造缺向量数据(schema)
    let 实例 = 开实例(schema, 'on')
    假.失败文本.add('咖啡')
    let 第一次 = await 实例.补算缺失向量({ 单次上限: 1000 })
    expect(第一次).toEqual({ 已补算数: 11, 剩余数: 1, 失败数: 1 })
    expect((await 缺失计数(schema))['当前线索表']).toBe(1)

    假.失败文本.clear()
    expect(await 实例.补算缺失向量()).toEqual({ 已补算数: 1, 剩余数: 0, 失败数: 0 })
  })

  it('全部失败：不抛错、不产生提交', async (): Promise<void> => {
    let schema = 新schema()
    await 造缺向量数据(schema)
    let 实例 = 开实例(schema, 'on')
    let 提交数 = (await 实例.查询记忆提交(1000)).length
    假.全部失败.值 = true
    let 结果 = await 实例.补算缺失向量({ 单次上限: 1000 })
    expect(结果).toEqual({ 已补算数: 0, 剩余数: 12, 失败数: 12 })
    expect((await 实例.查询记忆提交(1000)).length).toBe(提交数)
  })

  it('单次上限：分批补，多次调用走完', async (): Promise<void> => {
    let schema = 新schema()
    await 造缺向量数据(schema)
    let 实例 = 开实例(schema, 'on')
    let 第一次 = await 实例.补算缺失向量({ 单次上限: 5 })
    expect(第一次).toEqual({ 已补算数: 5, 剩余数: 7, 失败数: 0 })
    let 第二次 = await 实例.补算缺失向量({ 单次上限: 5 })
    expect(第二次).toEqual({ 已补算数: 5, 剩余数: 2, 失败数: 0 })
    let 第三次 = await 实例.补算缺失向量({ 单次上限: 5 })
    expect(第三次).toEqual({ 已补算数: 2, 剩余数: 0, 失败数: 0 })
  })

  it('走正常提交：新增一个提交，变更记录里每行都有 update，且不改其他字段', async (): Promise<void> => {
    let schema = 新schema()
    let 无向量 = await 造缺向量数据(schema)
    let 记忆前 = await 无向量.查询记忆()
    let 线索前 = await 无向量.查询线索()
    let 关联前 = await 无向量.查询记忆线索关联()
    let 技能前 = await 无向量.查询技能()
    let 提交前 = await 无向量.查询记忆提交(1000)
    let 头前 = await 无向量.查询当前记忆提交id()

    let 实例 = 开实例(schema, 'on')
    await 实例.补算缺失向量({ 单次上限: 1000 })

    let 提交后 = await 实例.查询记忆提交(1000)
    expect(提交后.length).toBe(提交前.length + 1)
    let 新提交 = 提交后.find((提交) => 提交.提交说明 === '补算缺失向量')
    expect(新提交).toBeDefined()
    expect(新提交?.父记忆提交id).toBe(头前)
    expect(await 实例.查询当前记忆提交id()).toBe(新提交?.id)
    let 变更 = 新提交?.变更列表 ?? []
    expect(变更.length).toBe(12)
    expect(变更.every((项) => 项.操作类型 === 'update')).toBe(true)
    let 按表计数: Record<string, number> = {}
    for (let 项 of 变更) 按表计数[项.目标表] = (按表计数[项.目标表] ?? 0) + 1
    expect(按表计数).toEqual({ memory: 2, clue: 4, memory_clue_relation: 3, skill: 1, skill_clue_relation: 2 })
    expect(变更.every((项) => Array.isArray(项.行数据?.['向量']) || typeof 项.行数据?.['向量'] === 'string')).toBe(true)

    // 其他字段都没动
    let 按id排序 = <T extends { id: string }>(列表: T[]): T[] => [...列表].sort((a, b) => a.id.localeCompare(b.id))
    expect(按id排序(await 实例.查询记忆())).toEqual(按id排序(记忆前))
    expect(按id排序(await 实例.查询线索())).toEqual(按id排序(线索前))
    expect(按id排序(await 实例.查询技能())).toEqual(按id排序(技能前))
    let 关联键 = (列表: { 记忆id: string; 线索id: string }[]): string[] =>
      列表.map((项) => `${项.记忆id}/${项.线索id}`).sort()
    expect(关联键(await 实例.查询记忆线索关联())).toEqual(关联键(关联前))
  })

  it('补算后联想检索能查到，补算前查不到', async (): Promise<void> => {
    let schema = 新schema()
    await 造缺向量数据(schema)
    let 实例 = 开实例(schema, 'on')
    let 配置 = 构建智能体配置({
      向量模型: { 类型: '在线', openai客户端: 假.客户端, 模型名称: 'fake', 维度: 4 },
      向量召回相似度阈值: 0.5,
      只读模式: true,
    }).配置
    let 查询器 = new Kysely<记忆数据库>({ dialect: new 带互斥的PGlite方言(async () => pglite, schema) })
    let 工具 = 查询记忆工具({
      配置,
      数据库查询器: 查询器,
      获取向量: async (内容: string): Promise<number[] | null> => {
        let 结果 = await 获取向量(配置.向量模型, 内容)
        return 结果.类型 === '成功' ? 结果.向量 : null
      },
    })
    let 查 = async (): Promise<string[]> => {
      let 结果 = (await 工具.实现({ 内容: ['喜欢喝燕麦拿铁'], 完整记忆数量: 5, 线索来源数量: 5 }, {})) as {
        完整记忆?: { 内容: string }[]
      }
      return (结果.完整记忆 ?? []).map((记忆) => 记忆.内容)
    }
    expect(await 查()).toEqual([])
    await 实例.补算缺失向量({ 单次上限: 1000 })
    expect(await 查()).toContain('喜欢喝燕麦拿铁')
  })

  it('没配向量模型：直接返回 0，不扫表也不请求', async (): Promise<void> => {
    let schema = 新schema()
    let 无向量 = await 造缺向量数据(schema)
    expect(await 无向量.补算缺失向量()).toEqual({ 已补算数: 0, 剩余数: 0, 失败数: 0 })
    expect(假.请求文本.length).toBe(0)
    expect((await 缺失计数(schema))['当前记忆表']).toBe(2)
  })

  it('只读模式报错；非法上限报错', async (): Promise<void> => {
    let schema = 新schema()
    await 造缺向量数据(schema)
    let 只读 = 开实例(schema, 'on', true)
    await expect(只读.补算缺失向量()).rejects.toThrow(/只读模式/)
    let 实例 = 开实例(schema, 'on')
    for (let 非法 of [0, -1, 1.5, Number.NaN]) {
      await expect(实例.补算缺失向量({ 单次上限: 非法 })).rejects.toThrow(/单次上限/)
    }
  })

  it('事务内不请求向量：所有请求都发生在事务外的预取阶段', async (): Promise<void> => {
    let schema = 新schema()
    await 造缺向量数据(schema)
    let 实例 = 开实例(schema, 'on')
    await 实例.补算缺失向量({ 单次上限: 1000 })
    // 12 行去重后的文本数：记忆2 + 线索4 + 记忆关联3 + 技能1 + 技能关联2
    expect(new Set(假.请求文本).size).toBe(假.请求文本.length)
    expect(假.请求文本.length).toBe(12)
  })
})
