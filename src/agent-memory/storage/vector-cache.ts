import type { 智能体事件 } from '../../agent/types'
import { 获取向量 } from '../tools/get-vector'
import type { 内部带记忆的智能体配置, 获取向量结果 } from '../types'

/** 本次调用的向量缓存：事务外先把需要的向量算好放进来，事务内只读取这里。 */
export type 向量缓存 = { 结果: Map<string, 获取向量结果>; 缺失: Set<string> }

export function 新向量缓存(): 向量缓存 {
  return { 结果: new Map<string, 获取向量结果>(), 缺失: new Set<string>() }
}

/** 事务内需要某段文本的向量，但事务外没有预取。 */
export class 向量未预取错误 extends Error {
  public constructor(public readonly 内容: string) {
    super(`向量未预取: 事务内不允许发起向量请求，请先在事务外预取 (文本前 30 字: ${内容.slice(0, 30)})`)
    this.name = '向量未预取错误'
  }
}

/** 在事务外把这些文本的向量算好放进缓存（已有的不重算）。 */
export async function 预取向量(
  缓存: 向量缓存,
  内容列表: string[],
  向量模型: 内部带记忆的智能体配置['向量模型'],
  回调?: (事件: 智能体事件) => Promise<void>,
): Promise<void> {
  for (let 内容 of new Set(内容列表)) {
    if (缓存.结果.has(内容) === true) continue
    缓存.结果.set(内容, await 获取向量(向量模型, 内容, 回调))
  }
}
