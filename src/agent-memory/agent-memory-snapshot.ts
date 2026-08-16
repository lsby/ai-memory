import type { Kysely } from 'kysely'
import { z } from 'zod'
import { 智能体消息Schema, type 智能体消息类型 } from '../agent/types'
import { 快照数据Schema, type 快照数据, type 记忆数据库 } from './agent-memory-types'

export async function 保存快照(数据库查询器: Kysely<记忆数据库>): Promise<string> {
  let 记忆列表 = await 数据库查询器.selectFrom('记忆表').selectAll().execute()
  let 记忆关联列表 = await 数据库查询器.selectFrom('记忆关联表').selectAll().execute()
  let 快照: 快照数据 = { 记忆列表, 记忆关联列表 }
  return JSON.stringify(快照)
}

export async function 载入快照(数据库查询器: Kysely<记忆数据库>, json字符串: string): Promise<void> {
  let 快照 = 快照数据Schema.parse(JSON.parse(json字符串))

  await 数据库查询器.deleteFrom('记忆关联表').execute()
  await 数据库查询器.deleteFrom('记忆表').execute()

  if (快照.记忆列表.length > 0) {
    await 数据库查询器.insertInto('记忆表').values(快照.记忆列表).execute()
  }
  if (快照.记忆关联列表.length > 0) {
    await 数据库查询器.insertInto('记忆关联表').values(快照.记忆关联列表).execute()
  }
}

export async function 导出完整状态(数据库查询器: Kysely<记忆数据库>, 当前消息历史: 智能体消息类型[]): Promise<string> {
  let 快照 = await 保存快照(数据库查询器)
  let 完整状态 = { 快照, 消息历史: 当前消息历史 }
  return JSON.stringify(完整状态)
}

let 完整状态解析Schema = z.object({
  快照: z.string().optional(),
  消息历史: z.array(智能体消息Schema).optional().default([]),
})

export async function 导入完整状态(数据库查询器: Kysely<记忆数据库>, 状态数据: string): Promise<智能体消息类型[]> {
  let 数据 = 完整状态解析Schema.parse(JSON.parse(状态数据))
  if (数据.快照 !== undefined) {
    await 载入快照(数据库查询器, 数据.快照)
  }
  return 数据.消息历史
}
