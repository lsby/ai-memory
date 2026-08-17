import type { Kysely } from 'kysely'
import { randomUUID } from 'node:crypto'
import { 记忆关联表Schema, 记忆表Schema, type 记忆变更表, type 记忆数据库 } from './agent-memory-types'

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
