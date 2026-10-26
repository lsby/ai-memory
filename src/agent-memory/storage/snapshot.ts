import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { 完整状态Schema, 快照数据Schema, type 完整状态, type 快照数据, type 记忆数据库 } from '../types'
import { 查询全部会话, 查询全部消息 } from './conversation-storage'

async function 读取快照(数据库查询器: Kysely<记忆数据库>): Promise<快照数据> {
  let 记忆列表 = await 数据库查询器.selectFrom('记忆表').selectAll().execute()
  let 记忆关联列表 = await 数据库查询器.selectFrom('记忆关联表').selectAll().execute()
  let 动态工具列表 = await 数据库查询器.selectFrom('动态工具表').selectAll().execute()
  return { 格式版本: 2, 记忆列表, 记忆关联列表, 动态工具列表 }
}

export async function 保存快照(数据库查询器: Kysely<记忆数据库>): Promise<string> {
  return JSON.stringify(await 读取快照(数据库查询器))
}

export async function 载入快照(数据库查询器: Kysely<记忆数据库>, json字符串: string): Promise<void> {
  let 快照 = 快照数据Schema.parse(JSON.parse(json字符串))

  await 数据库查询器.deleteFrom('记忆关联表').execute()
  await 数据库查询器.deleteFrom('记忆表').execute()
  await 数据库查询器.deleteFrom('动态工具表').execute()

  if (快照.记忆列表.length > 0) {
    await 数据库查询器.insertInto('记忆表').values(快照.记忆列表).execute()
  }
  if (快照.记忆关联列表.length > 0) {
    await 数据库查询器.insertInto('记忆关联表').values(快照.记忆关联列表).execute()
  }
  if (快照.动态工具列表.length > 0) {
    await 数据库查询器.insertInto('动态工具表').values(快照.动态工具列表).execute()
  }
}

export async function 导出完整状态(数据库查询器: Kysely<记忆数据库>, 当前会话id: string | null): Promise<string> {
  let 完整状态: 完整状态 = {
    格式版本: 3,
    记忆快照: await 读取快照(数据库查询器),
    当前会话id,
    会话列表: await 查询全部会话(数据库查询器),
    消息列表: await 查询全部消息(数据库查询器),
  }
  return JSON.stringify(完整状态)
}

export async function 导入完整状态(
  数据库查询器: Kysely<记忆数据库>,
  状态数据: string,
): Promise<{ 当前会话id: string | null }> {
  let 数据 = 完整状态Schema.parse(JSON.parse(状态数据))
  let 已有会话 = await 数据库查询器
    .selectFrom('会话表')
    .select((eb) => eb.fn.count<number>('id').as('数量'))
    .executeTakeFirst()
  if (Number(已有会话?.数量 ?? 0) > 0) throw new Error('导入完整状态要求目标存储中不存在会话')
  await 载入快照(数据库查询器, JSON.stringify(数据.记忆快照))
  await sql`SELECT set_config('lsby_ai_memory.导入中', 'true', true)`.execute(数据库查询器)
  for (let 会话 of 数据.会话列表) {
    await 数据库查询器
      .insertInto('会话表')
      .values({ ...会话, 当前消息id: null, 前驱会话id: null, 前驱消息id: null })
      .execute()
  }
  for (let 消息 of 数据.消息列表) {
    await 数据库查询器
      .insertInto('消息表')
      .values({
        id: 消息.id,
        会话id: 消息.会话id,
        父消息id: 消息.父消息id,
        角色: 消息.消息.role,
        载荷: JSON.stringify(消息.消息),
        创建时间: 消息.创建时间,
      })
      .execute()
  }
  for (let 会话 of 数据.会话列表) {
    await 数据库查询器
      .updateTable('会话表')
      .set({
        当前消息id: 会话.当前消息id,
        前驱会话id: 会话.前驱会话id,
        前驱消息id: 会话.前驱消息id,
        更新时间: 会话.更新时间,
      })
      .where('id', '=', 会话.id)
      .execute()
  }
  await sql`SELECT set_config('lsby_ai_memory.导入中', 'false', true)`.execute(数据库查询器)
  return { 当前会话id: 数据.当前会话id }
}
