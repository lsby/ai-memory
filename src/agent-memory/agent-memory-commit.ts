import type { Kysely } from 'kysely'
import { randomUUID } from 'node:crypto'
import type { 记忆数据库 } from './agent-memory-types'

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
