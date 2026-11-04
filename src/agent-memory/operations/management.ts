import type { Kysely } from 'kysely'
import { z } from 'zod'
import { 同步记忆线索, 读取记忆线索映射 } from '../storage/clue-storage'
import { 增量排版 } from '../tools/layout'
import {
  更新记忆选项Schema,
  记忆等级,
  type 公开动态工具,
  type 公开线索,
  type 公开记忆,
  type 公开记忆提交,
  type 公开记忆线索关联,
  type 更新记忆选项,
  type 查询记忆选项,
  type 记忆操作上下文,
  type 记忆数据库,
} from '../types'

let 查询记忆选项Schema = z.object({
  等级: z.nativeEnum(记忆等级).optional(),
  线索: z.string().min(1).optional(),
  搜索文本: z.string().min(1).optional(),
  偏移: z.number().int().min(0).optional(),
  数量: z.number().int().min(1).optional(),
})

export async function 查询记忆(数据库查询器: Kysely<记忆数据库>, 选项: 查询记忆选项 = {}): Promise<公开记忆[]> {
  let 已校验选项 = 查询记忆选项Schema.parse(选项)
  let 记忆列表 = await 数据库查询器
    .selectFrom('当前记忆表')
    .select(['id', '等级', '评分', '内容', '创建时间'])
    .orderBy('创建序号')
    .execute()
  let 线索映射 = await 读取记忆线索映射(
    数据库查询器,
    记忆列表.map((记忆) => 记忆.id),
  )
  let 匹配列表 = 记忆列表.filter(
    (记忆): boolean =>
      (已校验选项.等级 === undefined || 记忆.等级 === 已校验选项.等级) &&
      (已校验选项.线索 === undefined || (线索映射.get(记忆.id) ?? []).includes(已校验选项.线索)) &&
      (已校验选项.搜索文本 === undefined ||
        记忆.内容.toLocaleLowerCase().includes(已校验选项.搜索文本.toLocaleLowerCase())),
  )
  let 起点 = 已校验选项.偏移 ?? 0
  let 终点 = 已校验选项.数量 === undefined ? undefined : 起点 + 已校验选项.数量
  return 匹配列表.slice(起点, 终点).map((记忆): 公开记忆 => ({ ...记忆, 线索: 线索映射.get(记忆.id) ?? [] }))
}

export async function 更新记忆(上下文: 记忆操作上下文, id: string, 选项: 更新记忆选项): Promise<boolean> {
  let 已校验id = z.string().trim().min(1).parse(id)
  let 已校验选项 = 更新记忆选项Schema.parse(选项)
  let { 数据库查询器, 获取向量, 检查并降级一级记忆, 检查并清理二级记忆 } = 上下文
  let 原记忆 = await 数据库查询器.selectFrom('当前记忆表').selectAll().where('id', '=', 已校验id).executeTakeFirst()
  if (原记忆 === undefined) return false
  let 新内容 = 已校验选项.内容 ?? 原记忆.内容
  let 原线索映射 = await 读取记忆线索映射(数据库查询器, [已校验id])
  let 新线索 = 已校验选项.线索 ?? 原线索映射.get(已校验id) ?? []
  let 向量 = 原记忆.向量
  let 向量维度 = 原记忆.向量维度
  if (已校验选项.内容 !== undefined) {
    let 向量结果 = await 获取向量(新内容)
    向量 = 向量结果.类型 === '成功' ? JSON.stringify(向量结果.向量) : null
    向量维度 = 向量结果.类型 === '成功' ? 向量结果.向量.length : null
  }
  await 数据库查询器
    .updateTable('当前记忆表')
    .set({
      内容: 新内容,
      评分: 已校验选项.评分 ?? 原记忆.评分,
      等级: 已校验选项.等级 ?? 原记忆.等级,
      向量,
      向量维度,
    })
    .where('id', '=', 已校验id)
    .execute()
  if (已校验选项.内容 !== undefined || 已校验选项.线索 !== undefined) {
    await 同步记忆线索(
      {
        数据库查询器,
        获取向量: async (内容): Promise<number[] | null> => {
          let 结果 = await 获取向量(内容)
          return 结果.类型 === '成功' ? 结果.向量 : null
        },
      },
      已校验id,
      新内容,
      新线索,
    )
    await 增量排版(数据库查询器, 已校验id)
  }
  await 检查并降级一级记忆()
  await 检查并清理二级记忆()
  return true
}

export async function 查询线索(数据库查询器: Kysely<记忆数据库>): Promise<公开线索[]> {
  return await 数据库查询器.selectFrom('当前线索表').select(['id', '内容', '创建时间']).orderBy('创建时间').execute()
}

export async function 查询记忆线索关联(数据库查询器: Kysely<记忆数据库>, 记忆id?: string): Promise<公开记忆线索关联[]> {
  let 查询 = 数据库查询器.selectFrom('当前记忆线索关联表').select(['记忆id', '线索id'])
  if (记忆id !== undefined) 查询 = 查询.where('记忆id', '=', z.string().trim().min(1).parse(记忆id))
  return await 查询.execute()
}

export async function 查询动态工具(数据库查询器: Kysely<记忆数据库>): Promise<公开动态工具[]> {
  return await 数据库查询器
    .selectFrom('当前动态工具表')
    .select(['id', '名称', '描述', '代码', '创建时间'])
    .orderBy('创建时间', 'asc')
    .execute()
}

export async function 查询记忆提交(数据库查询器: Kysely<记忆数据库>, 数量: number = 50): Promise<公开记忆提交[]> {
  let 已校验数量 = z.number().int().min(1).max(1000).parse(数量)
  let 提交列表 = await 数据库查询器
    .selectFrom('记忆提交表')
    .selectAll()
    .orderBy('创建时间', 'desc')
    .limit(已校验数量)
    .execute()
  if (提交列表.length === 0) return []
  let 变更列表 = await 数据库查询器
    .selectFrom('记忆行变更表')
    .selectAll()
    .where(
      '记忆提交id',
      'in',
      提交列表.map((提交) => 提交.id),
    )
    .orderBy('提交内序号', 'asc')
    .execute()
  return 提交列表.map((提交): 公开记忆提交 => ({
    ...提交,
    变更列表: 变更列表.filter((变更) => 变更.记忆提交id === 提交.id).map(({ 记忆提交id: _提交id, ...变更 }) => 变更),
  }))
}
