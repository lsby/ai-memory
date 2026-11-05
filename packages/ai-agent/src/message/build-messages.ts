import type OpenAI from 'openai'
import type { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { 提交结果函数名 } from '../constants'
import { 中文模型语言包, type 模型语言包 } from '../model-language'
import type { 智能体工具, 解决问题选项 } from '../types'

export function 构建系统工具与格式说明<T extends z.ZodType>(
  工具列表: 智能体工具[],
  选项: 解决问题选项<T>,
  模型语言包: 模型语言包 = 中文模型语言包,
): string {
  let 片段: string[] = []

  // 工具调用格式说明（当不支持函数调用时）
  if (选项.是否支持函数调用 === false) {
    片段.push(模型语言包.工具调用格式标题(), 模型语言包.工具调用格式说明())
  }

  // 工具使用说明
  if (工具列表.length > 0) {
    片段.push(模型语言包.可用工具标题(), 模型语言包.可用工具说明())
    for (let 工具 of 工具列表) {
      let 描述行 = [`### ${工具.名称}`, 工具.模型描述]
      if (选项.是否支持函数调用 === false) {
        let jsonSchema = 工具.模型参数JSONSchema ?? zodToJsonSchema(工具.参数Schema, { target: 'openAi' })
        描述行.push(
          `${模型语言包.参数形状标题()} (JSON Schema):\n\`\`\`json\n${JSON.stringify(jsonSchema, null, 2)}\n\`\`\``,
        )
      }
      if (工具.模型返回值描述 !== undefined) {
        描述行.push(`${模型语言包.返回值标题()}: ${工具.模型返回值描述}`)
      }
      片段.push(描述行.join('\n'))
    }
  }

  // 最终结果说明
  片段.push(模型语言包.最终结果标题())
  let 提交结果描述 = 模型语言包.最终结果说明(提交结果函数名)
  if (选项.是否支持函数调用 === false) {
    let 结果Schema = zodToJsonSchema(选项.预期结果Schema, { target: 'openAi' })
    提交结果描述 += 模型语言包.最终结果格式(选项.预期结果描述, JSON.stringify(结果Schema, null, 2))
  }
  片段.push(提交结果描述)

  return 片段.join('\n\n')
}

export function 构建openai工具列表(
  工具列表: 智能体工具[],
  预期结果Schema: z.ZodType,
  预期结果描述: string,
  模型语言包: 模型语言包 = 中文模型语言包,
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  let openai工具列表: OpenAI.Chat.Completions.ChatCompletionTool[] = []

  // 用户定义的工具
  for (let 工具 of 工具列表) {
    let jsonSchema = 工具.模型参数JSONSchema ?? zodToJsonSchema(工具.参数Schema, { target: 'openAi' })
    openai工具列表.push({
      type: 'function',
      function: { name: 工具.名称, description: 工具.模型描述, parameters: jsonSchema },
    })
  }

  // 提交结果的特殊函数
  let 结果描述 = 预期结果描述
  let 结果Schema = zodToJsonSchema(预期结果Schema, { target: 'openAi' })
  openai工具列表.push({
    type: 'function',
    function: {
      name: 提交结果函数名,
      description: 模型语言包.提交结果工具描述(结果描述),
      parameters: 结果Schema,
    },
  })

  return openai工具列表
}
