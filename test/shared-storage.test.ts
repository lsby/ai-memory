import type { PGlite } from '@electric-sql/pglite'
import OpenAI from 'openai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { 删除记忆空间, 带记忆的智能体, 记忆等级, type 批量注入记忆项 } from '../src/index'
import { 创建假向量客户端, 创建带向量的PGlite, 等待, 限时, type 假向量请求记录 } from './helpers/shared-storage-helper'

let 流式请求AI模拟 = vi.hoisted(() => vi.fn())

vi.mock('../src/agent/stream-request', () => ({ 流式请求AI: 流式请求AI模拟 }))

function 记忆项(内容: string, 关键词: string[] = [内容], 等级: 记忆等级 = 记忆等级.二级): 批量注入记忆项 {
  return { 内容, 关键词, 标签: [], 评分: 80, 等级, 创建时间: new Date('2026-01-01T00:00:00.000Z') }
}

async function 统计行数(pglite: PGlite, schema: string, 表: string): Promise<number> {
  let 结果 = await pglite.query<{ 数量: number }>(`SELECT count(*)::int AS 数量 FROM "${schema}"."${表}"`)
  return 结果.rows[0]?.数量 ?? 0
}

describe('共用一个 PGlite 的多 schema 并发', { timeout: 90000 }, () => {
  let pglite: PGlite
  let 智能体列表: 带记忆的智能体[] = []

  function 创建实例(
    schema: string,
    额外选项: Partial<ConstructorParameters<typeof 带记忆的智能体>[0]> = {},
  ): 带记忆的智能体 {
    let 实例 = new 带记忆的智能体({
      存储: { 模式: '外部', pglite, schema },
      向量模型: { 类型: '无' },
      ...额外选项,
    })
    智能体列表.push(实例)
    return 实例
  }

  beforeEach((): void => {
    pglite = 创建带向量的PGlite()
    流式请求AI模拟.mockReset()
  })

  afterEach(async (): Promise<void> => {
    for (let 实例 of 智能体列表) await 实例.销毁()
    智能体列表 = []
    await pglite.close()
  })

  it('多个 schema、多个实例同时读、写、执行对话，数据不串也不卡死', async (): Promise<void> => {
    流式请求AI模拟.mockImplementation(async (_客户端, _模型, 消息列表: { role: string; content?: unknown }[]) => {
      let 已有工具结果 = 消息列表.some((消息) => 消息.role === 'tool')
      if (已有工具结果) return { 完整文本: '{"完成":true}', 工具调用列表: [], 已中断: false }
      let 命令消息 = 消息列表.findLast(
        (消息) => 消息.role === 'user' && typeof 消息.content === 'string' && 消息.content.startsWith('写入:'),
      )
      let 标签 = typeof 命令消息?.content === 'string' ? 命令消息.content.slice('写入:'.length) : '未知'
      await 等待(20)
      return {
        完整文本: '',
        工具调用列表: [
          {
            id: `call_${标签}`,
            名称: 'add_level_1_memory',
            参数片段: JSON.stringify({ 内容: `对话写入-${标签}`, 关键词: [标签], 标签: [], 评分: 70 }),
          },
        ],
        已中断: false,
      }
    })

    let 名称列表 = ['u_a', 'u_b', 'u_c', 'u_d', 'u_e', 'u_f']
    let 实例表 = 名称列表.map((名称) => ({ 名称, 实例: 创建实例(名称, { 一级记忆容量: 100 }) }))
    await 限时(Promise.all(实例表.map(async (项) => await 项.实例.初始化())), 60000, '多 schema 并发初始化')

    let 任务列表: Promise<unknown>[] = []
    for (let { 名称, 实例 } of 实例表) {
      for (let i = 0; i < 6; i++) {
        任务列表.push(实例.添加记忆(记忆项(`${名称}-记忆-${String(i)}`, [名称, `词${String(i)}`], 记忆等级.一级)))
      }
      任务列表.push(
        实例.对话({
          命令: `写入:${名称}`,
          预期结果Schema: z.object({ 完成: z.boolean() }),
          预期结果描述: '是否完成',
          回调: async (): Promise<void> => {},
          openai客户端: new OpenAI({ apiKey: 'test' }),
          模型名称: 'mock',
          是否自动召回: false,
        }),
      )
      // 读和写交错
      for (let i = 0; i < 4; i++) 任务列表.push(实例.查询记忆())
    }
    await 限时(Promise.all(任务列表), 60000, '多 schema 并发读写与对话')

    for (let { 名称, 实例 } of 实例表) {
      let 记忆列表 = await 实例.查询记忆()
      // 6 条直接写入 + 1 条对话工具写入
      expect(记忆列表).toHaveLength(7)
      for (let 记忆 of 记忆列表) {
        expect(记忆.内容 === `对话写入-${名称}` || 记忆.内容.startsWith(`${名称}-记忆-`)).toBe(true)
      }
    }
  })

  it('事务进行中，别的实例的普通查询要等事务结束，不会跑进这个事务', async (): Promise<void> => {
    let 写入实例 = 创建实例('same_space')
    let 读取实例 = 创建实例('same_space')
    await 写入实例.初始化()
    await 读取实例.初始化()

    let 放行: () => void = () => {}
    let 闸门 = new Promise<void>((resolve) => {
      放行 = resolve
    })
    let 状态 = { 已进入事务: false, 读取已完成: false }
    let 写入任务 = 写入实例.批量注入记忆(
      [记忆项('事务里的第一条', ['共同词']), 记忆项('事务里的第二条', ['共同词'])],
      async (): Promise<void> => {
        // 关联网络的事件是在事务里、数据已插入之后发出的；这里把事务卡住，最后让它失败回滚
        状态.已进入事务 = true
        await 闸门
        throw new Error('故意失败，让事务回滚')
      },
    )
    写入任务.catch((): void => {})

    await 限时(
      (async (): Promise<void> => {
        while (状态.已进入事务 === false) await 等待(10)
      })(),
      20000,
      '等待事务开始',
    )

    let 读取任务 = 读取实例.查询记忆().then((结果) => {
      状态.读取已完成 = true
      return 结果
    })
    await 等待(300)
    expect(状态.读取已完成).toBe(false)

    放行()
    await expect(写入任务).rejects.toThrow('故意失败')
    // 事务已回滚：读到的不应该是事务里未提交的数据
    expect(await 限时(读取任务, 20000, '事务结束后的读取')).toEqual([])
  })

  it('两个 schema 各自建表成功，遗忘只影响本 schema', async (): Promise<void> => {
    let 严格实例 = 创建实例('forget_a', { 二级记忆数量上限: 1 })
    let 宽松实例 = 创建实例('forget_b', { 二级记忆数量上限: 100 })
    await 限时(Promise.all([严格实例.初始化(), 宽松实例.初始化()]), 60000, '初始化两个 schema')

    for (let schema of ['forget_a', 'forget_b']) {
      let 表 = await pglite.query<{ 表名: string }>(
        `SELECT table_name AS 表名 FROM information_schema.tables WHERE table_schema = $1 AND table_name = '记忆表'`,
        [schema],
      )
      expect(表.rows).toHaveLength(1)
      let 枚举 = await pglite.query(
        `SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = '记忆等级枚举' AND n.nspname = $1`,
        [schema],
      )
      expect(枚举.rows).toHaveLength(1)
    }
    let public中的表 = await pglite.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '记忆表'`,
    )
    expect(public中的表.rows).toHaveLength(0)

    for (let i = 0; i < 3; i++) {
      await 严格实例.添加记忆(记忆项(`严格-${String(i)}`, [`严格词${String(i)}`]))
      await 宽松实例.添加记忆(记忆项(`宽松-${String(i)}`, [`宽松词${String(i)}`]))
    }
    expect(await 严格实例.查询记忆()).toHaveLength(1)
    expect(await 宽松实例.查询记忆()).toHaveLength(3)
    // 遗忘用的自增序号是各 schema 各自的
    expect(await 统计行数(pglite, 'forget_b', '记忆表')).toBe(3)
  })

  it('删除记忆空间只删本 schema，不影响别的 schema 和 vector 扩展', async (): Promise<void> => {
    let 实例甲 = 创建实例('drop_a')
    let 实例乙 = 创建实例('drop_b')
    await 实例甲.添加记忆(记忆项('甲的记忆'))
    await 实例乙.添加记忆(记忆项('乙的记忆'))

    await 实例甲.销毁()
    await 删除记忆空间(pglite, 'drop_a')

    let 剩余schema = await pglite.query<{ 名称: string }>(
      `SELECT schema_name AS 名称 FROM information_schema.schemata WHERE schema_name IN ('drop_a', 'drop_b')`,
    )
    expect(剩余schema.rows.map((行) => 行.名称)).toEqual(['drop_b'])
    expect(await 实例乙.查询记忆()).toMatchObject([{ 内容: '乙的记忆' }])
    // 外部句柄没有被销毁，vector 扩展还在
    expect(pglite.closed).toBe(false)
    let 向量结果 = await pglite.query<{ 值: string }>(`SELECT '[1,2]'::vector::text AS 值`)
    expect(向量结果.rows[0]?.值).toBe('[1,2]')
  })

  it('删除记忆空间拒绝 public 和非法名称，带引号的名称被安全转义', async (): Promise<void> => {
    await expect(删除记忆空间(pglite, 'public')).rejects.toThrow('public')
    await expect(删除记忆空间(pglite, '')).rejects.toThrow('不能为空')
    await expect(删除记忆空间(pglite, 'pg_catalog')).rejects.toThrow('pg_')
    expect(() => new 带记忆的智能体({ 存储: { 模式: '外部', pglite, schema: 'pg_temp_x' } })).toThrow('pg_')

    let 旁观实例 = 创建实例('bystander')
    await 旁观实例.添加记忆(记忆项('旁观者'))
    let 古怪名称 = 'x"; DROP SCHEMA bystander CASCADE; --'
    let 古怪实例 = 创建实例(古怪名称)
    await 古怪实例.添加记忆(记忆项('古怪名称下的记忆'))
    expect(await 古怪实例.查询记忆()).toMatchObject([{ 内容: '古怪名称下的记忆' }])
    await 古怪实例.销毁()
    await 删除记忆空间(pglite, 古怪名称)
    expect(await 旁观实例.查询记忆()).toMatchObject([{ 内容: '旁观者' }])
  })

  it('外部句柄模式下销毁实例不会关闭句柄，search_path 也不会留在 schema 上', async (): Promise<void> => {
    let 实例 = 创建实例('keep_open')
    await 实例.添加记忆(记忆项('一条'))
    let 路径 = await pglite.query<{ search_path: string }>('SHOW search_path')
    expect(路径.rows[0]?.search_path).not.toContain('keep_open')
    await 实例.销毁()
    expect(pglite.closed).toBe(false)
    expect((await pglite.query('SELECT 1')).rows).toHaveLength(1)
  })

  it('向量在事务外计算：慢的向量请求期间，其他 schema 的读写不被拖住', async (): Promise<void> => {
    let 记录: 假向量请求记录[] = []
    let 客户端 = 创建假向量客户端({
      延迟毫秒: (文本) => (文本.includes('很慢') ? 2000 : 0),
      探测句柄: pglite,
      记录,
    })
    let 向量模型 = { 类型: '在线' as const, openai客户端: 客户端, 模型名称: 'fake' }
    let 慢实例 = 创建实例('slow_a', { 向量模型 })
    let 快实例 = 创建实例('fast_b', { 向量模型 })
    await 限时(Promise.all([慢实例.初始化(), 快实例.初始化()]), 60000, '初始化')

    let 慢开始 = Date.now()
    let 慢任务 = 慢实例.添加记忆(记忆项('这条记忆的向量很慢'))
    await 等待(200)

    let 快开始 = Date.now()
    await 限时(快实例.添加记忆(记忆项('快速的一条')), 1500, '慢向量期间别的 schema 写入')
    await 限时(快实例.查询记忆(), 1500, '慢向量期间别的 schema 读取')
    await 限时(慢实例.查询记忆(), 1500, '慢向量期间同 schema 的读取也不应被拖住')
    let 快耗时 = Date.now() - 快开始
    expect(快耗时).toBeLessThan(1500)

    await 限时(慢任务, 20000, '慢向量任务')
    expect(Date.now() - 慢开始).toBeGreaterThanOrEqual(1900)
    // 每次发起向量请求时，PGlite 都没有被事务占着
    expect(记录.length).toBeGreaterThanOrEqual(2)
    expect(记录.filter((项) => 项.句柄被占用)).toEqual([])

    let 向量维度 = await pglite.query<{ 维度: number | null }>(`SELECT 向量维度 AS 维度 FROM "slow_a"."记忆表"`)
    expect(向量维度.rows[0]?.维度).toBe(4)
  })

  it('通过工具调用写记忆时，向量也在事务外先算好', async (): Promise<void> => {
    let 记录: 假向量请求记录[] = []
    let 客户端 = 创建假向量客户端({ 延迟毫秒: () => 100, 探测句柄: pglite, 记录 })
    流式请求AI模拟.mockImplementation(async (_客户端, _模型, 消息列表: { role: string }[]) => {
      if (消息列表.some((消息) => 消息.role === 'tool')) {
        return { 完整文本: '{"完成":true}', 工具调用列表: [], 已中断: false }
      }
      return {
        完整文本: '',
        工具调用列表: [
          {
            id: 'call_1',
            名称: 'add_level_2_memory',
            参数片段: JSON.stringify({ 内容: '工具写入的二级记忆', 关键词: ['工具'], 标签: [], 评分: 60 }),
          },
        ],
        已中断: false,
      }
    })
    let 实例 = 创建实例('tool_vec', { 向量模型: { 类型: '在线', openai客户端: 客户端, 模型名称: 'fake' } })
    await 实例.对话({
      命令: '写一条',
      预期结果Schema: z.object({ 完成: z.boolean() }),
      预期结果描述: '是否完成',
      回调: async (): Promise<void> => {},
      openai客户端: new OpenAI({ apiKey: 'test' }),
      模型名称: 'mock',
      是否自动召回: true,
    })

    expect(记录.map((项) => 项.文本)).toContain('工具写入的二级记忆')
    expect(记录.filter((项) => 项.句柄被占用)).toEqual([])
    let 行 = await pglite.query<{ 维度: number | null }>(`SELECT 向量维度 AS 维度 FROM "tool_vec"."记忆表"`)
    expect(行.rows.map((项) => 项.维度)).toEqual([4])
  })
})
