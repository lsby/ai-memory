import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { randomUUID } from 'node:crypto'
import type { 智能体事件 } from '../agent/types'
import {
  记忆等级,
  type 内部带记忆的智能体配置,
  type 批量注入记忆项,
  type 记忆操作上下文,
  type 记忆数据库,
} from './agent-memory-types'
import { 刷新记忆关联网络, 确保在事务中执行 } from './tools/common'
import { 增量排版 } from './tools/layout'

export async function 检查并降级一级记忆(
  数据库查询器: Kysely<记忆数据库>,
  配置: 内部带记忆的智能体配置,
  检查并清理二级记忆回调: (回调?: (事件: 智能体事件) => Promise<void>) => Promise<void>,
  回调?: (事件: 智能体事件) => Promise<void>,
): Promise<void> {
  let 上限 = 配置.一级记忆容量
  let 现有一级 = await 数据库查询器.selectFrom('记忆表').selectAll().where('等级', '=', 记忆等级.一级).execute()
  if (现有一级.length > 上限) {
    现有一级.sort((a, b) => {
      if (a.评分 !== b.评分) return a.评分 - b.评分
      return a.创建时间.getTime() - b.创建时间.getTime()
    })
    let 要降级的数量 = 现有一级.length - 上限
    let 要降级的 = 现有一级.slice(0, 要降级的数量)
    let 要降级的IDs = 要降级的.map((x) => x.id)
    await 数据库查询器.updateTable('记忆表').set({ 等级: 记忆等级.二级 }).where('id', 'in', 要降级的IDs).execute()

    if (回调 !== undefined) {
      await 回调({
        类型: '流程信息',
        内容: `[自动降级] 工作区已满，已将 ${String(要降级的数量)} 条低分记忆移至二级潜意识 (淘汰ID: ${要降级的IDs.join(', ')})`,
      })
    }

    await 检查并清理二级记忆回调(回调)
  }
}

export async function 检查并清理二级记忆(
  数据库查询器: Kysely<记忆数据库>,
  配置: 内部带记忆的智能体配置,
  回调?: (事件: 智能体事件) => Promise<void>,
): Promise<void> {
  let 遗忘分数阈值 = 配置.二级记忆遗忘分数阈值
  let 兜底上限 = 配置.二级记忆数量上限

  let 现有二级数量结果 = await 数据库查询器
    .selectFrom('记忆表')
    .select((eb) => eb.fn.count<number>('id').as('数量'))
    .where('等级', '=', 记忆等级.二级)
    .executeTakeFirst()

  let 现有数量 = Number(现有二级数量结果?.数量 ?? 0)

  let 最大序号结果 = await 数据库查询器
    .selectFrom('记忆表')
    .select((eb) => eb.fn.max<number>('创建序号').as('最大序号'))
    .executeTakeFirst()
  let 当前最大序号 = Number(最大序号结果?.最大序号 ?? 0)

  let 衰减常数k = 配置.二级记忆衰减常数k
  let 访问次数上限 = 配置.二级记忆访问次数上限

  // 计算所有二级记忆的保留指数
  // 将传统的基于物理时间的艾宾浩斯遗忘曲线，改造为基于"信息量冲刷 (Information Displacement)"的衰减模型。
  // 使用 (当前最大序号 - m.最后访问序号) 代表"自从上次访问以来，智能体经历的新记忆数量"。
  // 使用 LN(1.0 + LEAST(m.访问次数, 访问次数上限)) 来模拟记忆巩固的边际递减效应，并防止极端异常。
  let 淘汰结果 = await sql<{ id: string; 保留指数: number }>`
    WITH 关联度汇总 AS (
      SELECT
        m.id,
        COALESCE(SUM(r.关联度), 0) AS 总关联度
      FROM 记忆表 m
      LEFT JOIN 记忆关联表 r ON (r.起点id = m.id OR r.终点id = m.id)
      WHERE m.等级 = '二级'
      GROUP BY m.id
    )
    SELECT
      m.id,
      (m.评分 + c.总关联度) * EXP(- (${衰减常数k}::float8 * GREATEST(0, ${当前最大序号}::int - m.最后访问序号)) / (1.0 + LN(1.0 + LEAST(m.访问次数, ${访问次数上限}::int)))) AS 保留指数
    FROM 记忆表 m
    JOIN 关联度汇总 c ON m.id = c.id
    WHERE m.等级 = '二级'
  `.execute(数据库查询器)

  let 要淘汰的IDs: string[] = []

  // 1. 阈值自然遗忘：找出保留指数低于阈值的记忆
  let 低于阈值IDs = 淘汰结果.rows.filter((r) => r.保留指数 < 遗忘分数阈值).map((r) => r.id)
  要淘汰的IDs.push(...低于阈值IDs)

  // 2. 兜底防爆：如果自然遗忘后，剩余数量依然超过兜底上限，触发末位淘汰
  let 剩余数量 = 现有数量 - 要淘汰的IDs.length
  if (剩余数量 > 兜底上限) {
    let 还需要淘汰的数量 = 剩余数量 - 兜底上限
    let 剩余行 = 淘汰结果.rows.filter((r) => r.保留指数 >= 遗忘分数阈值)
    // 按保留指数升序排序，取分数最低的 N 条
    剩余行.sort((a, b) => a.保留指数 - b.保留指数)
    let 兜底淘汰IDs = 剩余行.slice(0, 还需要淘汰的数量).map((r) => r.id)
    要淘汰的IDs.push(...兜底淘汰IDs)
  }

  if (要淘汰的IDs.length > 0) {
    await 确保在事务中执行(数据库查询器, async (trx) => {
      // 先删除关联的边
      await trx
        .deleteFrom('记忆关联表')
        .where((eb) => eb.or([eb('起点id', 'in', 要淘汰的IDs), eb('终点id', 'in', 要淘汰的IDs)]))
        .execute()

      // 再删除记忆
      await trx.deleteFrom('记忆表').where('id', 'in', 要淘汰的IDs).execute()
    })

    if (回调 !== undefined) {
      let 最低分 = 淘汰结果.rows.reduce((min, r) => (r.保留指数 < min ? r.保留指数 : min), Infinity)
      let 显示最低分 = 最低分 === Infinity ? '0.00' : 最低分.toFixed(2)
      await 回调({
        类型: '流程信息',
        内容: `[潜意识遗忘] 基于信息冲刷的双轨制淘汰，已遗忘 ${String(要淘汰的IDs.length)} 条长期记忆 (低于阈值: ${String(低于阈值IDs.length)}条, 超出防爆容量: ${String(要淘汰的IDs.length - 低于阈值IDs.length)}条。最低保留指数: ${显示最低分})`,
      })
    }
  }
}

export async function 批量注入记忆(上下文: 记忆操作上下文, 记忆项列表: 批量注入记忆项[]): Promise<string[]> {
  let { 数据库查询器, 配置, 获取向量, 检查并降级一级记忆, 检查并清理二级记忆, 回调 } = 上下文
  let id列表: string[] = []
  for (let 项 of 记忆项列表) {
    let id = randomUUID()
    id列表.push(id)
    let 向量结果 = await 获取向量(项.内容)
    let 向量值: string | null = null
    let 维度值: number | null = null
    if (向量结果.类型 === '成功') {
      向量值 = JSON.stringify(向量结果.向量)
      维度值 = 向量结果.向量.length
    }
    await 确保在事务中执行(数据库查询器, async (trx) => {
      let 插入结果 = await trx
        .insertInto('记忆表')
        .values({
          id,
          等级: 项.等级,
          评分: 项.评分,
          内容: 项.内容,
          关键词: 项.关键词,
          标签: 项.标签,
          向量: 向量值,
          向量维度: 维度值,
          创建时间: 项.创建时间,
          访问次数: 0,
        })
        .returning('创建序号')
        .executeTakeFirst()
      if (插入结果?.创建序号 !== undefined) {
        await trx.updateTable('记忆表').set({ 最后访问序号: 插入结果.创建序号 }).where('id', '=', id).execute()
      }
      await 刷新记忆关联网络(trx, id, 项.关键词, 配置, 回调)
      await 增量排版(trx, id)
    })
  }
  await 检查并降级一级记忆()
  await 检查并清理二级记忆()
  return id列表
}
