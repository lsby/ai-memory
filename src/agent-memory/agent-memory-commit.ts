import { sql, type Kysely } from 'kysely'
import { randomUUID } from 'node:crypto'
import { 转义标识符 } from './agent-memory-connection'
import {
  记忆关联表Schema,
  记忆表Schema,
  type 变更记录配置,
  type 记忆变更表,
  type 记忆数据库,
} from './agent-memory-types'

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

async function 恢复记忆节点(数据库查询器: Kysely<记忆数据库>, 变更: 记忆变更表): Promise<void> {
  if (变更.旧值 === null) throw new Error(`提交变更 ${变更.id} 缺少旧值，无法回退`)
  let { id, ...旧记忆 } = 记忆表Schema.parse(JSON.parse(变更.旧值))
  switch (变更.操作类型) {
    case 'delete':
      await 数据库查询器
        .insertInto('记忆表')
        .values({ id, ...旧记忆 })
        .execute()
      break
    case 'update':
      await 数据库查询器.updateTable('记忆表').set(旧记忆).where('id', '=', id).execute()
      break
    case 'add':
    case 'init':
      throw new Error(`恢复记忆节点收到不支持的操作类型: ${变更.操作类型}`)
  }
}

async function 回退关联变更(数据库查询器: Kysely<记忆数据库>, 变更: 记忆变更表): Promise<void> {
  switch (变更.操作类型) {
    case 'add':
    case 'init': {
      if (变更.新值 === null) throw new Error(`提交变更 ${变更.id} 缺少新值，无法回退`)
      let 关联 = 记忆关联表Schema.parse(JSON.parse(变更.新值))
      await 数据库查询器
        .deleteFrom('记忆关联表')
        .where('起点id', '=', 关联.起点id)
        .where('终点id', '=', 关联.终点id)
        .execute()
      break
    }
    case 'update':
    case 'delete': {
      if (变更.旧值 === null) throw new Error(`提交变更 ${变更.id} 缺少旧值，无法回退`)
      let 关联 = 记忆关联表Schema.parse(JSON.parse(变更.旧值))
      await 数据库查询器
        .insertInto('记忆关联表')
        .values(关联)
        .onConflict((冲突) => 冲突.columns(['起点id', '终点id']).doUpdateSet({ 关联度: 关联.关联度 }))
        .execute()
      break
    }
  }
}

export async function 回退记忆提交(数据库查询器: Kysely<记忆数据库>, 提交id: string): Promise<boolean> {
  let 提交 = await 数据库查询器.selectFrom('记忆提交表').select('id').where('id', '=', 提交id).executeTakeFirst()
  if (提交 === undefined) return false
  let 变更列表 = await 数据库查询器
    .selectFrom('记忆变更表')
    .selectAll()
    .where('提交id', '=', 提交id)
    .orderBy('序号', 'desc')
    .execute()

  for (let 变更 of 变更列表) {
    if (变更.目标表 === 'node' && (变更.操作类型 === 'delete' || 变更.操作类型 === 'update')) {
      await 恢复记忆节点(数据库查询器, 变更)
    }
  }
  for (let 变更 of 变更列表) {
    if (变更.目标表 === 'link') await 回退关联变更(数据库查询器, 变更)
  }
  for (let 变更 of 变更列表) {
    if (变更.目标表 === 'node' && (变更.操作类型 === 'add' || 变更.操作类型 === 'init')) {
      await 数据库查询器.deleteFrom('记忆表').where('id', '=', 变更.目标id).execute()
    }
  }
  return true
}

/** 沿 HEAD 的父提交链只保留最近 保留数 个提交，其余的连同变更一起删除（变更表对提交表是级联删除）。 */
export async function 裁剪旧提交(数据库查询器: Kysely<记忆数据库>, 保留数: number): Promise<void> {
  await sql`
    WITH RECURSIVE 保留链 (id, 父提交id, 深度) AS (
      SELECT id, 父提交id, 1 FROM 记忆提交表
      WHERE id = (SELECT 值 FROM 记忆元数据表 WHERE 键 = 'HEAD_COMMIT')
      UNION ALL
      SELECT 父.id, 父.父提交id, 保留链.深度 + 1 FROM 记忆提交表 父
      JOIN 保留链 ON 父.id = 保留链.父提交id
      WHERE 保留链.深度 < ${保留数}::int
    )
    DELETE FROM 记忆提交表
    WHERE EXISTS (SELECT 1 FROM 保留链) AND id NOT IN (SELECT id FROM 保留链)
  `.execute(数据库查询器)
}

/** 抹掉变更表里和某条记忆相关的全部旧值、新值（包括它参与的关联）；返回抹掉的变更条数。 */
export async function 抹除记忆变更记录(数据库查询器: Kysely<记忆数据库>, 记忆id: string): Promise<number> {
  let 前缀 = `${记忆id}_`
  let 后缀 = `_${记忆id}`
  let 结果 = await 数据库查询器
    .deleteFrom('记忆变更表')
    .where((eb) =>
      eb.or([
        eb.and([eb('目标表', '=', 'node'), eb('目标id', '=', 记忆id)]),
        eb.and([
          eb('目标表', '=', 'link'),
          eb.or([
            eb(sql`left(目标id, ${[...前缀].length}::int)`, '=', 前缀),
            eb(sql`right(目标id, ${[...后缀].length}::int)`, '=', 后缀),
          ]),
        ]),
      ]),
    )
    .executeTakeFirst()
  return Number(结果.numDeletedRows)
}

/**
 * 在一个提交里执行操作（trx 必须已是事务）。变更记录关闭时不建提交、不设会话提交编号，
 * 触发器看到编号为空就不写变更；配置了保留提交数时，提交结束后裁掉旧提交。
 */
export async function 在提交中执行<R>(
  trx: Kysely<记忆数据库>,
  变更记录: 变更记录配置,
  消息: string,
  操作: (trx: Kysely<记忆数据库>, 父提交id: string | null) => Promise<R>,
): Promise<R> {
  if (变更记录 === false) return await 操作(trx, null)

  let { commitId, parentCommitId } = await 创建记忆提交(trx, 消息)
  await sql`UPDATE _agent_session_commit SET commit_id = ${commitId} WHERE id = 1`.execute(trx)

  let 结果 = await 操作(trx, parentCommitId)

  await 尝试清理空提交(trx, commitId, parentCommitId)
  await sql`UPDATE _agent_session_commit SET commit_id = NULL WHERE id = 1`.execute(trx)
  if (Number.isFinite(变更记录.保留提交数) === true) await 裁剪旧提交(trx, 变更记录.保留提交数)

  return 结果
}

/**
 * 回收被删掉的行占的空间。PGlite 里没有后台的自动清理，不做这一步的话，
 * 裁掉的旧提交和彻底删除的内容既会一直占着磁盘，新写入也用不上这些空间。
 * VACUUM 不能在事务里执行，调用方要在事务外调用。
 */
export async function 回收表空间(数据库查询器: Kysely<记忆数据库>, schema: string): Promise<void> {
  let 全名 = (表: string): string => `${转义标识符(schema)}.${转义标识符(表)}`
  await sql
    .raw(`VACUUM ${['记忆变更表', '记忆提交表', '记忆表', '记忆关联表'].map(全名).join(', ')}`)
    .execute(数据库查询器)
}
