import type { Kysely } from 'kysely'
import { randomUUID } from 'node:crypto'
import type { 记忆数据库 } from '../types'

export function 生成记忆线索向量文本(内容: string, 线索: string): string {
  return `这条记忆通过线索「${线索}」被联想到：\n${内容}`
}

export function 生成记忆所需向量文本(内容: string, 线索列表: string[]): string[] {
  let 线索 = Array.from(new Set(线索列表.map((项) => 项.trim()).filter((项) => 项 !== '')))
  return [内容, ...线索, ...线索.map((项) => 生成记忆线索向量文本(内容, 项))]
}

export function 生成技能线索向量文本(名称: string, 描述: string, 线索: string): string {
  return `技能「${名称}」通过线索「${线索}」被联想到：\n${描述}`
}

export function 生成技能所需向量文本(名称: string, 描述: string, 线索列表: string[]): string[] {
  let 线索 = Array.from(new Set(线索列表.map((项) => 项.trim()).filter((项) => 项 !== '')))
  return [`${名称} ${描述}`, ...线索, ...线索.map((项) => 生成技能线索向量文本(名称, 描述, 项))]
}

export async function 清理孤立线索(数据库查询器: Kysely<记忆数据库>): Promise<void> {
  let 线索列表 = await 数据库查询器.selectFrom('当前线索表').select('id').execute()
  if (线索列表.length === 0) return
  let 记忆关联列表 = await 数据库查询器.selectFrom('当前记忆线索关联表').select('线索id').execute()
  let 技能关联列表 = await 数据库查询器.selectFrom('当前技能线索关联表').select('线索id').execute()
  let 使用中 = new Set([...记忆关联列表, ...技能关联列表].map((关联) => 关联.线索id))
  let 孤立线索 = 线索列表.map((线索) => 线索.id).filter((id) => 使用中.has(id) === false)
  if (孤立线索.length > 0) await 数据库查询器.deleteFrom('当前线索表').where('id', 'in', 孤立线索).execute()
}

export async function 同步记忆线索(
  上下文: { 数据库查询器: Kysely<记忆数据库>; 获取向量: (内容: string) => Promise<number[] | null> },
  记忆id: string,
  内容: string,
  线索列表: string[],
): Promise<void> {
  let { 数据库查询器, 获取向量 } = 上下文
  let 线索文本列表 = Array.from(new Set(线索列表.map((项) => 项.trim()).filter((项) => 项 !== '')))
  await 数据库查询器.deleteFrom('当前记忆线索关联表').where('记忆id', '=', 记忆id).execute()

  for (let 线索文本 of 线索文本列表) {
    let 线索 = await 数据库查询器.selectFrom('当前线索表').selectAll().where('内容', '=', 线索文本).executeTakeFirst()
    if (线索 === undefined) {
      let 线索向量 = await 获取向量(线索文本)
      let 线索id = randomUUID()
      await 数据库查询器
        .insertInto('当前线索表')
        .values({
          id: 线索id,
          内容: 线索文本,
          向量: 线索向量 === null ? null : JSON.stringify(线索向量),
          向量维度: 线索向量?.length ?? null,
          创建时间: new Date(),
        })
        .execute()
      线索 = await 数据库查询器.selectFrom('当前线索表').selectAll().where('id', '=', 线索id).executeTakeFirst()
    }
    if (线索 === undefined) throw new Error(`创建线索失败: ${线索文本}`)
    let 关联向量 = await 获取向量(生成记忆线索向量文本(内容, 线索文本))
    await 数据库查询器
      .insertInto('当前记忆线索关联表')
      .values({
        记忆id,
        线索id: 线索.id,
        向量: 关联向量 === null ? null : JSON.stringify(关联向量),
        向量维度: 关联向量?.length ?? null,
      })
      .execute()
  }
  await 清理孤立线索(数据库查询器)
}

export async function 读取记忆线索映射(
  数据库查询器: Kysely<记忆数据库>,
  记忆id列表?: string[],
): Promise<Map<string, string[]>> {
  let 查询 = 数据库查询器
    .selectFrom('当前记忆线索关联表 as 关联')
    .innerJoin('当前线索表 as 线索', '线索.id', '关联.线索id')
    .select(['关联.记忆id', '线索.内容'])
  if (记忆id列表 !== undefined) {
    if (记忆id列表.length === 0) return new Map()
    查询 = 查询.where('关联.记忆id', 'in', 记忆id列表)
  }
  let 结果 = await 查询.execute()
  let 映射 = new Map<string, string[]>()
  for (let 行 of 结果) {
    let 列表 = 映射.get(行.记忆id) ?? []
    列表.push(行.内容)
    映射.set(行.记忆id, 列表)
  }
  return 映射
}

export async function 同步技能线索(
  上下文: { 数据库查询器: Kysely<记忆数据库>; 获取向量: (内容: string) => Promise<number[] | null> },
  技能id: string,
  名称: string,
  描述: string,
  线索列表: string[],
): Promise<void> {
  let { 数据库查询器, 获取向量 } = 上下文
  let 线索文本列表 = Array.from(new Set(线索列表.map((项) => 项.trim()).filter((项) => 项 !== '')))
  await 数据库查询器.deleteFrom('当前技能线索关联表').where('技能id', '=', 技能id).execute()
  for (let 线索文本 of 线索文本列表) {
    let 线索 = await 数据库查询器.selectFrom('当前线索表').selectAll().where('内容', '=', 线索文本).executeTakeFirst()
    if (线索 === undefined) {
      let 线索向量 = await 获取向量(线索文本)
      let 线索id = randomUUID()
      await 数据库查询器
        .insertInto('当前线索表')
        .values({
          id: 线索id,
          内容: 线索文本,
          向量: 线索向量 === null ? null : JSON.stringify(线索向量),
          向量维度: 线索向量?.length ?? null,
          创建时间: new Date(),
        })
        .execute()
      线索 = await 数据库查询器.selectFrom('当前线索表').selectAll().where('id', '=', 线索id).executeTakeFirst()
    }
    if (线索 === undefined) throw new Error(`创建线索失败: ${线索文本}`)
    let 关联向量 = await 获取向量(生成技能线索向量文本(名称, 描述, 线索文本))
    await 数据库查询器
      .insertInto('当前技能线索关联表')
      .values({
        技能id,
        线索id: 线索.id,
        向量: 关联向量 === null ? null : JSON.stringify(关联向量),
        向量维度: 关联向量?.length ?? null,
      })
      .execute()
  }
  await 清理孤立线索(数据库查询器)
}

export async function 读取技能线索映射(
  数据库查询器: Kysely<记忆数据库>,
  技能id列表?: string[],
): Promise<Map<string, string[]>> {
  let 查询 = 数据库查询器
    .selectFrom('当前技能线索关联表 as 关联')
    .innerJoin('当前线索表 as 线索', '线索.id', '关联.线索id')
    .select(['关联.技能id', '线索.内容'])
  if (技能id列表 !== undefined) {
    if (技能id列表.length === 0) return new Map()
    查询 = 查询.where('关联.技能id', 'in', 技能id列表)
  }
  let 结果 = await 查询.execute()
  let 映射 = new Map<string, string[]>()
  for (let 行 of 结果) {
    let 列表 = 映射.get(行.技能id) ?? []
    列表.push(行.内容)
    映射.set(行.技能id, 列表)
  }
  return 映射
}
