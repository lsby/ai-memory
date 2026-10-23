import type { Kysely } from 'kysely'
import type { 智能体事件 } from '../agent/types'
import {
  检查并清理二级记忆 as 外部检查并清理二级记忆,
  检查并降级一级记忆 as 外部检查并降级一级记忆,
} from './agent-memory-lifecycle'
import { 保存快照 as 外部保存快照 } from './agent-memory-snapshot'
import type { 内部带记忆的智能体配置, 获取向量结果, 记忆操作上下文, 记忆数据库 } from './agent-memory-types'
import { type 向量缓存, 向量未预取错误, 新向量缓存, 预取向量 } from './agent-memory-vector-cache'
import type { 动态工具上下文 } from './tools/dynamic-tool-api'

/** 构建上下文所需的、由实例提供的能力。 */
export type 上下文依赖 = {
  配置: 内部带记忆的智能体配置
  /** 开一个事务执行记忆变更（互斥、提交记录、向量未预取时回滚重试都在里面）。 */
  执行记忆变更任务: <R>(
    消息: string,
    操作: (trx: Kysely<记忆数据库>, 父提交id: string | null) => Promise<R>,
    缓存: 向量缓存,
    回调?: (事件: 智能体事件) => Promise<void>,
  ) => Promise<R>
}

export async function 创建向量缓存(
  配置: 内部带记忆的智能体配置,
  内容列表: string[],
  回调?: (事件: 智能体事件) => Promise<void>,
): Promise<向量缓存> {
  let 缓存 = 新向量缓存()
  await 预取向量(缓存, 内容列表, 配置.向量模型, 回调)
  return 缓存
}

export function 构建操作上下文(
  依赖: 上下文依赖,
  trx: Kysely<记忆数据库>,
  回调?: (事件: 智能体事件) => Promise<void>,
  缓存: 向量缓存 = 新向量缓存(),
): 记忆操作上下文 {
  let { 配置 } = 依赖
  return {
    数据库查询器: trx,
    配置,
    获取向量: async (内容): Promise<获取向量结果> => {
      let 结果 = 缓存.结果.get(内容)
      if (结果 === undefined) {
        缓存.缺失.add(内容)
        throw new 向量未预取错误(内容)
      }
      return 结果
    },
    带向量缓存: async (内容列表): Promise<记忆操作上下文> =>
      构建操作上下文(依赖, trx, 回调, await 创建向量缓存(配置, 内容列表, 回调)),
    检查并降级一级记忆: async () =>
      await 外部检查并降级一级记忆(trx, 配置, async (cb) => await 外部检查并清理二级记忆(trx, 配置, cb), 回调),
    检查并清理二级记忆: async () => await 外部检查并清理二级记忆(trx, 配置, 回调),
    保存快照: async () => await 外部保存快照(trx),
    执行记忆变更: async <R>(消息: string, 操作: (上下文: 记忆操作上下文) => Promise<R>): Promise<R> => {
      if (trx.isTransaction === true) return await 操作(构建操作上下文(依赖, trx, 回调, 缓存))
      return await 依赖.执行记忆变更任务(
        消息,
        async (事务) => await 操作(构建操作上下文(依赖, 事务, 回调, 缓存)),
        缓存,
        回调,
      )
    },
    回调,
  }
}

export function 构建动态操作上下文(
  依赖: 上下文依赖,
  trx: Kysely<记忆数据库>,
  回调?: (事件: 智能体事件) => Promise<void>,
  缓存?: 向量缓存,
): 动态工具上下文 {
  let 上下文 = 构建操作上下文(依赖, trx, 回调, 缓存)
  return {
    ...上下文,
    获取向量: async (内容: string): Promise<number[] | null> => {
      let 结果 = await 上下文.获取向量(内容)
      return 结果.类型 === '成功' ? 结果.向量 : null
    },
  }
}
