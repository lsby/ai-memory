import type OpenAI from 'openai'
import type { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { 提交结果函数名 } from './constants'
import type { 智能体工具, 解决问题选项 } from './types'

export function 构建系统工具与格式说明<T extends z.ZodType>(工具列表: 智能体工具[], 选项: 解决问题选项<T>): string {
  let 片段: string[] = []

  // 工具调用格式说明（当不支持函数调用时）
  if (选项.是否支持函数调用 === false) {
    片段.push('## 工具调用格式说明')
    片段.push(
      [
        '你需要使用以下特定的 JSON 格式来发起工具调用。',
        '每次调用工具时, 请**仅**输出一个符合以下格式的 JSON 代码块 (不要有任何前后解释文本):',
        '```json',
        '{"type": "function", "function": { "name": "工具名称", "arguments": {"参数名": "参数值"}}}',
        '```',
      ].join('\n'),
    )
  }

  // 工具使用说明
  if (工具列表.length > 0) {
    片段.push('## 可用工具')
    片段.push(
      '你可以随时调用以下工具来获取信息或执行操作, 在获取足够信息后再提交最终结果。在需要时, 你可以在单次回复中同时发起多个不同的工具调用, 以便并发执行以极大提高效率。',
    )
    for (let 工具 of 工具列表) {
      let 描述行 = [`### ${工具.名称}`, 工具.描述]
      if (选项.是否支持函数调用 === false) {
        let jsonSchema = zodToJsonSchema(工具.参数Schema, { target: 'openAi' })
        描述行.push(`参数形状 (JSON Schema):\n\`\`\`json\n${JSON.stringify(jsonSchema, null, 2)}\n\`\`\``)
      }
      if (工具.返回值描述 !== undefined) {
        描述行.push(`返回值: ${工具.返回值描述}`)
      }
      片段.push(描述行.join('\n'))
    }
  }

  // 最终结果说明
  片段.push('## 最终结果')
  let 提交结果描述 = `注意: 完成任务后, **请不要直接输出文本结果**, 而是调用 ${提交结果函数名} 工具提交最终结果。`
  if (选项.是否支持函数调用 === false) {
    let 结果Schema = zodToJsonSchema(选项.预期结果Schema, { target: 'openAi' })
    提交结果描述 += `\n预期结果描述: ${选项.预期结果描述}\n最终结果参数形状 (JSON Schema):\n\`\`\`json\n${JSON.stringify(结果Schema, null, 2)}\n\`\`\``
  }
  片段.push(提交结果描述)

  return 片段.join('\n\n')
}

export function 构建openai工具列表(
  工具列表: 智能体工具[],
  预期结果Schema: z.ZodType,
  预期结果描述: string,
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  let openai工具列表: OpenAI.Chat.Completions.ChatCompletionTool[] = []

  // 用户定义的工具
  for (let 工具 of 工具列表) {
    let jsonSchema = zodToJsonSchema(工具.参数Schema, { target: 'openAi' })
    openai工具列表.push({
      type: 'function',
      function: { name: 工具.名称, description: 工具.描述, parameters: jsonSchema },
    })
  }

  // 提交结果的特殊函数
  let 结果描述 = 预期结果描述
  let 结果Schema = zodToJsonSchema(预期结果Schema, { target: 'openAi' })
  openai工具列表.push({
    type: 'function',
    function: {
      name: 提交结果函数名,
      description: `提交最终结果。${结果描述}`,
      parameters: 结果Schema,
    },
  })

  return openai工具列表
}
