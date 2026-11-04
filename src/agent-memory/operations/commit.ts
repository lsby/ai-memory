import { sql, type Kysely } from 'kysely'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  当前动态工具表Schema,
  当前线索表Schema,
  当前记忆线索关联表Schema,
  当前记忆表Schema,
  type 记忆提交表,
  type 记忆数据库,
  type 记忆行变更表,
} from '../types'

let 单一主键Schema = z.object({ id: z.string() }).strict()
let 关联主键Schema = z.object({ 记忆id: z.string(), 线索id: z.string() }).strict()

export async function 获取当前提交ID(数据库查询器: Kysely<记忆数据库>): Promise<string | null> {
  let 指针 = await 数据库查询器.selectFrom('记忆指针表').select('当前记忆提交id').where('id', '=', 1).executeTakeFirst()
  if (指针 === undefined) throw new Error('记忆指针表缺少单例记录')
  return 指针.当前记忆提交id
}

export async function 设置当前提交ID(数据库查询器: Kysely<记忆数据库>, id: string | null): Promise<void> {
  let 结果 = await 数据库查询器
    .updateTable('记忆指针表')
    .set({ 当前记忆提交id: id })
    .where('id', '=', 1)
    .executeTakeFirst()
  if (结果.numUpdatedRows !== 1n) throw new Error('记忆指针表缺少单例记录')
}

async function 设置事务配置(数据库查询器: Kysely<记忆数据库>, 名称: string, 值: string): Promise<void> {
  await sql`SELECT set_config(${名称}, ${值}, TRUE)`.execute(数据库查询器)
}

export async function 创建记忆提交(
  数据库查询器: Kysely<记忆数据库>,
  提交说明: string,
  状态名称: string | null = null,
): Promise<{ commitId: string; parentCommitId: string | null }> {
  if (提交说明.trim() === '') throw new Error('记忆提交说明不能为空')
  if (状态名称 !== null && 状态名称.trim() === '') throw new Error('记忆状态名称不能为空')
  let 指针 = await 数据库查询器
    .selectFrom('记忆指针表')
    .select('当前记忆提交id')
    .where('id', '=', 1)
    .forUpdate()
    .executeTakeFirst()
  if (指针 === undefined) throw new Error('记忆指针表缺少单例记录')
  let parentCommitId = 指针.当前记忆提交id
  let commitId = randomUUID()
  await 数据库查询器
    .insertInto('记忆提交表')
    .values({ id: commitId, 父记忆提交id: parentCommitId, 提交说明, 状态名称, 创建时间: new Date() })
    .execute()
  return { commitId, parentCommitId }
}

export async function 命名记忆提交(
  数据库查询器: Kysely<记忆数据库>,
  记忆提交id: string,
  状态名称: string,
): Promise<boolean> {
  let 已校验提交id = 记忆提交id.trim()
  let 已校验状态名称 = 状态名称.trim()
  if (已校验提交id === '') throw new Error('记忆提交 ID 不能为空')
  if (已校验状态名称 === '') throw new Error('记忆状态名称不能为空')
  let 结果 = await 数据库查询器
    .updateTable('记忆提交表')
    .set({ 状态名称: 已校验状态名称 })
    .where('id', '=', 已校验提交id)
    .where('状态名称', 'is', null)
    .executeTakeFirst()
  return 结果.numUpdatedRows === 1n
}

async function 应用记忆变更(数据库查询器: Kysely<记忆数据库>, 变更: 记忆行变更表): Promise<void> {
  let 主键 = 单一主键Schema.parse(变更.主键)
  if (变更.操作类型 === 'delete') {
    await 数据库查询器.deleteFrom('当前记忆表').where('id', '=', 主键.id).execute()
    return
  }
  if (变更.行数据 === null) throw new Error(`记忆行变更 ${变更.id} 缺少行数据，无法重放`)
  let 记忆 = 当前记忆表Schema.parse(变更.行数据)
  if (记忆.id !== 主键.id) throw new Error(`记忆行变更 ${变更.id} 的主键与行数据不一致`)
  let { id: _id, ...可更新记忆 } = 记忆
  await 数据库查询器
    .insertInto('当前记忆表')
    .values(记忆)
    .onConflict((冲突) => 冲突.column('id').doUpdateSet(可更新记忆))
    .execute()
}

async function 应用线索变更(数据库查询器: Kysely<记忆数据库>, 变更: 记忆行变更表): Promise<void> {
  let 主键 = 单一主键Schema.parse(变更.主键)
  if (变更.操作类型 === 'delete') {
    await 数据库查询器.deleteFrom('当前线索表').where('id', '=', 主键.id).execute()
    return
  }
  if (变更.行数据 === null) throw new Error(`记忆行变更 ${变更.id} 缺少行数据，无法重放`)
  let 线索 = 当前线索表Schema.parse(变更.行数据)
  if (线索.id !== 主键.id) throw new Error(`记忆行变更 ${变更.id} 的主键与行数据不一致`)
  let { id: _id, ...可更新线索 } = 线索
  await 数据库查询器
    .insertInto('当前线索表')
    .values(线索)
    .onConflict((冲突) => 冲突.column('id').doUpdateSet(可更新线索))
    .execute()
}

async function 应用记忆线索关联变更(数据库查询器: Kysely<记忆数据库>, 变更: 记忆行变更表): Promise<void> {
  let 主键 = 关联主键Schema.parse(变更.主键)
  if (变更.操作类型 === 'delete') {
    await 数据库查询器
      .deleteFrom('当前记忆线索关联表')
      .where('记忆id', '=', 主键.记忆id)
      .where('线索id', '=', 主键.线索id)
      .execute()
    return
  }
  if (变更.行数据 === null) throw new Error(`记忆行变更 ${变更.id} 缺少行数据，无法重放`)
  let 关联 = 当前记忆线索关联表Schema.parse(变更.行数据)
  if (关联.记忆id !== 主键.记忆id || 关联.线索id !== 主键.线索id)
    throw new Error(`记忆行变更 ${变更.id} 的主键与行数据不一致`)
  await 数据库查询器
    .insertInto('当前记忆线索关联表')
    .values(关联)
    .onConflict((冲突) => 冲突.columns(['记忆id', '线索id']).doUpdateSet({ 向量: 关联.向量, 向量维度: 关联.向量维度 }))
    .execute()
}

async function 应用动态工具变更(数据库查询器: Kysely<记忆数据库>, 变更: 记忆行变更表): Promise<void> {
  let 主键 = 单一主键Schema.parse(变更.主键)
  if (变更.操作类型 === 'delete') {
    await 数据库查询器.deleteFrom('当前动态工具表').where('id', '=', 主键.id).execute()
    return
  }
  if (变更.行数据 === null) throw new Error(`记忆行变更 ${变更.id} 缺少行数据，无法重放`)
  let 工具 = 当前动态工具表Schema.parse(变更.行数据)
  if (工具.id !== 主键.id) throw new Error(`记忆行变更 ${变更.id} 的主键与行数据不一致`)
  let { id: _id, ...可更新工具 } = 工具
  await 数据库查询器
    .insertInto('当前动态工具表')
    .values(工具)
    .onConflict((冲突) => 冲突.column('id').doUpdateSet(可更新工具))
    .execute()
}

async function 应用变更(数据库查询器: Kysely<记忆数据库>, 变更: 记忆行变更表): Promise<void> {
  switch (变更.目标表) {
    case 'memory':
      await 应用记忆变更(数据库查询器, 变更)
      return
    case 'clue':
      await 应用线索变更(数据库查询器, 变更)
      return
    case 'memory_clue_relation':
      await 应用记忆线索关联变更(数据库查询器, 变更)
      return
    case 'dynamic_tool':
      await 应用动态工具变更(数据库查询器, 变更)
      return
  }
}

export async function 校验记忆提交拓扑(数据库查询器: Kysely<记忆数据库>): Promise<void> {
  let 提交列表 = await 数据库查询器.selectFrom('记忆提交表').select(['id', '父记忆提交id']).execute()
  let 当前提交id = await 获取当前提交ID(数据库查询器)
  if (提交列表.length === 0) {
    if (当前提交id !== null) throw new Error(`空记忆库的 HEAD 必须为 null，当前为: ${当前提交id}`)
    return
  }
  let 提交映射 = new Map(提交列表.map((提交) => [提交.id, 提交]))
  let 根提交列表 = 提交列表.filter((提交) => 提交.父记忆提交id === null)
  if (根提交列表.length !== 1) throw new Error(`记忆提交图必须恰好有一个根，当前为 ${String(根提交列表.length)} 个`)
  let 根提交 = 根提交列表[0]
  if (根提交 === undefined) throw new Error('记忆提交图缺少根提交')
  if (当前提交id === null) throw new Error('存在记忆提交时 HEAD 不能为 null')
  if (提交映射.has(当前提交id) === false) throw new Error(`HEAD 指向不存在的记忆提交: ${当前提交id}`)
  let 已验证 = new Set<string>([根提交.id])
  for (let 起点 of 提交列表) {
    if (已验证.has(起点.id)) continue
    let 路径: string[] = []
    let 路径集合 = new Set<string>()
    let 当前id: string | null = 起点.id
    while (当前id !== null && 已验证.has(当前id) === false) {
      if (路径集合.has(当前id)) throw new Error(`记忆提交链存在循环: ${当前id}`)
      路径集合.add(当前id)
      路径.push(当前id)
      let 提交 = 提交映射.get(当前id)
      if (提交 === undefined) throw new Error(`记忆提交链缺少提交: ${当前id}`)
      当前id = 提交.父记忆提交id
    }
    if (当前id === null) throw new Error(`记忆提交 ${起点.id} 未连接到唯一根提交 ${根提交.id}`)
    for (let id of 路径) 已验证.add(id)
  }
}

async function 获取可靠提交链(数据库查询器: Kysely<记忆数据库>, 目标提交id: string): Promise<记忆提交表[] | null> {
  let 提交链: 记忆提交表[] = []
  let 已访问 = new Set<string>()
  let 当前id: string | null = 目标提交id
  while (当前id !== null) {
    if (已访问.has(当前id)) throw new Error(`记忆提交链存在循环: ${当前id}`)
    已访问.add(当前id)
    let 提交 = await 数据库查询器.selectFrom('记忆提交表').selectAll().where('id', '=', 当前id).executeTakeFirst()
    if (提交 === undefined) {
      if (提交链.length === 0) return null
      throw new Error(`记忆提交链缺少提交: ${当前id}`)
    }
    提交链.unshift(提交)
    当前id = 提交.父记忆提交id
  }
  let 根提交列表 = await 数据库查询器
    .selectFrom('记忆提交表')
    .select('id')
    .where('父记忆提交id', 'is', null)
    .limit(2)
    .execute()
  if (根提交列表.length !== 1) throw new Error(`记忆提交图必须恰好有一个根，当前为 ${String(根提交列表.length)} 个`)
  if (提交链[0]?.id !== 根提交列表[0]?.id) throw new Error(`记忆提交 ${目标提交id} 未连接到唯一根提交`)
  return 提交链
}

async function 重放提交链(数据库查询器: Kysely<记忆数据库>, 提交链: 记忆提交表[]): Promise<void> {
  await 设置事务配置(数据库查询器, 'lsby_ai_memory.active_commit_id', '')
  await 设置事务配置(数据库查询器, 'lsby_ai_memory.replaying', 'true')
  await 数据库查询器.deleteFrom('当前记忆线索关联表').execute()
  await 数据库查询器.deleteFrom('当前记忆表').execute()
  await 数据库查询器.deleteFrom('当前线索表').execute()
  await 数据库查询器.deleteFrom('当前动态工具表').execute()
  for (let 提交 of 提交链) {
    let 变更列表 = await 数据库查询器
      .selectFrom('记忆行变更表')
      .selectAll()
      .where('记忆提交id', '=', 提交.id)
      .orderBy('提交内序号', 'asc')
      .execute()
    for (let 变更 of 变更列表) await 应用变更(数据库查询器, 变更)
  }
}

export async function 切换记忆提交(数据库查询器: Kysely<记忆数据库>, 目标提交id: string): Promise<boolean> {
  let 提交链 = await 获取可靠提交链(数据库查询器, 目标提交id)
  if (提交链 === null) return false
  await 重放提交链(数据库查询器, 提交链)
  await 设置当前提交ID(数据库查询器, 目标提交id)
  await 设置事务配置(数据库查询器, 'lsby_ai_memory.replaying', 'false')
  return true
}

export async function 回退到父记忆提交(数据库查询器: Kysely<记忆数据库>): Promise<boolean> {
  let 当前提交id = await 获取当前提交ID(数据库查询器)
  if (当前提交id === null) return false
  let 当前提交 = await 数据库查询器.selectFrom('记忆提交表').selectAll().where('id', '=', 当前提交id).executeTakeFirst()
  if (当前提交 === undefined) throw new Error(`当前记忆提交不存在: ${当前提交id}`)
  if (当前提交.父记忆提交id === null) return false
  return await 切换记忆提交(数据库查询器, 当前提交.父记忆提交id)
}

/** 在一个提交里执行操作（trx 必须已是事务），任何持久化状态变更都由触发器记录。 */
export async function 在提交中执行<R>(
  trx: Kysely<记忆数据库>,
  提交说明: string,
  操作: (trx: Kysely<记忆数据库>, 父记忆提交id: string | null) => Promise<R>,
): Promise<R> {
  let 配置 = await sql<{ 活动记忆提交id: string | null; 回放中: string | null }>`
    SELECT NULLIF(current_setting('lsby_ai_memory.active_commit_id', TRUE), '') AS 活动记忆提交id,
      NULLIF(current_setting('lsby_ai_memory.replaying', TRUE), '') AS 回放中
  `.execute(trx)
  let 状态 = 配置.rows[0]
  if (状态?.回放中 === 'true') throw new Error('回放历史期间不能创建记忆提交')
  if (状态?.活动记忆提交id !== null && 状态?.活动记忆提交id !== undefined)
    throw new Error(`已经存在活动记忆提交: ${状态.活动记忆提交id}`)
  let { commitId, parentCommitId } = await 创建记忆提交(trx, 提交说明)
  await 设置事务配置(trx, 'lsby_ai_memory.active_commit_id', commitId)
  await 设置事务配置(trx, 'lsby_ai_memory.replaying', 'false')
  let 结果 = await 操作(trx, parentCommitId)
  let 变更 = await trx
    .selectFrom('记忆行变更表')
    .select('id')
    .where('记忆提交id', '=', commitId)
    .limit(1)
    .executeTakeFirst()
  await 设置事务配置(trx, 'lsby_ai_memory.active_commit_id', '')
  if (变更 === undefined) await trx.deleteFrom('记忆提交表').where('id', '=', commitId).execute()
  else await 设置当前提交ID(trx, commitId)
  return 结果
}
