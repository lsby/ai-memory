import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { 提交结果函数名 } from '../constants'
import type { 模型语言包 } from '../model-language'
import type { 智能体回调, 智能体消息类型, 解决问题选项 } from '../types'
import { 运行结果验证器 } from '../utils/validator'

/** 预期结果只有一个字段时, 把纯文本包装进这个字段; 不满足条件返回 null。 */
export let 包装纯文本结果 = (
  文本: string,
  Schema: z.ZodType,
): { 字段名: string; 数据: Record<string, unknown> } | null => {
  let JsonSchema = zodToJsonSchema(Schema)
  if (
    typeof JsonSchema !== 'object' ||
    'type' in JsonSchema === false ||
    JsonSchema.type !== 'object' ||
    'properties' in JsonSchema === false ||
    typeof JsonSchema.properties !== 'object'
  ) {
    return null
  }
  let 字段列表 = Object.keys(JsonSchema.properties)
  let 唯一字段名 = 字段列表[0]
  if (字段列表.length !== 1 || 唯一字段名 === undefined) return null
  let 校验结果 = Schema.safeParse({ [唯一字段名]: 文本.trim() })
  if (校验结果.success !== true) return null
  return { 字段名: 唯一字段名, 数据: 校验结果.data as Record<string, unknown> }
}

/**
 * 模型没有真正调用提交结果函数、但文本里带了结果时: 补发一组伪造的提交结果工具事件,
 * 把助手文本记入消息列表, 再走结果验证器。返回 null 表示验证通过。
 */
export async function 以文本结果伪造提交并验证<T extends z.ZodType>(参数: {
  结果数据: Record<string, unknown>
  伪造id前缀: string
  助手文本: string
  选项: 解决问题选项<T>
  消息列表: 智能体消息类型[]
  校验失败次数: number
  最大校验重试次数: number
  回调: 智能体回调
  本次模型回调: 智能体回调
  模型语言包: 模型语言包
}): Promise<{ 新校验失败次数: number } | null> {
  let 伪造id = 参数.伪造id前缀 + Date.now().toString()
  await 参数.本次模型回调({ 类型: '工具调用开始', 工具名称: 提交结果函数名, id: 伪造id, 参数: 参数.结果数据 })
  await 参数.本次模型回调({
    类型: '工具调用结果',
    工具名称: 提交结果函数名,
    id: 伪造id,
    结果: { 结果: '成功', 信息: 参数.模型语言包.提交结果成功() },
    耗时ms: 0,
  })
  参数.消息列表.push({ role: 'assistant', content: 参数.助手文本 })
  return await 运行结果验证器(
    参数.结果数据,
    参数.选项,
    参数.消息列表,
    参数.校验失败次数,
    参数.最大校验重试次数,
    参数.回调,
    参数.模型语言包,
  )
}
