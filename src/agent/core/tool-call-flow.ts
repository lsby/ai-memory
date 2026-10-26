import type { z } from 'zod'
import type { 智能体回调, 智能体消息类型, 解决问题选项 } from '../types'
import { 智能体工具 } from '../types'
import { 运行结果验证器 } from '../utils/validator'
import { 处理工具调用 } from './tool-handler'

export type 工具调用流程结果 =
  | { 类型: '返回'; 数据: Record<string, unknown> }
  | { 类型: '更新次数'; 新次数: number }
  | { 类型: '继续' }
  | { 类型: '校验失败上限'; 错误信息: string }

export async function 处理工具调用并验证<T extends z.ZodType>(
  工具调用列表: { id: string; 名称: string; 参数片段: string }[],
  消息列表: 智能体消息类型[],
  助手文本: string,
  合并工具列表: 智能体工具[],
  选项: 解决问题选项<T>,
  校验失败次数: number,
  回调: 智能体回调,
  工具返回文本最大长度: number | undefined,
  最大校验重试次数: number,
  模型语言: 'zh-CN' | 'en-US' = 'zh-CN',
): Promise<工具调用流程结果> {
  let 处理结果 = await 处理工具调用(
    工具调用列表,
    消息列表,
    助手文本,
    选项.预期结果Schema,
    回调,
    合并工具列表,
    false,
    选项.调试Hook,
    工具返回文本最大长度,
    选项.中断信号,
    模型语言,
  )
  if (处理结果.类型 === '最终结果') {
    let 验证失败 = await 运行结果验证器(处理结果.数据, 选项, 消息列表, 校验失败次数, 最大校验重试次数, 回调, 模型语言)
    if (验证失败 !== null) return { 类型: '更新次数', 新次数: 验证失败.新校验失败次数 }
    await 回调({ 类型: '最终结果', 结果: 处理结果.数据 })
    return { 类型: '返回', 数据: 处理结果.数据 }
  }
  if (处理结果.类型 === '校验失败') {
    let 新次数 = 校验失败次数 + 1
    if (新次数 > 最大校验重试次数) {
      return {
        类型: '校验失败上限',
        错误信息: `校验失败次数超出上限 (${String(最大校验重试次数)}), 最后的错误: ${处理结果.错误信息}`,
      }
    }
    await 回调({ 类型: '校验失败', 错误信息: 处理结果.错误信息, 当前次数: 新次数, 最大次数: 最大校验重试次数 })
    return { 类型: '更新次数', 新次数 }
  }
  return { 类型: '继续' }
}
