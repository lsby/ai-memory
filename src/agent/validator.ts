import type { z } from 'zod'
import { 追加系统纠正消息 } from './system-correction'
import type { 智能体回调, 智能体消息类型, 解决问题选项 } from './types'

export async function 运行结果验证器<T extends z.ZodType>(
  数据: Record<string, unknown>,
  选项: 解决问题选项<T>,
  消息列表: 智能体消息类型[],
  当前校验失败次数: number,
  最大校验重试次数: number,
  回调: 智能体回调,
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

  追加系统纠正消息(
    消息列表,
    null,
    `你提交的结果未通过后置验证:\n${验证结果.错误信息}\n请根据以上错误信息修正后重新提交。`,
  )

  return { 新校验失败次数: 新次数 }
}

export function 格式化zod错误(error: z.ZodError): string {
  return error.issues.map((issue) => `路径 [${issue.path.join('.')}]: ${issue.message}`).join('\n')
}
