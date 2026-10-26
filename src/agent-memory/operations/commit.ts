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
  let res = await 数据库查询器.selectFrom('记忆元数据表').selectAll().where('键', '=', 'HEAD_COMMIT').executeTakeFirst()
  return res !== undefined ? res.值 : null
}

export async function 设置当前提交ID(数据库查询器: Kysely<记忆数据库>, id: string): Promise<void> {
  let existing = await 获取当前提交ID(数据库查询器)
  if (existing !== null) {
    await 数据库查询器.updateTable('记忆元数据表').set({ 值: id }).where('键', '=', 'HEAD_COMMIT').execute()
  } else {
    await 数据库查询器.insertInto('记忆元数据表').values({ 键: 'HEAD_COMMIT', 值: id }).execute()
  }
}

export async function 创建记忆提交(
  数据库查询器: Kysely<记忆数据库>,
  消息: string,
): Promise<{ commitId: string; parentCommitId: string | null }> {
  let parentCommitId = await 获取当前提交ID(数据库查询器)
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
    if (旧HEAD !== null) {
      await 设置当前提交ID(数据库查询器, 旧HEAD)
    } else {
      await 数据库查询器.deleteFrom('记忆元数据表').where('键', '=', 'HEAD_COMMIT').execute()
    }
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

  let 可靠根 = await 数据库查询器
    .selectFrom('记忆元数据表')
    .select('值')
    .where('键', '=', 'RELIABLE_ROOT_COMMIT')
    .executeTakeFirst()
  if (可靠根 !== undefined && 提交链[0]?.id !== 可靠根.值) return null
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
  let { commitId, parentCommitId } = await 创建记忆提交(trx, 消息)
  await sql`UPDATE _agent_session_commit SET commit_id = ${commitId}, 恢复中 = FALSE WHERE id = 1`.execute(trx)

  let 结果 = await 操作(trx, parentCommitId)

  await 尝试清理空提交(trx, commitId, parentCommitId)
  await sql`UPDATE _agent_session_commit SET commit_id = NULL WHERE id = 1`.execute(trx)

  return 结果
}
