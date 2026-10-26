import type { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { 交互日志事件Schema, 带记忆的智能体, 记忆等级 } from '../../../src/index'
import { 使用共享PGlite } from '../../helpers/shared-pglite-fixture'
import { 创建带向量的PGlite } from '../../helpers/shared-storage-helper'

describe('交互事件日志', () => {
  let 夹具 = 使用共享PGlite()
  let 智能体实例: 带记忆的智能体 | undefined

  afterEach(async (): Promise<void> => {
    if (智能体实例 !== undefined) {
      await 智能体实例.销毁()
      智能体实例 = undefined
    }
  })

  it('允许调用方写入联合类型事件并自动生成事件组 ID', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体()
    let 开始时间 = new Date('2026-01-01T00:00:00.000Z')
    let 写入结果 = await 智能体实例.记录交互日志({
      类型: '自定义',
      开始时间,
      耗时ms: 12,
      内容: { 任意字段: ['由调用方', 1, true, null] },
    })

    let 查询结果 = await 智能体实例.查询交互日志({ 事件组id: 写入结果.事件组id })
    expect(查询结果).toEqual([写入结果])
    expect(查询结果[0]).toMatchObject({ 类型: '自定义', 耗时ms: 12, 内容: { 任意字段: ['由调用方', 1, true, null] } })
    expect(() => 交互日志事件Schema.parse({ 类型: '未设计事件', 开始时间, 内容: {} })).toThrow()
  })

  it('记忆变更和提交日志使用调用方指定的同一个事件组', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体()
    await 智能体实例.添加记忆(
      {
        内容: '遥测测试记忆',
        关键词: ['遥测'],
        标签: [],
        评分: 80,
        等级: 记忆等级.一级,
        创建时间: new Date('2026-01-01T00:00:00.000Z'),
      },
      undefined,
      'memory-group',
    )

    let 日志列表 = await 智能体实例.查询交互日志({ 事件组id: 'memory-group' })
    expect(日志列表.map((日志) => 日志.类型)).toEqual(['流程开始', '记忆提交', '流程结束'])
    expect(日志列表[1]?.内容).toMatchObject({ 消息: '添加记忆' })
  })

  it('支持按事件类型筛选并严格按序号返回', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体()
    let 开始时间 = new Date('2026-01-01T00:00:00.000Z')
    await 智能体实例.记录交互日志({ 类型: '流程开始', 开始时间, 内容: { 次序: 1 } }, 'ordered-group')
    await 智能体实例.记录交互日志({ 类型: '流程结束', 开始时间, 耗时ms: 1, 内容: { 次序: 2 } }, 'ordered-group')

    let 全部 = await 智能体实例.查询交互日志({ 事件组id: 'ordered-group' })
    let 结束 = await 智能体实例.查询交互日志({ 事件组id: 'ordered-group', 类型: '流程结束' })
    expect(全部.map((日志) => 日志.内容)).toEqual([{ 次序: 1 }, { 次序: 2 }])
    expect(结束).toHaveLength(1)
    expect(结束[0]?.类型).toBe('流程结束')
  })

  it('支持分页并拒绝无效的查询条件', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体()
    let 开始时间 = new Date('2026-01-01T00:00:00.000Z')
    await 智能体实例.记录交互日志({ 类型: '自定义', 开始时间, 内容: { 次序: 1 } }, 'page-group')
    await 智能体实例.记录交互日志({ 类型: '自定义', 开始时间, 内容: { 次序: 2 } }, 'page-group')
    await 智能体实例.记录交互日志({ 类型: '自定义', 开始时间, 内容: { 次序: 3 } }, 'page-group')

    let 第二页 = await 智能体实例.查询交互日志({ 事件组id: 'page-group', 偏移: 1, 数量: 1 })
    expect(第二页.map((日志) => 日志.内容)).toEqual([{ 次序: 2 }])
    await expect(智能体实例.查询交互日志({ 偏移: -1 })).rejects.toThrow()
    await expect(智能体实例.查询交互日志({ 数量: 1001 })).rejects.toThrow()
    await expect(智能体实例.查询交互日志({ 事件组id: '   ' })).rejects.toThrow()
  })

  it('分支切换事件记录请求、结果和切换后的 HEAD', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体()
    let 记忆 = await 智能体实例.添加记忆({
      内容: '分支日志基线',
      关键词: ['分支'],
      标签: [],
      评分: 80,
      等级: 记忆等级.一级,
      创建时间: new Date('2026-01-01T00:00:00.000Z'),
    })
    let 基线提交id = await 智能体实例.查询当前记忆提交id()
    await 智能体实例.更新记忆(记忆.id, { 内容: '另一分支' })
    if (基线提交id === null) throw new Error('基线提交未生成')

    expect(await 智能体实例.切换记忆提交(基线提交id, 'branch-group')).toBe(true)

    let 日志列表 = await 智能体实例.查询交互日志({ 事件组id: 'branch-group' })
    expect(日志列表.map((日志) => 日志.类型)).toEqual(['流程开始', '记忆分支切换', '流程结束'])
    expect(日志列表[1]?.内容).toEqual({ 请求: { 目标提交id: 基线提交id }, 结果: true, 当前提交id: 基线提交id })
  })

  it('编程调用动态工具时记录同组的开始和结果事件', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体()
    let 注册结果 = await 智能体实例.注册动态工具(
      `tool = {
  name: 'telemetry_echo',
  description: '返回输入值',
  parametersSchema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] },
  returnSchema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] },
  execute: async function(args) { return { value: args.value }; }
}`,
      '{"value":7}',
    )
    expect(注册结果.结果).toBe('成功')

    let 调用结果 = await 智能体实例.调用动态工具('telemetry_echo', '{"value":7}', undefined, 'tool-group')
    expect(调用结果.结果).toBe('成功')
    let 日志列表 = await 智能体实例.查询交互日志({ 事件组id: 'tool-group' })
    expect(日志列表.map((日志) => 日志.类型)).toEqual(['工具调用开始', '工具调用结果'])
    expect(日志列表[0]?.内容).toEqual({ 工具名称: 'telemetry_echo' })
    expect(日志列表[1]?.内容).toEqual({ 工具名称: 'telemetry_echo', 状态: '成功' })
  })

  it('记忆操作失败时同一事务里的日志也会回滚', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体()
    await expect(智能体实例.载入快照('{不是合法快照}', 'rollback-group')).rejects.toThrow()
    expect(await 智能体实例.查询交互日志({ 事件组id: 'rollback-group' })).toEqual([])
  })
})

let 标记Schema = z.object({ 标记: z.string() })

describe('交互日志按开始时间过滤', () => {
  let 夹具 = 使用共享PGlite()
  let 智能体实例: 带记忆的智能体 | undefined
  let 零点 = (日: number): Date => new Date(Date.UTC(2026, 0, 日, 0, 0, 0, 0))

  afterEach(async (): Promise<void> => {
    if (智能体实例 !== undefined) {
      await 智能体实例.销毁()
      智能体实例 = undefined
    }
  })

  async function 写入三天(实例: 带记忆的智能体, 事件组id: string): Promise<void> {
    // 故意乱序写入，序号顺序与时间顺序不同
    await 实例.记录交互日志({ 类型: '自定义', 开始时间: 零点(2), 内容: { 标记: 'd2-0点' } }, 事件组id)
    await 实例.记录交互日志({ 类型: '流程开始', 开始时间: 零点(1), 内容: { 标记: 'd1-0点' } }, 事件组id)
    await 实例.记录交互日志(
      { 类型: '自定义', 开始时间: new Date(零点(2).getTime() - 1), 内容: { 标记: 'd1-末' } },
      事件组id,
    )
    await 实例.记录交互日志({ 类型: '自定义', 开始时间: 零点(3), 内容: { 标记: 'd3-0点' } }, 事件组id)
  }

  function 标记(日志列表: { 内容: unknown }[]): unknown[] {
    return 日志列表.map((日志) => 标记Schema.parse(日志.内容).标记)
  }

  it('起包含、止不包含，起止组合按天切分', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体()
    await 写入三天(智能体实例, 'time-group')
    expect(标记(await 智能体实例.查询交互日志({ 开始时间起: 零点(2) }))).toEqual(['d2-0点', 'd3-0点'])
    expect(标记(await 智能体实例.查询交互日志({ 开始时间止: 零点(2) }))).toEqual(['d1-0点', 'd1-末'])
    expect(标记(await 智能体实例.查询交互日志({ 开始时间起: 零点(1), 开始时间止: 零点(2) }))).toEqual([
      'd1-0点',
      'd1-末',
    ])
    expect(标记(await 智能体实例.查询交互日志({ 开始时间起: 零点(2), 开始时间止: 零点(3) }))).toEqual(['d2-0点'])
  })

  it('和事件组id、类型组合过滤，分页在过滤之后生效', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体()
    await 写入三天(智能体实例, 'time-group')
    await 智能体实例.记录交互日志({ 类型: '自定义', 开始时间: 零点(2), 内容: { 标记: '别的组' } }, 'other-group')
    let 区间 = { 开始时间起: 零点(1), 开始时间止: 零点(3) }
    expect(标记(await 智能体实例.查询交互日志({ ...区间, 事件组id: 'time-group' }))).toEqual([
      'd2-0点',
      'd1-0点',
      'd1-末',
    ])
    expect(标记(await 智能体实例.查询交互日志({ ...区间, 事件组id: 'time-group', 类型: '自定义' }))).toEqual([
      'd2-0点',
      'd1-末',
    ])
    expect(标记(await 智能体实例.查询交互日志({ ...区间, 事件组id: 'time-group', 偏移: 1, 数量: 1 }))).toEqual([
      'd1-0点',
    ])
    expect(标记(await 智能体实例.查询交互日志({ ...区间, 事件组id: 'time-group', 偏移: 3 }))).toEqual([])
  })

  it('起不早于止或日期无效时报错', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体()
    await expect(智能体实例.查询交互日志({ 开始时间起: 零点(2), 开始时间止: 零点(2) })).rejects.toThrow()
    await expect(智能体实例.查询交互日志({ 开始时间起: 零点(3), 开始时间止: 零点(2) })).rejects.toThrow()
    await expect(智能体实例.查询交互日志({ 开始时间起: new Date('不是日期') })).rejects.toThrow()
    await expect(智能体实例.查询交互日志({ 开始时间止: new Date(Number.NaN) })).rejects.toThrow()
  })
})

describe('交互日志开始时间过滤在外部存储模式下', { timeout: 60000 }, () => {
  let pglite: PGlite
  let 实例列表: 带记忆的智能体[] = []

  beforeEach((): void => {
    pglite = 创建带向量的PGlite()
  })

  afterEach(async (): Promise<void> => {
    for (let 实例 of 实例列表) await 实例.销毁()
    实例列表 = []
    await pglite.close()
  })

  function 创建实例(schema: string): 带记忆的智能体 {
    let 实例 = new 带记忆的智能体({ 存储: { 模式: '外部', pglite, schema }, 向量模型: { 类型: '无' } })
    实例列表.push(实例)
    return 实例
  }

  async function 索引数量(schema: string): Promise<number> {
    let 结果 = await pglite.query(
      `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND tablename = '交互日志表' AND indexname = '交互日志表_开始时间_idx'`,
      [schema],
    )
    return 结果.rows.length
  }

  it('两个 schema 的过滤结果互不串数据', async (): Promise<void> => {
    let 甲 = 创建实例('log_a')
    let 乙 = 创建实例('log_b')
    let 时间 = new Date('2026-01-01T12:00:00.000Z')
    await 甲.记录交互日志({ 类型: '自定义', 开始时间: 时间, 内容: { 来自: '甲' } })
    await 乙.记录交互日志({ 类型: '自定义', 开始时间: 时间, 内容: { 来自: '乙' } })
    let 区间 = { 开始时间起: new Date('2026-01-01T00:00:00.000Z'), 开始时间止: new Date('2026-01-02T00:00:00.000Z') }
    expect((await 甲.查询交互日志(区间)).map((日志) => 日志.内容)).toEqual([{ 来自: '甲' }])
    expect((await 乙.查询交互日志(区间)).map((日志) => 日志.内容)).toEqual([{ 来自: '乙' }])
  })

  it('开始时间索引存在，删掉后重新打开实例会补回', async (): Promise<void> => {
    let 实例 = 创建实例('log_idx')
    await 实例.初始化()
    expect(await 索引数量('log_idx')).toBe(1)
    await 实例.销毁()
    实例列表 = []
    await pglite.exec(`DROP INDEX "log_idx"."交互日志表_开始时间_idx"`)
    expect(await 索引数量('log_idx')).toBe(0)
    await 创建实例('log_idx').初始化()
    expect(await 索引数量('log_idx')).toBe(1)
  })
})
