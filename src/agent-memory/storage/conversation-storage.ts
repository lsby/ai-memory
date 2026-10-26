import type { Kysely, Selectable } from 'kysely'
import { sql } from 'kysely'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { 智能体消息Schema, type 智能体消息类型 } from '../../agent/types'
import type { 会话表, 公开会话, 公开消息, 查询会话列表选项, 消息表, 记忆数据库 } from '../types'

let 查询会话列表选项Schema = z.object({
  偏移: z.number().int().min(0).optional(),
  数量: z.number().int().min(1).max(1000).optional(),
})

function 解析消息载荷(载荷: unknown): 智能体消息类型 {
  let 值: unknown = typeof 载荷 === 'string' ? JSON.parse(载荷) : 载荷
  return 智能体消息Schema.parse(值)
}

function 转为公开会话(会话: 会话表): 公开会话 {
  return { ...会话 }
}

function 转为公开消息(消息: Selectable<消息表>): 公开消息 {
  return {
    id: 消息.id,
    序号: 消息.序号 ?? 0,
    会话id: 消息.会话id,
    父消息id: 消息.父消息id,
    消息: 解析消息载荷(消息.载荷),
    创建时间: 消息.创建时间,
  }
}

export async function 创建会话(
  数据库查询器: Kysely<记忆数据库>,
  选项: {
    id?: string | undefined
    标题?: string | undefined
    前驱会话id?: string | null | undefined
    前驱消息id?: string | null | undefined
  } = {},
): Promise<公开会话> {
  let 前驱会话id = 选项.前驱会话id ?? null
  let 前驱消息id = 选项.前驱消息id ?? null
  if ((前驱会话id === null) !== (前驱消息id === null)) throw new Error('前驱会话id 和 前驱消息id 必须同时提供')
  if (前驱会话id !== null && 前驱消息id !== null) {
    let 前驱消息 = await 数据库查询器
      .selectFrom('消息表')
      .select(['id', '会话id'])
      .where('id', '=', 前驱消息id)
      .executeTakeFirst()
    if (前驱消息 === undefined || 前驱消息.会话id !== 前驱会话id) throw new Error('前驱消息不属于指定的前驱会话')
  }
  let id = 选项.id ?? randomUUID()
  if (id === 前驱会话id) throw new Error('会话不能以自身作为前驱会话')
  let 时间 = new Date()
  let 会话 = await 数据库查询器
    .insertInto('会话表')
    .values({
      id,
      标题: 选项.标题 ?? '',
      当前消息id: null,
      前驱会话id,
      前驱消息id,
      创建时间: 时间,
      更新时间: 时间,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
  return 转为公开会话(会话)
}

export async function 查询会话(数据库查询器: Kysely<记忆数据库>, id: string): Promise<公开会话 | null> {
  let 会话 = await 数据库查询器.selectFrom('会话表').selectAll().where('id', '=', id).executeTakeFirst()
  return 会话 === undefined ? null : 转为公开会话(会话)
}

export async function 查询会话列表(数据库查询器: Kysely<记忆数据库>, 选项: 查询会话列表选项 = {}): Promise<公开会话[]> {
  let 已校验选项 = 查询会话列表选项Schema.parse(选项)
  let 会话列表 = await 数据库查询器
    .selectFrom('会话表')
    .selectAll()
    .orderBy('更新时间', 'desc')
    .orderBy('id', 'asc')
    .offset(已校验选项.偏移 ?? 0)
    .limit(已校验选项.数量 ?? 100)
    .execute()
  return 会话列表.map(转为公开会话)
}

export async function 更新会话标题(数据库查询器: Kysely<记忆数据库>, 会话id: string, 标题: string): Promise<公开会话> {
  let 会话 = await 数据库查询器
    .updateTable('会话表')
    .set({ 标题, 更新时间: new Date() })
    .where('id', '=', 会话id)
    .returningAll()
    .executeTakeFirstOrThrow()
  return 转为公开会话(会话)
}

export async function 追加消息列表(
  数据库查询器: Kysely<记忆数据库>,
  会话id: string,
  预期父消息id: string | null,
  消息列表: 智能体消息类型[],
): Promise<公开消息[]> {
  if (消息列表.length === 0) return []
  let 已校验消息列表 = z.array(智能体消息Schema).parse(消息列表)
  return await 数据库查询器.transaction().execute(async (trx): Promise<公开消息[]> => {
    let 当前会话 = await trx.selectFrom('会话表').select('当前消息id').where('id', '=', 会话id).executeTakeFirst()
    if (当前会话 === undefined) throw new Error(`会话不存在: ${会话id}`)
    if (当前会话.当前消息id !== 预期父消息id) throw new Error('会话 HEAD 已变化，拒绝覆盖并发写入')

    let 父消息id = 预期父消息id
    let 新消息列表: 公开消息[] = []
    for (let 消息 of 已校验消息列表) {
      let id = randomUUID()
      let 结果 = await trx
        .insertInto('消息表')
        .values({
          id,
          会话id,
          父消息id,
          角色: 消息.role,
          载荷: JSON.stringify(消息),
          创建时间: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow()
      新消息列表.push(转为公开消息(结果))
      父消息id = id
    }

    let 更新 = trx.updateTable('会话表').set({ 当前消息id: 父消息id, 更新时间: new Date() }).where('id', '=', 会话id)
    更新 = 预期父消息id === null ? 更新.where('当前消息id', 'is', null) : 更新.where('当前消息id', '=', 预期父消息id)
    let 更新结果 = await 更新.executeTakeFirst()
    if (Number(更新结果.numUpdatedRows) !== 1) throw new Error('会话 HEAD 已变化，拒绝覆盖并发写入')
    return 新消息列表
  })
}

export async function 读取消息历史(
  数据库查询器: Kysely<记忆数据库>,
  消息id: string,
  向上回溯条数: number = 10000,
): Promise<公开消息[]> {
  let 已校验数量 = z.number().int().min(1).max(100000).parse(向上回溯条数)
  let 结果 = await sql<Selectable<消息表> & { 深度: number }>`
    WITH RECURSIVE 消息链 AS (
      SELECT m.*, 0 AS 深度
      FROM 消息表 m
      WHERE m.id = ${消息id}
      UNION ALL
      SELECT p.*, c.深度 + 1 AS 深度
      FROM 消息表 p
      JOIN 消息链 c ON p.id = c.父消息id
      WHERE c.深度 + 1 < ${已校验数量}
    )
    SELECT * FROM 消息链 ORDER BY 深度 DESC
  `.execute(数据库查询器)
  return 结果.rows.map(转为公开消息)
}

export async function 读取会话消息(数据库查询器: Kysely<记忆数据库>, 会话id: string): Promise<公开消息[]> {
  let 会话 = await 查询会话(数据库查询器, 会话id)
  if (会话 === null) throw new Error(`会话不存在: ${会话id}`)
  if (会话.当前消息id === null) return []
  return await 读取消息历史(数据库查询器, 会话.当前消息id)
}

export async function 查询消息分支(数据库查询器: Kysely<记忆数据库>, 消息id: string): Promise<公开消息[]> {
  let 结果 = await 数据库查询器
    .selectFrom('消息表')
    .selectAll()
    .where('父消息id', '=', 消息id)
    .orderBy('序号', 'asc')
    .execute()
  return 结果.map(转为公开消息)
}

export async function 检出消息(数据库查询器: Kysely<记忆数据库>, 会话id: string, 消息id: string | null): Promise<void> {
  if (消息id !== null) {
    let 消息 = await 数据库查询器.selectFrom('消息表').select('会话id').where('id', '=', 消息id).executeTakeFirst()
    if (消息 === undefined || 消息.会话id !== 会话id) throw new Error('目标消息不属于指定会话')
  }
  let 结果 = await 数据库查询器
    .updateTable('会话表')
    .set({ 当前消息id: 消息id, 更新时间: new Date() })
    .where('id', '=', 会话id)
    .executeTakeFirst()
  if (Number(结果.numUpdatedRows) !== 1) throw new Error(`会话不存在: ${会话id}`)
}

export async function 查询全部会话(数据库查询器: Kysely<记忆数据库>): Promise<会话表[]> {
  return await 数据库查询器.selectFrom('会话表').selectAll().orderBy('创建时间', 'asc').orderBy('id', 'asc').execute()
}

export async function 查询全部消息(数据库查询器: Kysely<记忆数据库>): Promise<公开消息[]> {
  let 结果 = await 数据库查询器.selectFrom('消息表').selectAll().orderBy('序号', 'asc').execute()
  return 结果.map(转为公开消息)
}
