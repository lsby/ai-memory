import { sql, type Kysely } from 'kysely'
import { randomUUID } from 'node:crypto'
import {
  动态工具表Schema,
  记忆关联表Schema,
  记忆表Schema,
  type 记忆变更表,
  type 记忆提交表,
  type 记忆数据库,
} from '../types'

export async function 获取当前提交ID(数据库查询器: Kysely<记忆数据库>): Promise<string | null> {
  let 指针 = await 数据库查询器.selectFrom('记忆指针表').select('head_commit_id').where('id', '=', 1).executeTakeFirst()
  if (指针 === undefined) throw new Error('记忆指针表缺少单例记录')
  return 指针.head_commit_id
}

export async function 设置当前提交ID(数据库查询器: Kysely<记忆数据库>, id: string | null): Promise<void> {
  let 结果 = await 数据库查询器
    .updateTable('记忆指针表')
    .set({ head_commit_id: id })
    .where('id', '=', 1)
    .executeTakeFirst()
  if (结果.numUpdatedRows !== 1n) throw new Error('记忆指针表缺少单例记录')
}

export async function 创建记忆提交(
  数据库查询器: Kysely<记忆数据库>,
  消息: string,
): Promise<{ commitId: string; parentCommitId: string | null }> {
  if (消息.trim() === '') throw new Error('记忆提交消息不能为空')
  let 指针 = await 数据库查询器
    .selectFrom('记忆指针表')
    .select('head_commit_id')
    .where('id', '=', 1)
    .forUpdate()
    .executeTakeFirst()
  if (指针 === undefined) throw new Error('记忆指针表缺少单例记录')
  let parentCommitId = 指针.head_commit_id
  let commitId = randomUUID()

  await 数据库查询器
    .insertInto('记忆提交表')
    .values({ id: commitId, 父提交id: parentCommitId, 消息, 创建时间: new Date() })
    .execute()

  await 设置当前提交ID(数据库查询器, commitId)

  return { commitId, parentCommitId }
}

export async function 尝试清理空提交(
  数据库查询器: Kysely<记忆数据库>,
  commitId: string,
  旧HEAD: string | null,
): Promise<void> {
  let 变更记录 = await 数据库查询器
    .selectFrom('记忆变更表')
    .select('id')
    .where('提交id', '=', commitId)
    .limit(1)
    .execute()

  if (变更记录.length === 0) {
    await 设置当前提交ID(数据库查询器, 旧HEAD)
    await 数据库查询器.deleteFrom('记忆提交表').where('id', '=', commitId).execute()
  }
}

async function 应用记忆节点变更(数据库查询器: Kysely<记忆数据库>, 变更: 记忆变更表): Promise<void> {
  switch (变更.操作类型) {
    case 'delete':
      await 数据库查询器.deleteFrom('记忆表').where('id', '=', 变更.目标id).execute()
      break
    case 'add':
    case 'init':
    case 'update': {
      if (变更.新值 === null) throw new Error(`提交变更 ${变更.id} 缺少新值，无法重放`)
      let 记忆 = 记忆表Schema.parse(JSON.parse(变更.新值))
      let { id: _id, ...可更新记忆 } = 记忆
      await 数据库查询器
        .insertInto('记忆表')
        .values(记忆)
        .onConflict((冲突) => 冲突.column('id').doUpdateSet(可更新记忆))
        .execute()
      break
    }
  }
}

async function 应用记忆关联变更(数据库查询器: Kysely<记忆数据库>, 变更: 记忆变更表): Promise<void> {
  let 值 = 变更.新值 ?? 变更.旧值
  if (值 === null) throw new Error(`提交变更 ${变更.id} 缺少关联值，无法重放`)
  let 关联 = 记忆关联表Schema.parse(JSON.parse(值))
  switch (变更.操作类型) {
    case 'delete':
      await 数据库查询器
        .deleteFrom('记忆关联表')
        .where('起点id', '=', 关联.起点id)
        .where('终点id', '=', 关联.终点id)
        .execute()
      break
    case 'add':
    case 'init':
    case 'update':
      await 数据库查询器
        .insertInto('记忆关联表')
        .values(关联)
        .onConflict((冲突) => 冲突.columns(['起点id', '终点id']).doUpdateSet({ 关联度: 关联.关联度 }))
        .execute()
      break
  }
}

async function 应用动态工具变更(数据库查询器: Kysely<记忆数据库>, 变更: 记忆变更表): Promise<void> {
  switch (变更.操作类型) {
    case 'delete':
      await 数据库查询器.deleteFrom('动态工具表').where('id', '=', 变更.目标id).execute()
      break
    case 'add':
    case 'init':
    case 'update': {
      if (变更.新值 === null) throw new Error(`提交变更 ${变更.id} 缺少新值，无法重放`)
      let 工具 = 动态工具表Schema.parse(JSON.parse(变更.新值))
      let { id: _id, ...可更新工具 } = 工具
      await 数据库查询器
        .insertInto('动态工具表')
        .values(工具)
        .onConflict((冲突) => 冲突.column('id').doUpdateSet(可更新工具))
        .execute()
      break
    }
  }
}

async function 应用变更(数据库查询器: Kysely<记忆数据库>, 变更: 记忆变更表): Promise<void> {
  switch (变更.目标表) {
    case 'node':
      await 应用记忆节点变更(数据库查询器, 变更)
      break
    case 'link':
      await 应用记忆关联变更(数据库查询器, 变更)
      break
    case 'tool':
      await 应用动态工具变更(数据库查询器, 变更)
      break
  }
}

export async function 校验记忆提交拓扑(数据库查询器: Kysely<记忆数据库>): Promise<void> {
  let 提交列表 = await 数据库查询器.selectFrom('记忆提交表').select(['id', '父提交id']).execute()
  let 当前提交id = await 获取当前提交ID(数据库查询器)
  if (提交列表.length === 0) {
    if (当前提交id !== null) throw new Error(`空记忆库的 HEAD 必须为 null，当前为: ${当前提交id}`)
    return
  }

  let 提交映射 = new Map(提交列表.map((提交) => [提交.id, 提交]))
  let 根提交列表 = 提交列表.filter((提交) => 提交.父提交id === null)
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
      当前id = 提交.父提交id
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
    当前id = 提交.父提交id
  }

  let 根提交列表 = await 数据库查询器
    .selectFrom('记忆提交表')
    .select('id')
    .where('父提交id', 'is', null)
    .limit(2)
    .execute()
  if (根提交列表.length !== 1) throw new Error(`记忆提交图必须恰好有一个根，当前为 ${String(根提交列表.length)} 个`)
  if (提交链[0]?.id !== 根提交列表[0]?.id) throw new Error(`记忆提交 ${目标提交id} 未连接到唯一根提交`)
  return 提交链
}

async function 重放提交链(数据库查询器: Kysely<记忆数据库>, 提交链: 记忆提交表[]): Promise<void> {
  await sql`UPDATE _agent_session_commit SET commit_id = NULL, 恢复中 = TRUE WHERE id = 1`.execute(数据库查询器)
  await 数据库查询器.deleteFrom('记忆关联表').execute()
  await 数据库查询器.deleteFrom('记忆表').execute()
  await 数据库查询器.deleteFrom('动态工具表').execute()

  for (let 提交 of 提交链) {
    let 变更列表 = await 数据库查询器
      .selectFrom('记忆变更表')
      .selectAll()
      .where('提交id', '=', 提交.id)
      .orderBy('序号', 'asc')
      .execute()
    for (let 变更 of 变更列表) await 应用变更(数据库查询器, 变更)
  }
}

export async function 切换记忆提交(数据库查询器: Kysely<记忆数据库>, 目标提交id: string): Promise<boolean> {
  let 提交链 = await 获取可靠提交链(数据库查询器, 目标提交id)
  if (提交链 === null) return false
  await 重放提交链(数据库查询器, 提交链)
  await 设置当前提交ID(数据库查询器, 目标提交id)
  await sql`UPDATE _agent_session_commit SET 恢复中 = FALSE WHERE id = 1`.execute(数据库查询器)
  return true
}

export async function 回退到父记忆提交(数据库查询器: Kysely<记忆数据库>): Promise<boolean> {
  let 当前提交id = await 获取当前提交ID(数据库查询器)
  if (当前提交id === null) return false
  let 当前提交 = await 数据库查询器.selectFrom('记忆提交表').selectAll().where('id', '=', 当前提交id).executeTakeFirst()
  if (当前提交 === undefined) throw new Error(`当前记忆提交不存在: ${当前提交id}`)
  if (当前提交.父提交id === null) return false
  return await 切换记忆提交(数据库查询器, 当前提交.父提交id)
}

/** 在一个提交里执行操作（trx 必须已是事务），任何持久化状态变更都由触发器记录。 */
export async function 在提交中执行<R>(
  trx: Kysely<记忆数据库>,
  消息: string,
  操作: (trx: Kysely<记忆数据库>, 父提交id: string | null) => Promise<R>,
): Promise<R> {
  let 活动提交状态 = await sql<{ commit_id: string | null; 恢复中: boolean }>`
    SELECT commit_id, 恢复中 FROM _agent_session_commit WHERE id = 1
  `.execute(trx)
  let 状态 = 活动提交状态.rows[0]
  if (状态 === undefined) throw new Error('缺少记忆提交事务上下文')
  if (状态.恢复中 === true) throw new Error('恢复历史期间不能创建记忆提交')
  if (状态.commit_id !== null) throw new Error(`已经存在活动记忆提交: ${状态.commit_id}`)
  let { commitId, parentCommitId } = await 创建记忆提交(trx, 消息)
  await sql`UPDATE _agent_session_commit SET commit_id = ${commitId}, 恢复中 = FALSE WHERE id = 1`.execute(trx)

  let 结果 = await 操作(trx, parentCommitId)

  await 尝试清理空提交(trx, commitId, parentCommitId)
  await sql`UPDATE _agent_session_commit SET commit_id = NULL WHERE id = 1`.execute(trx)

  return 结果
}
