import { Kysely, sql } from 'kysely'
import { 智能体事件 } from '../../agent/types'
import { 内部带记忆的智能体配置, 记忆数据库 } from '../agent-memory-types'

export async function 确保在事务中执行<DB, T>(
  数据库查询器: Kysely<DB>,
  回调: (trx: Kysely<DB>) => Promise<T>,
): Promise<T> {
  if (数据库查询器.isTransaction) return await 回调(数据库查询器)
  return await 数据库查询器.transaction().execute(async (trx) => await 回调(trx))
}

export async function 获取混合关联排序(
  数据库查询器: Kysely<记忆数据库>,
  参数: {
    查询关键词: string[]
    查询向量: number[] | null
    向量阈值: number
    排除的记忆ID?: string | undefined
    开始时间?: Date | undefined
    结束时间?: Date | undefined
  },
): Promise<{ id: string; 综合得分: number; 重叠度?: number; 相似度?: number }[]> {
  let 记录映射 = new Map<string, { 重叠度: number; 相似度: number }>()

  if (参数.查询关键词.length > 0) {
    /* 
    // 【已注释的旧版纯 SQL 计算方案】
    // 说明：这是最传统的将所有重活交给数据库的写法，能直接算出重叠度并在数据库内进行过滤，规避大量数据传回内存。
    // 缺陷：但在 PGlite (WASM) 等特定或资源受限环境下，逐行执行 UNNEST 和 INTERSECT 可能会引发严重的内存飙升或主线程阻塞崩溃。
    // 因此现已改为下方更稳妥的“数据库初筛 && 结合 内存精算”策略。
    let 查询 = sql`
      SELECT id,
             cardinality(ARRAY(
                 SELECT UNNEST(关键词)
                 INTERSECT
                 SELECT UNNEST(${参数.查询关键词}::TEXT[])
             )) AS 重叠度
      FROM 记忆表
      WHERE cardinality(ARRAY(
                 SELECT UNNEST(关键词)
                 INTERSECT
                 SELECT UNNEST(${参数.查询关键词}::TEXT[])
             )) > 0
    `
    // 追加其他条件...
    // let 结果 = await 查询.execute(数据库查询器)
    // ...
    */

    // 使用 && 运算符在数据库层面上过滤出至少有一个重叠关键词的行，避免全表扫描
    let 带有条件的查询 = 数据库查询器
      .selectFrom('记忆表')
      .select(['id', '关键词'])
      .where(sql<boolean>`关键词 && ${参数.查询关键词}::TEXT[]`)

    if (参数.排除的记忆ID !== undefined) {
      带有条件的查询 = 带有条件的查询.where('id', '!=', 参数.排除的记忆ID)
    }
    if (参数.开始时间 !== undefined) {
      带有条件的查询 = 带有条件的查询.where('创建时间', '>=', 参数.开始时间)
    }
    if (参数.结束时间 !== undefined) {
      带有条件的查询 = 带有条件的查询.where('创建时间', '<=', 参数.结束时间)
    }

    let 结果 = await 带有条件的查询.execute()

    // 在内存中计算精确的重叠度，避免复杂的 SQL 数组相交计算
    for (let 行 of 结果) {
      let 重叠度 = 0
      for (let k of 行.关键词) {
        if (参数.查询关键词.includes(k)) 重叠度++
      }
      if (重叠度 > 0) {
        记录映射.set(行.id, { 重叠度, 相似度: 0 })
      }
    }
  }

  let 阈值 = 参数.向量阈值
  if (参数.查询向量 !== null) {
    let targetVecStr = JSON.stringify(参数.查询向量)
    let 当前维度 = 参数.查询向量.length
    let simExpr = sql<number>`1 - (向量 <=> ${targetVecStr}::vector)`

    let 查询 = 数据库查询器
      .selectFrom('记忆表')
      .select(['id', simExpr.as('相似度')])
      .where('向量', 'is not', null)
      .where('向量维度', '=', 当前维度)
      .where(simExpr, '>', 阈值)

    if (参数.排除的记忆ID !== undefined) {
      查询 = 查询.where('id', '!=', 参数.排除的记忆ID)
    }
    if (参数.开始时间 !== undefined) {
      查询 = 查询.where('创建时间', '>=', 参数.开始时间)
    }
    if (参数.结束时间 !== undefined) {
      查询 = 查询.where('创建时间', '<=', 参数.结束时间)
    }

    let 其他带向量记忆 = await 查询.execute()

    for (let 记录 of 其他带向量记忆) {
      let 现有的 = 记录映射.get(记录.id)
      if (现有的 !== undefined) {
        现有的.相似度 = 记录.相似度
      } else {
        记录映射.set(记录.id, { 重叠度: 0, 相似度: 记录.相似度 })
      }
    }
  }

  let 最终结果: { id: string; 综合得分: number; 重叠度?: number; 相似度?: number }[] = []
  for (let [id, 数据] of 记录映射.entries()) {
    let 综合得分 = 数据.重叠度 + 数据.相似度
    if (综合得分 > 0) {
      最终结果.push({
        id,
        综合得分,
        ...(数据.重叠度 > 0 ? { 重叠度: 数据.重叠度 } : {}),
        ...(数据.相似度 > 0 ? { 相似度: 数据.相似度 } : {}),
      })
    }
  }

  最终结果.sort((a, b) => b.综合得分 - a.综合得分)
  return 最终结果
}

export async function 刷新记忆关联网络(
  数据库查询器: Kysely<记忆数据库>,
  记忆id: string,
  关键词: string[],
  配置: 内部带记忆的智能体配置,
  回调?: (事件: 智能体事件) => Promise<void>,
): Promise<void> {
  await 确保在事务中执行(数据库查询器, async (trx) => {
    // 先删除与该记忆相关的所有边
    await trx
      .deleteFrom('记忆关联表')
      .where((eb) => eb.or([eb('起点id', '=', 记忆id), eb('终点id', '=', 记忆id)]))
      .execute()

    let 当前记忆 = await trx.selectFrom('记忆表').select('向量').where('id', '=', 记忆id).executeTakeFirst()
    let 目标向量: number[] | null = null
    if (当前记忆 !== undefined && 当前记忆.向量 !== null) {
      目标向量 = typeof 当前记忆.向量 === 'string' ? (JSON.parse(当前记忆.向量) as number[]) : (当前记忆.向量 ?? null)
    }

    let 需要计算的边 = await 获取混合关联排序(trx, {
      查询关键词: 关键词,
      查询向量: 目标向量,
      向量阈值: 配置.向量相似度关联阈值,
      排除的记忆ID: 记忆id,
    })

    if (需要计算的边.length > 0) {
      for (let 行 of 需要计算的边) {
        let [左id, 右id] = 记忆id < 行.id ? [记忆id, 行.id] : [行.id, 记忆id]
        await sql`
          INSERT INTO 记忆关联表 (起点id, 终点id, 关联度) VALUES (${左id}, ${右id}, ${行.综合得分})
          ON CONFLICT (起点id, 终点id) DO UPDATE SET 关联度 = EXCLUDED.关联度
        `.execute(trx)
      }

      if (回调 !== undefined) {
        await 回调({
          类型: '流程信息',
          内容: `[数据库更新] 自动建立了 ${String(需要计算的边.length)} 个节点对的记忆关联网络 (中心节点ID: ${记忆id})`,
        })
      }
    }
  })
}
