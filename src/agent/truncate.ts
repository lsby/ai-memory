import { 统计字符数 } from './audit'
import { 转换为模型消息 } from './message-serialization'
import { 复制消息列表 } from './session-state'
import type { 智能体消息类型 } from './types'

export function 统计消息字符数(消息: 智能体消息类型): number {
  return 统计字符数(JSON.stringify(转换为模型消息(消息)))
}

export function 统计历史字符数(历史: 智能体消息类型[]): number {
  let 总数 = 0
  for (let 消息 of 历史) 总数 += 统计消息字符数(消息)
  return 总数
}

/** 真实用户消息: 不是库注入的上下文, 也不是纠错提示 */
export function 是否真实用户消息(消息: 智能体消息类型): boolean {
  return 消息.role === 'user' && 消息.isSystemCorrection !== true && 消息.isSystemInjection !== true
}

/**
 * 从头截断历史, 让总字符数不超过 保留字符数。
 * - 保留第一条 system;
 * - 只在真实用户消息的边界上切, 一轮里的 tool_calls 和对应的工具结果不会被拆开;
 * - 至少保留最后一轮, 所以最后一轮本身很长时结果可能超过 保留字符数;
 * - 切掉的注入消息(记忆状态等)不用手动补, 下一轮库在历史里找不到同类型的注入会按去重规则重新追加。
 * 只有这个函数和自动截断允许整体替换历史; 返回新数组, 不修改传入的历史。
 */
export function 从头截断(历史: 智能体消息类型[], 选项: { 保留字符数: number }): 智能体消息类型[] {
  let 副本 = 复制消息列表(历史)
  let 第一条 = 副本[0]
  let 头部: 智能体消息类型[] = 第一条 !== undefined && 第一条.role === 'system' ? [第一条] : []
  let 余下 = 副本.slice(头部.length)

  let 边界列表: number[] = []
  for (let [下标, 消息] of 余下.entries()) {
    if (是否真实用户消息(消息) === true) 边界列表.push(下标)
  }
  let 最后边界 = 边界列表.at(-1)
  if (最后边界 === undefined) return 副本

  let 头部字符数 = 统计历史字符数(头部)
  let 余下字符数列表 = 余下.map(统计消息字符数)
  if (头部字符数 + 余下字符数列表.reduce((总数, 数) => 总数 + 数, 0) <= 选项.保留字符数) return 副本
  // 从切点到末尾的字符数
  let 后缀字符数 = (切点: number): number => 余下字符数列表.slice(切点).reduce((总数, 数) => 总数 + 数, 0)

  let 切点: number | undefined
  for (let 边界 of 边界列表) {
    if (头部字符数 + 后缀字符数(边界) <= 选项.保留字符数) {
      切点 = 边界
      break
    }
  }
  if (切点 === undefined) 切点 = 最后边界

  // 第一个边界之前如果没有任何内容, 说明本来就没有可以丢的东西
  if (切点 === 0) return 副本
  return [...头部, ...余下.slice(切点)]
}

/**
 * 自动截断: 历史超过触发值就截到保留值, 返回截断后的历史; 不需要截断返回 null。
 * 拿得到上一次请求的输入token数且配置了 触发token数 时优先按 token 数判断, 否则按字符数。
 */
export function 按需自动截断(
  历史: 智能体消息类型[],
  配置: { 触发字符数: number; 保留字符数: number; 触发token数?: number },
  上次输入token数: number | undefined,
): 智能体消息类型[] | null {
  if (历史.length === 0) return null
  let 已超过触发值 =
    配置.触发token数 !== undefined && 上次输入token数 !== undefined
      ? 上次输入token数 > 配置.触发token数
      : 统计历史字符数(历史) > 配置.触发字符数
  if (已超过触发值 === false) return null
  let 截断结果 = 从头截断(历史, { 保留字符数: 配置.保留字符数 })
  return 截断结果.length < 历史.length ? 截断结果 : null
}
