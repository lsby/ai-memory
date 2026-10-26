import type { Kysely } from 'kysely'
import { randomUUID } from 'node:crypto'
import { z, type ZodType } from 'zod'
import type { 回合结果, 智能体事件 } from '../agent/types'
import { 在提交中执行, 获取当前提交ID } from './operations/commit'
import { 向量未预取错误, 预取向量, type 向量缓存 } from './storage/vector-cache'
import {
  JSON值Schema,
  交互日志事件Schema,
  交互日志事件类型Schema,
  type JSON值,
  type 交互日志事件,
  type 公开交互日志,
  type 内部带记忆的智能体配置,
  type 查询交互日志选项,
  type 记忆数据库,
} from './types'

export function 创建事件组id(事件组id?: string): string {
  return 事件组id === undefined ? randomUUID() : z.string().trim().min(1).parse(事件组id)
}

export function 转为JSON值(值: unknown): JSON值 {
  let 文本 = JSON.stringify(值)
  return JSON值Schema.parse(JSON.parse(文本))
}

export async function 执行带日志的记忆变更<R>(
  数据库查询器: Kysely<记忆数据库>,
  配置: 内部带记忆的智能体配置,
  消息: string,
  操作: (trx: Kysely<记忆数据库>, 父提交id: string | null) => Promise<R>,
  缓存: 向量缓存,
  回调?: (事件: 智能体事件) => Promise<void>,
  事件组id?: string,
): Promise<R> {
  let 已校验事件组id = 创建事件组id(事件组id)
  let 开始时间 = new Date()
  for (let 尝试次数 = 1; ; 尝试次数++) {
    try {
      return await 数据库查询器.transaction().execute(async (trx) => {
        let 原提交id = await 获取当前提交ID(trx)
        await 记录交互日志(trx, { 类型: '流程开始', 开始时间, 内容: { 入口: 消息 } }, 已校验事件组id)
        let 结果 = await 在提交中执行(trx, 消息, 操作)
        if (缓存.缺失.size > 0) throw new 向量未预取错误([...缓存.缺失][0] ?? '')
        let 当前提交id = await 获取当前提交ID(trx)
        let 耗时ms = Date.now() - 开始时间.getTime()
        if (当前提交id !== 原提交id) {
          await 记录交互日志(
            trx,
            {
              类型: '记忆提交',
              开始时间,
              耗时ms,
              内容: { 消息 },
              ...(当前提交id !== null ? { 记忆提交id: 当前提交id } : {}),
            },
            已校验事件组id,
          )
        }
        await 记录交互日志(
          trx,
          {
            类型: '流程结束',
            开始时间,
            耗时ms,
            内容: { 入口: 消息 },
            ...(当前提交id !== null ? { 记忆提交id: 当前提交id } : {}),
          },
          已校验事件组id,
        )
        return 结果
      })
    } catch (错误) {
      if (错误 instanceof 向量未预取错误 === false || 尝试次数 >= 3) throw 错误
      await 预取向量(缓存, [...缓存.缺失], 配置.向量模型, 回调)
      缓存.缺失.clear()
    }
  }
}

export async function 执行带日志的分支切换(
  数据库查询器: Kysely<记忆数据库>,
  入口: string,
  请求内容: JSON值,
  操作: (trx: Kysely<记忆数据库>) => Promise<boolean>,
  事件组id?: string,
): Promise<boolean> {
  let 已校验事件组id = 创建事件组id(事件组id)
  let 开始时间 = new Date()
  return await 数据库查询器.transaction().execute(async (trx) => {
    await 记录交互日志(trx, { 类型: '流程开始', 开始时间, 内容: { 入口 } }, 已校验事件组id)
    let 结果 = await 操作(trx)
    let 耗时ms = Date.now() - 开始时间.getTime()
    let 当前提交id = await 获取当前提交ID(trx)
    await 记录交互日志(
      trx,
      {
        类型: '记忆分支切换',
        开始时间,
        耗时ms,
        内容: { 请求: 请求内容, 结果, 当前提交id },
        ...(当前提交id !== null ? { 记忆提交id: 当前提交id } : {}),
      },
      已校验事件组id,
    )
    await 记录交互日志(trx, { 类型: '流程结束', 开始时间, 耗时ms, 内容: { 入口 } }, 已校验事件组id)
    return 结果
  })
}

export async function 执行带日志的推理流程<T extends ZodType>(
  数据库查询器: Kysely<记忆数据库>,
  流程内容: JSON值,
  原回调: (事件: 智能体事件) => Promise<void>,
  操作: (日志回调: (事件: 智能体事件) => Promise<void>, 事件组id: string) => Promise<回合结果<T>>,
  事件组id?: string,
  获取上下文消息id?: () => string | null,
): Promise<回合结果<T>> {
  let 已校验事件组id = 创建事件组id(事件组id)
  let 开始时间 = new Date()
  let 日志回调 = async (事件: 智能体事件): Promise<void> => {
    await 原回调(事件)
    if (事件.类型 === 'AI文本片段' || 事件.类型 === '原始AI返回' || 事件.类型 === '最终结果') return
    let 耗时ms = '耗时ms' in 事件 && typeof 事件.耗时ms === 'number' ? 事件.耗时ms : undefined
    let 持久化事件内容: object
    if (事件.类型 === '原始请求配置') {
      let 允许字段 = new Set(['model', 'max_tokens', 'temperature', 'top_p', 'presence_penalty', 'frequency_penalty'])
      let 配置 = Object.fromEntries(Object.entries(事件.配置).filter(([键]) => 允许字段.has(键)))
      持久化事件内容 = { 配置 }
    } else if (事件.类型 === '工具调用开始') {
      持久化事件内容 = { 工具名称: 事件.工具名称, id: 事件.id }
    } else if (事件.类型 === '工具调用结果') {
      持久化事件内容 = { 工具名称: 事件.工具名称, id: 事件.id, 状态: 事件.结果.结果 }
    } else if (事件.类型 === '模型响应完成') {
      持久化事件内容 = {
        模型请求序号: 事件.模型请求序号,
        状态: 事件.状态,
        工具调用数量: 事件.工具调用数量,
      }
    } else if (事件.类型 === '校验失败') {
      持久化事件内容 = { 当前次数: 事件.当前次数, 最大次数: 事件.最大次数 }
    } else if (事件.类型 === '工具调用失败') {
      持久化事件内容 = {
        工具名称: 事件.工具名称,
        id: 事件.id,
        错误信息: 事件.错误信息.slice(0, 1000),
      }
    } else if (事件.类型 === '错误') {
      持久化事件内容 = { 错误信息: 事件.错误信息.slice(0, 1000) }
    } else {
      let { 类型: _类型, ...事件内容 } = 事件
      持久化事件内容 = 事件内容
    }
    let 上下文消息id = 获取上下文消息id?.() ?? undefined
    let 记忆提交id = (await 获取当前提交ID(数据库查询器)) ?? undefined
    let 模型请求id = '模型请求id' in 事件 ? 事件.模型请求id : undefined
    let 前缀id = '前缀id' in 事件 ? 事件.前缀id : undefined
    let 消息id = 事件.类型 === '模型响应完成' ? 事件.响应消息id : undefined
    await 记录交互日志(
      数据库查询器,
      {
        类型: 事件.类型,
        开始时间: new Date(),
        ...(耗时ms !== undefined ? { 耗时ms } : {}),
        内容: 转为JSON值(持久化事件内容),
        ...(上下文消息id !== undefined ? { 上下文消息id } : {}),
        ...(消息id !== undefined ? { 消息id } : {}),
        ...(模型请求id !== undefined ? { 模型请求id } : {}),
        ...(记忆提交id !== undefined ? { 记忆提交id } : {}),
        ...(前缀id !== undefined ? { 前缀id } : {}),
      },
      已校验事件组id,
    )
  }
  let 开始记忆提交id = (await 获取当前提交ID(数据库查询器)) ?? undefined
  await 记录交互日志(
    数据库查询器,
    {
      类型: '流程开始',
      开始时间,
      内容: 流程内容,
      ...(开始记忆提交id !== undefined ? { 记忆提交id: 开始记忆提交id } : {}),
    },
    已校验事件组id,
  )
  try {
    let 结果 = await 操作(日志回调, 已校验事件组id)
    let 结束上下文消息id = 获取上下文消息id?.() ?? undefined
    let 结束记忆提交id = (await 获取当前提交ID(数据库查询器)) ?? undefined
    await 记录交互日志(
      数据库查询器,
      {
        类型: '流程结束',
        开始时间,
        耗时ms: Date.now() - 开始时间.getTime(),
        内容: 转为JSON值({ 结束原因: 结果.结束原因, 用量: 结果.用量 }),
        ...(结束上下文消息id !== undefined ? { 上下文消息id: 结束上下文消息id } : {}),
        ...(结束记忆提交id !== undefined ? { 记忆提交id: 结束记忆提交id } : {}),
      },
      已校验事件组id,
    )
    return 结果
  } catch (错误) {
    await 记录交互日志(
      数据库查询器,
      {
        类型: '流程异常',
        开始时间,
        耗时ms: Date.now() - 开始时间.getTime(),
        内容: 转为JSON值(
          错误 instanceof Error
            ? { 名称: 错误.name, 消息: 错误.message.slice(0, 1000) }
            : { 错误: String(错误).slice(0, 1000) },
        ),
      },
      已校验事件组id,
    )
    throw 错误
  }
}

export async function 记录交互日志(
  数据库查询器: Kysely<记忆数据库>,
  事件: 交互日志事件,
  事件组id?: string,
): Promise<公开交互日志> {
  let 已校验事件 = 交互日志事件Schema.parse(事件)
  let 已校验事件组id = 创建事件组id(事件组id)
  let id = randomUUID()
  let 结果 = await 数据库查询器
    .insertInto('交互日志表')
    .values({
      id,
      事件组id: 已校验事件组id,
      类型: 已校验事件.类型,
      开始时间: 已校验事件.开始时间,
      耗时ms: 已校验事件.耗时ms ?? null,
      内容: JSON.stringify(已校验事件.内容),
      上下文消息id: 已校验事件.上下文消息id ?? null,
      消息id: 已校验事件.消息id ?? null,
      模型请求id: 已校验事件.模型请求id ?? null,
      记忆提交id: 已校验事件.记忆提交id ?? null,
      前缀id: 已校验事件.前缀id ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
  return {
    id: 结果.id,
    序号: 结果.序号 ?? 0,
    事件组id: 结果.事件组id,
    类型: 结果.类型,
    开始时间: 结果.开始时间,
    ...(结果.耗时ms !== null ? { 耗时ms: 结果.耗时ms } : {}),
    内容: 结果.内容,
    ...(结果.上下文消息id !== null ? { 上下文消息id: 结果.上下文消息id } : {}),
    ...(结果.消息id !== null ? { 消息id: 结果.消息id } : {}),
    ...(结果.模型请求id !== null ? { 模型请求id: 结果.模型请求id } : {}),
    ...(结果.记忆提交id !== null ? { 记忆提交id: 结果.记忆提交id } : {}),
    ...(结果.前缀id !== null ? { 前缀id: 结果.前缀id } : {}),
  }
}

export async function 查询交互日志(
  数据库查询器: Kysely<记忆数据库>,
  选项: 查询交互日志选项 = {},
): Promise<公开交互日志[]> {
  let 已校验选项 = z
    .object({
      事件组id: z.string().trim().min(1).optional(),
      类型: 交互日志事件类型Schema.optional(),
      偏移: z.number().int().min(0).optional(),
      数量: z.number().int().min(1).max(1000).optional(),
    })
    .parse(选项)
  let 查询 = 数据库查询器.selectFrom('交互日志表').selectAll()
  if (已校验选项.事件组id !== undefined) 查询 = 查询.where('事件组id', '=', 已校验选项.事件组id)
  if (已校验选项.类型 !== undefined) 查询 = 查询.where('类型', '=', 已校验选项.类型)
  let 结果列表 = await 查询
    .orderBy('序号', 'asc')
    .offset(已校验选项.偏移 ?? 0)
    .limit(已校验选项.数量 ?? 100)
    .execute()
  return 结果列表.map((结果): 公开交互日志 => ({
    id: 结果.id,
    序号: 结果.序号 ?? 0,
    事件组id: 结果.事件组id,
    类型: 结果.类型,
    开始时间: 结果.开始时间,
    ...(结果.耗时ms !== null ? { 耗时ms: 结果.耗时ms } : {}),
    内容: 结果.内容,
    ...(结果.上下文消息id !== null ? { 上下文消息id: 结果.上下文消息id } : {}),
    ...(结果.消息id !== null ? { 消息id: 结果.消息id } : {}),
    ...(结果.模型请求id !== null ? { 模型请求id: 结果.模型请求id } : {}),
    ...(结果.记忆提交id !== null ? { 记忆提交id: 结果.记忆提交id } : {}),
    ...(结果.前缀id !== null ? { 前缀id: 结果.前缀id } : {}),
  }))
}
