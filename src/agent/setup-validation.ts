import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { 提交结果函数名 } from './constants'
import type { 智能体工具 } from './types'

export function 校验工具列表(工具列表: 智能体工具[]): void {
  let 名称集合 = new Set<string>()
  for (let 工具 of 工具列表) {
    if (工具.名称 === 提交结果函数名) throw new Error(`工具名称 ${提交结果函数名} 为内置结果提交协议保留名称`)
    if (名称集合.has(工具.名称)) throw new Error(`工具名称重复: ${工具.名称}`)
    名称集合.add(工具.名称)
  }
}

export function 校验结果Schema(预期结果Schema: z.ZodType): void {
  let 结果 = z
    .object({ type: z.literal('object') })
    .passthrough()
    .safeParse(zodToJsonSchema(预期结果Schema))
  if (结果.success === false) throw new TypeError('预期结果Schema 的根节点必须是对象，才能作为结果提交工具的参数')
}
