import { sql, type Kysely } from 'kysely'
import type { 记忆数据库, 记忆等级 } from '../types'
import type { 向量补算依赖 } from './vector-backfill'
import { 统计缺失向量数 } from './vector-backfill'

export type 向量状态记忆项 = {
  id: string
  等级: 记忆等级
  创建时间: Date
  有向量: boolean
  /** 这条记忆的记忆线索关联行总数。 */
  关联总数: number
  /** 其中向量为 NULL 的关联行数。 */
  关联缺失数: number
}

export type 向量状态线索项 = {
  id: string
  有向量: boolean
  /** 这条线索被多少条「记忆线索关联」与「技能线索关联」引用（两张关联表的行数之和）。 */
  使用次数: number
}

export type 向量状态统计 = {
  记忆数: number
  线索数: number
  /** 与 补算缺失向量 的 剩余数 同口径：记忆、线索、记忆线索关联、技能、技能线索关联五张表中 向量 IS NULL 的行数合计，不含消息表。 */
  缺失数: number
}

/** 只含状态，不含记忆内容、线索文字，也不含向量本身。 */
export type 向量状态结果 = {
  记忆: 向量状态记忆项[]
  线索: 向量状态线索项[]
  统计: 向量状态统计
}

async function 统计行数(数据库查询器: Kysely<记忆数据库>, 表名: '当前记忆表' | '当前线索表'): Promise<number> {
  let 行 = await 数据库查询器
    .selectFrom(表名)
    .select((eb) => eb.fn.countAll<string>().as('数量'))
    .executeTakeFirst()
  return Number(行?.数量 ?? 0)
}

export async function 统计向量状态(依赖: 向量补算依赖): Promise<向量状态统计> {
  await 依赖.确保已初始化()
  let { 数据库查询器 } = 依赖
  return {
    记忆数: await 统计行数(数据库查询器, '当前记忆表'),
    线索数: await 统计行数(数据库查询器, '当前线索表'),
    缺失数: await 统计缺失向量数(数据库查询器),
  }
}

export async function 读取向量状态(依赖: 向量补算依赖): Promise<向量状态结果> {
  await 依赖.确保已初始化()
  let { 数据库查询器 } = 依赖

  let 关联汇总 = await 数据库查询器
    .selectFrom('当前记忆线索关联表')
    .select([
      '记忆id',
      sql<string>`count(*)`.as('总数'),
      sql<string>`count(*) filter (where 向量 is null)`.as('缺失数'),
    ])
    .groupBy('记忆id')
    .execute()
  let 关联映射 = new Map<string, { 总数: number; 缺失数: number }>()
  for (let 行 of 关联汇总) 关联映射.set(行.记忆id, { 总数: Number(行.总数), 缺失数: Number(行.缺失数) })

  let 记忆行 = await 数据库查询器
    .selectFrom('当前记忆表')
    .select(['id', '等级', '创建时间', sql<boolean>`向量 is not null`.as('有向量')])
    .orderBy('创建序号')
    .orderBy('id')
    .execute()
  let 记忆: 向量状态记忆项[] = 记忆行.map((行): 向量状态记忆项 => ({
    id: 行.id,
    等级: 行.等级,
    创建时间: new Date(行.创建时间),
    有向量: 行.有向量,
    关联总数: 关联映射.get(行.id)?.总数 ?? 0,
    关联缺失数: 关联映射.get(行.id)?.缺失数 ?? 0,
  }))

  let 使用映射 = new Map<string, number>()
  let 记忆使用 = await 数据库查询器
    .selectFrom('当前记忆线索关联表')
    .select(['线索id', sql<string>`count(*)`.as('数量')])
    .groupBy('线索id')
    .execute()
  let 技能使用 = await 数据库查询器
    .selectFrom('当前技能线索关联表')
    .select(['线索id', sql<string>`count(*)`.as('数量')])
    .groupBy('线索id')
    .execute()
  for (let 行 of [...记忆使用, ...技能使用]) 使用映射.set(行.线索id, (使用映射.get(行.线索id) ?? 0) + Number(行.数量))

  let 线索行 = await 数据库查询器
    .selectFrom('当前线索表')
    .select(['id', sql<boolean>`向量 is not null`.as('有向量')])
    .orderBy('创建时间')
    .orderBy('id')
    .execute()
  let 线索: 向量状态线索项[] = 线索行.map((行): 向量状态线索项 => ({
    id: 行.id,
    有向量: 行.有向量,
    使用次数: 使用映射.get(行.id) ?? 0,
  }))

  return { 记忆, 线索, 统计: await 统计向量状态(依赖) }
}
