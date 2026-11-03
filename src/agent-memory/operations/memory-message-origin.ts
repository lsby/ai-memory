import type { Kysely } from 'kysely'
import { JSON值Schema, type JSON值, type 记忆数据库 } from '../types'

export type 记忆相关消息 = { 消息id: string; 关系: '新增'; 记忆提交id: string }

function 读取对象字段(值: JSON值, 字段: string): string | undefined {
  let 已解析值: JSON值 = 值
  if (typeof 值 === 'string') {
    try {
      已解析值 = JSON值Schema.parse(JSON.parse(值))
    } catch {
      return undefined
    }
  }
  if (typeof 已解析值 !== 'object' || 已解析值 === null || Array.isArray(已解析值)) return undefined
  let 字段值 = 已解析值[字段]
  return typeof 字段值 === 'string' ? 字段值 : undefined
}

export async function 查询记忆新增相关消息(
  数据库查询器: Kysely<记忆数据库>,
  记忆id: string,
  允许消息id集合?: ReadonlySet<string>,
): Promise<记忆相关消息[]> {
  // 博闻强记目前只暴露“新增记忆”的因果关系；更新、降级等关系留给后续明确语义后再扩展。
  let 变更列表 = await 数据库查询器
    .selectFrom('记忆变更表')
    .select(['提交id'])
    .where('目标类型', '=', 'node')
    .where('记忆id', '=', 记忆id)
    .where('操作类型', '=', 'add')
    .execute()
  let 结果: 记忆相关消息[] = []
  for (let 变更 of 变更列表) {
    let 提交 = await 数据库查询器
      .selectFrom('记忆提交表')
      .select(['id', '父提交id'])
      .where('id', '=', 变更.提交id)
      .executeTakeFirst()
    if (提交 === undefined) continue
    let 提交日志 = await 数据库查询器
      .selectFrom('交互日志表')
      .select(['事件组id'])
      .where('类型', '=', '记忆提交')
      .where('记忆提交id', '=', 提交.id)
      .execute()
    for (let 日志 of 提交日志) {
      let 工具日志 = await 数据库查询器
        .selectFrom('交互日志表')
        .select(['类型', '内容', '消息id', '模型请求id', '记忆提交id'])
        .where('事件组id', '=', 日志.事件组id)
        .where('类型', 'in', ['工具调用开始', '工具调用结果'])
        .execute()
      for (let 结果日志 of 工具日志.filter((项) => 项.类型 === '工具调用结果')) {
        if (结果日志.记忆提交id !== 提交.id || 结果日志.消息id === null) continue
        let 调用id = 读取对象字段(结果日志.内容, 'id')
        let 开始日志 = 工具日志.find(
          (项): boolean =>
            项.类型 === '工具调用开始' &&
            项.模型请求id === 结果日志.模型请求id &&
            读取对象字段(项.内容, 'id') === 调用id &&
            项.记忆提交id === 提交.父提交id,
        )
        if (开始日志 === undefined) continue
        if (允许消息id集合 !== undefined && 允许消息id集合.has(结果日志.消息id) === false) continue
        结果.push({ 消息id: 结果日志.消息id, 关系: '新增', 记忆提交id: 提交.id })
      }
    }
  }
  return 结果
}
