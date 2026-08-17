import type { Kysely } from 'kysely'
import { z } from 'zod'
import {
  更新记忆选项Schema,
  记忆等级,
  type 公开动态工具,
  type 公开记忆,
  type 公开记忆关联,
  type 公开记忆提交,
  type 更新记忆选项,
  type 查询记忆选项,
  type 记忆操作上下文,
  type 记忆数据库,
} from './agent-memory-types'
import { 刷新记忆关联网络 } from './tools/common'
import { 增量排版 } from './tools/layout'

let 查询记忆选项Schema = z.object({
  等级: z.nativeEnum(记忆等级).optional(),
  标签: z.string().min(1).optional(),
  关键词: z.string().min(1).optional(),
  搜索文本: z.string().min(1).optional(),
  偏移: z.number().int().min(0).optional(),
  数量: z.number().int().min(1).optional(),
})

export async function 查询记忆(数据库查询器: Kysely<记忆数据库>, 选项: 查询记忆选项 = {}): Promise<公开记忆[]> {
  let 已校验选项 = 查询记忆选项Schema.parse(选项)
  let 记忆列表 = await 数据库查询器
    .selectFrom('记忆表')
    .select(['id', '等级', '评分', '内容', '关键词', '标签', '创建时间'])
    .orderBy('创建序号')
    .execute()
  let 匹配列表 = 记忆列表.filter(
    (记忆): boolean =>
      (已校验选项.等级 === undefined || 记忆.等级 === 已校验选项.等级) &&
      (已校验选项.标签 === undefined || 记忆.标签.includes(已校验选项.标签)) &&
      (已校验选项.关键词 === undefined || 记忆.关键词.includes(已校验选项.关键词)) &&
      (已校验选项.搜索文本 === undefined ||
        记忆.内容.toLocaleLowerCase().includes(已校验选项.搜索文本.toLocaleLowerCase())),
  )
  let 起点 = 已校验选项.偏移 ?? 0
  let 终点 = 已校验选项.数量 === undefined ? undefined : 起点 + 已校验选项.数量
  return 匹配列表
    .slice(起点, 终点)
    .map((记忆): 公开记忆 => ({ ...记忆, 关键词: [...记忆.关键词], 标签: [...记忆.标签] }))
}

export async function 更新记忆(上下文: 记忆操作上下文, id: string, 选项: 更新记忆选项): Promise<boolean> {
  let 已校验id = z.string().trim().min(1).parse(id)
  let 已校验选项 = 更新记忆选项Schema.parse(选项)
  let { 数据库查询器, 配置, 获取向量, 检查并降级一级记忆, 检查并清理二级记忆, 回调 } = 上下文
  let 原记忆 = await 数据库查询器.selectFrom('记忆表').selectAll().where('id', '=', 已校验id).executeTakeFirst()
  if (原记忆 === undefined) return false
  let 新内容 = 已校验选项.内容 ?? 原记忆.内容
  let 新关键词 = 已校验选项.关键词 ?? 原记忆.关键词
  let 向量 = 原记忆.向量
  let 向量维度 = 原记忆.向量维度
  if (已校验选项.内容 !== undefined) {
    let 向量结果 = await 获取向量(新内容)
    向量 = 向量结果.类型 === '成功' ? JSON.stringify(向量结果.向量) : null
    向量维度 = 向量结果.类型 === '成功' ? 向量结果.向量.length : null
  }
  await 数据库查询器
    .updateTable('记忆表')
    .set({
      内容: 新内容,
      关键词: 新关键词,
      标签: 已校验选项.标签 ?? 原记忆.标签,
      评分: 已校验选项.评分 ?? 原记忆.评分,
      等级: 已校验选项.等级 ?? 原记忆.等级,
      向量,
      向量维度,
    })
    .where('id', '=', 已校验id)
    .execute()
  if (已校验选项.内容 !== undefined || 已校验选项.关键词 !== undefined) {
    await 刷新记忆关联网络(数据库查询器, 已校验id, 新关键词, 配置, 回调)
    await 增量排版(数据库查询器, 已校验id)
  }
  await 检查并降级一级记忆()
  await 检查并清理二级记忆()
  return true
}

export async function 查询记忆关联(数据库查询器: Kysely<记忆数据库>, id?: string): Promise<公开记忆关联[]> {
  let 查询 = 数据库查询器.selectFrom('记忆关联表').selectAll().orderBy('关联度', 'desc')
  if (id !== undefined) {
    let 已校验id = z.string().trim().min(1).parse(id)
    查询 = 查询.where((eb) => eb.or([eb('起点id', '=', 已校验id), eb('终点id', '=', 已校验id)]))
  }
  return await 查询.execute()
}

export async function 查询动态工具(数据库查询器: Kysely<记忆数据库>): Promise<公开动态工具[]> {
  return await 数据库查询器
    .selectFrom('动态工具表')
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
    .selectFrom('记忆变更表')
    .selectAll()
    .where(
      '提交id',
      'in',
      提交列表.map((提交) => 提交.id),
    )
    .execute()
  return 提交列表.map((提交): 公开记忆提交 => ({
    ...提交,
    变更列表: 变更列表
      .filter((变更) => 变更.提交id === 提交.id)
      .map(({ 提交id: _提交id, 序号: _序号, ...变更 }) => 变更),
  }))
}
