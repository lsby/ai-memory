import type { Kysely } from 'kysely'
import type { 智能体消息类型 } from '../agent/types'
import { 完整状态Schema, 快照数据Schema, type 完整状态, type 快照数据, type 记忆数据库 } from './agent-memory-types'

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

export async function 导出完整状态(
  数据库查询器: Kysely<记忆数据库>,
  当前消息历史: 智能体消息类型[],
  会话标识: string,
): Promise<string> {
  let 完整状态: 完整状态 = { 格式版本: 2, 会话标识, 记忆快照: await 读取快照(数据库查询器), 消息历史: 当前消息历史 }
  return JSON.stringify(完整状态)
}

export async function 导入完整状态(
  数据库查询器: Kysely<记忆数据库>,
  状态数据: string,
): Promise<{ 消息历史: 智能体消息类型[]; 会话标识?: string | undefined }> {
  let 数据 = 完整状态Schema.parse(JSON.parse(状态数据))
  await 载入快照(数据库查询器, JSON.stringify(数据.记忆快照))
  return { 消息历史: 数据.消息历史, 会话标识: 数据.会话标识 }
}
