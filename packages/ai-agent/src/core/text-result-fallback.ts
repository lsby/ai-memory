import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { 提交结果函数名 } from '../constants'
import type { 模型语言包 } from '../model-language'
import type { 智能体回调, 智能体消息类型, 解决问题选项 } from '../types'
import { 复制消息列表 } from '../utils/session-state'
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

/**
 * 超出最大循环轮次后调用 选项.超轮次回调, 把外部重新请求得到的结果当作一次提交结果处理。
 * 返回: 结果对象(校验通过, 已发 最终结果 事件)、'中断'、或 null(没有回调/回调没给结果/抛错/校验不过)。
 */
export async function 执行超轮次回调<T extends z.ZodType>(参数: {
  选项: 解决问题选项<T>
  消息列表: 智能体消息类型[]
  最大循环轮次: number
  校验失败次数: number
  最大校验重试次数: number
  回调: 智能体回调
  模型语言包: 模型语言包
}): Promise<Record<string, unknown> | '中断' | null> {
  let { 选项, 回调 } = 参数
  let 超轮次回调 = 选项.超轮次回调
  if (超轮次回调 === undefined) return null
  let 已中断 = (): boolean => 选项.中断信号?.aborted === true
  if (已中断()) return '中断'
  await 回调({ 类型: '流程信息', 内容: `超出最大循环轮次 (${String(参数.最大循环轮次)})，调用超轮次回调` })
  let 外部结果: Record<string, unknown> | null
  try {
    外部结果 = await 超轮次回调({
      消息列表: 复制消息列表(参数.消息列表),
      最大循环轮次: 参数.最大循环轮次,
      预期结果Schema: 选项.预期结果Schema,
      预期结果描述: 选项.预期结果描述,
      中断信号: 选项.中断信号,
    })
  } catch (错误) {
    await 回调({ 类型: '流程信息', 内容: `超轮次回调出错: ${错误 instanceof Error ? 错误.message : String(错误)}` })
    return null
  }
  if (已中断()) return '中断'
  if (外部结果 === null) {
    await 回调({ 类型: '流程信息', 内容: '超轮次回调没有给出结果' })
    return null
  }
  let 校验结果 = 选项.预期结果Schema.safeParse(外部结果)
  if (校验结果.success !== true) {
    await 回调({ 类型: '流程信息', 内容: '超轮次回调给出的结果不符合预期格式' })
    return null
  }
  let 数据 = 校验结果.data as Record<string, unknown>
  let 验证失败 = await 以文本结果伪造提交并验证({
    结果数据: 数据,
    伪造id前缀: 'call_max_round_callback_',
    助手文本: JSON.stringify(数据),
    选项,
    消息列表: 参数.消息列表,
    校验失败次数: 参数.校验失败次数,
    最大校验重试次数: 参数.最大校验重试次数,
    回调,
    本次模型回调: 回调,
    模型语言包: 参数.模型语言包,
  })
  if (验证失败 !== null) return null
  await 回调({ 类型: '最终结果', 结果: 数据 })
  return 数据
}
