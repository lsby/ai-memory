import type { z } from 'zod'
import { 追加系统纠正消息 } from '../message/system-correction'
import { 中文模型语言包, type 模型语言包 } from '../model-language'
import type { 智能体回调, 智能体消息类型, 解决问题选项 } from '../types'

export async function 运行结果验证器<T extends z.ZodType>(
  数据: Record<string, unknown>,
  选项: 解决问题选项<T>,
  消息列表: 智能体消息类型[],
  当前校验失败次数: number,
  最大校验重试次数: number,
  回调: 智能体回调,
  模型语言包: 模型语言包 = 中文模型语言包,
): Promise<{ 新校验失败次数: number } | null> {
  let 验证器 = 选项.结果验证器
  if (验证器 === undefined) return null

  let 验证结果 = await 验证器(数据)
  if (验证结果.通过 === true) return null

  let 新次数 = 当前校验失败次数 + 1
  if (新次数 > 最大校验重试次数) {
    throw new Error(`后置验证失败次数超出上限 (${String(最大校验重试次数)}), 最后的错误: ${验证结果.错误信息}`)
  }

  await 回调({ 类型: '校验失败', 错误信息: 验证结果.错误信息, 当前次数: 新次数, 最大次数: 最大校验重试次数 })

  追加系统纠正消息(消息列表, null, 模型语言包.后置验证失败(验证结果.错误信息))

  return { 新校验失败次数: 新次数 }
}

export function 格式化zod错误(error: z.ZodError, 模型语言包: 模型语言包 = 中文模型语言包): string {
  return error.issues.map((issue) => `${模型语言包.路径(issue.path.join('.'))}: ${issue.message}`).join('\n')
}
