import { 英文字段映射, 英文描述映射, 英文枚举值映射 } from './model-language-en-mappings'

export type 基础模型语言包 = {
  工具调用格式标题: () => string
  工具调用格式说明: () => string
  可用工具标题: () => string
  可用工具说明: () => string
  参数形状标题: () => string
  返回值标题: () => string
  最终结果标题: () => string
  最终结果说明: (提交函数名: string) => string
  最终结果格式: (描述: string, schema: string) => string
  提交结果工具描述: (描述: string) => string
  当前时间: (时间: string) => string
  路径: (路径: string) => string
  后置验证失败: (错误: string) => string
  无结构化数据: (提交函数名: string) => string
  空回复: () => string
  工具已中断: () => string
  工具参数无法解析: (参数: string) => string
  未知工具: (名称: string) => string
  工具参数不正确: (错误: string) => string
  工具返回截断: () => string
  多次提交结果: (提交函数名: string) => string
  提交结果已中断: () => string
  提交结果不可混用: (提交函数名: string) => string
  提交结果参数无法解析: (函数名: string, 参数: string) => string
  提交结果成功: () => string
  提交结果格式错误: (错误: string, 提交函数名: string) => string
  模型字段名: (内部字段名: string) => string
  模型字段描述: (描述: string) => string
  模型枚举值: (内部值: string) => string
}

/** @deprecated 请使用 基础模型语言包。 */
export type 模型语言包 = 基础模型语言包

export let 中文模型语言包: 基础模型语言包 = {
  工具调用格式标题: (): string => '## 工具调用格式说明',
  工具调用格式说明: (): string =>
    '你需要使用以下特定的 JSON 格式来发起工具调用。\n每次调用工具时, 请**仅**输出一个符合以下格式的 JSON 代码块 (不要有任何前后解释文本):\n```json\n{"type": "function", "function": { "name": "工具名称", "arguments": {"参数名": "参数值"}}}\n```',
  可用工具标题: (): string => '## 可用工具',
  可用工具说明: (): string =>
    '你可以随时调用以下工具来获取信息或执行操作, 在获取足够信息后再提交最终结果。如果单次回复发起多个工具调用，系统会按返回顺序依次执行，后一个工具可以依赖前一个工具产生的外部状态。',
  参数形状标题: (): string => '参数形状',
  返回值标题: (): string => '返回值',
  最终结果标题: (): string => '## 最终结果',
  最终结果说明: (名称): string => `注意: 完成任务后, **请不要直接输出文本结果**, 而是调用 ${名称} 工具提交最终结果。`,
  最终结果格式: (描述, schema): string =>
    `\n预期结果描述: ${描述}\n最终结果参数形状 (JSON Schema):\n\`\`\`json\n${schema}\n\`\`\``,
  提交结果工具描述: (描述): string => `提交最终结果。${描述}`,
  当前时间: (时间): string => `[当前时间: ${时间}]`,
  路径: (路径): string => `路径 [${路径}]`,
  后置验证失败: (错误): string => `你提交的结果未通过后置验证:\n${错误}\n请根据以上错误信息修正后重新提交。`,
  无结构化数据: (名称): string =>
    `你的回复中没有包含有效的结构化数据。请使用 ${名称} 函数调用来提交你的最终结果, 或在回复中包含一个 JSON 代码块, 内容以 \`{"type": "function", "function": {"name":\` 开头, 格式需要符合预期结果的 Schema。`,
  空回复: (): string => '你的回复是空的, 请重新回答。',
  工具已中断: (): string => '操作已中断，工具未执行',
  工具参数无法解析: (参数): string => `参数解析失败: ${参数}`,
  未知工具: (名称): string => `未知工具: ${名称}`,
  工具参数不正确: (错误): string => `工具参数不正确: ${错误}`,
  工具返回截断: (): string => '\n... (因长度限制被截断)',
  多次提交结果: (名称): string => `单次回复只能调用一次 ${名称}。请根据已执行的工具结果重新提交一份唯一的最终结果。`,
  提交结果已中断: (): string => '操作已中断，最终结果未提交',
  提交结果不可混用: (名称): string =>
    `请不要将 ${名称} 与其他普通工具混合调用。已为您执行了其他工具调用，请先查看它们的结果，然后再单独调用 ${名称} 提交最终结果。`,
  提交结果参数无法解析: (名称, 参数): string => `解析函数 ${名称} 的参数失败: ${参数}`,
  提交结果成功: (): string => '结果提交成功',
  提交结果格式错误: (错误, 名称): string => `提交的数据不符合预期格式:\n${错误}\n\n请修复后重新调用 ${名称}`,
  模型字段名: (名称): string => 名称,
  模型字段描述: (描述): string => 描述,
  模型枚举值: (值): string => 值,
}

export let 英文模型语言包: 基础模型语言包 = {
  ...中文模型语言包,
  工具调用格式标题: (): string => '## Tool call format',
  工具调用格式说明: (): string =>
    'Use the following JSON format to call a tool.\nOutput only one JSON code block in this exact shape, with no surrounding explanation:\n```json\n{"type": "function", "function": { "name": "tool_name", "arguments": {"parameter": "value"}}}\n```',
  可用工具标题: (): string => '## Available tools',
  可用工具说明: (): string =>
    'Use these tools whenever needed. Gather enough information before submitting the final result. Multiple calls in one response execute in order, so later calls may depend on earlier side effects.',
  参数形状标题: (): string => 'Parameters',
  返回值标题: (): string => 'Returns',
  最终结果标题: (): string => '## Final result',
  最终结果说明: (名称): string =>
    `When the task is complete, do not answer with plain text. Call ${名称} to submit the final result.`,
  最终结果格式: (描述, schema): string =>
    `\nExpected result: ${描述}\nFinal result parameters (JSON Schema):\n\`\`\`json\n${schema}\n\`\`\``,
  提交结果工具描述: (描述): string => `Submit the final result. ${描述}`,
  当前时间: (时间): string => `[Current time: ${时间}]`,
  路径: (路径): string => `Path [${路径}]`,
  后置验证失败: (错误): string =>
    `Your result failed post-validation:\n${错误}\nCorrect the result and submit it again.`,
  无结构化数据: (名称): string =>
    `Your response did not contain valid structured data. Submit the final result by calling ${名称}, or include a JSON code block beginning with \`{"type": "function", "function": {"name":\` that matches the expected schema.`,
  空回复: (): string => 'Your response was empty. Try again.',
  工具已中断: (): string => 'Operation aborted; tool not executed.',
  工具参数无法解析: (参数): string => `Could not parse arguments: ${参数}`,
  未知工具: (名称): string => `Unknown tool: ${名称}`,
  工具参数不正确: (错误): string => `Invalid tool arguments: ${错误}`,
  工具返回截断: (): string => '\n... (truncated by length limit)',
  多次提交结果: (名称): string =>
    `Only one ${名称} call is allowed per response. Submit one final result after reviewing the completed tool calls.`,
  提交结果已中断: (): string => 'Operation aborted; the final result was not submitted.',
  提交结果不可混用: (名称): string =>
    `Do not mix ${名称} with ordinary tool calls. Review their results, then call ${名称} separately.`,
  提交结果参数无法解析: (名称, 参数): string => `Could not parse arguments for ${名称}: ${参数}`,
  提交结果成功: (): string => 'Final result submitted successfully.',
  提交结果格式错误: (错误, 名称): string =>
    `Submitted data does not match the expected format:\n${错误}\n\nFix it and call ${名称} again.`,
  模型字段名: (名称): string => 英文字段映射[名称] ?? 名称,
  模型字段描述: (描述): string => 英文描述映射[描述] ?? 描述,
  模型枚举值: (值): string => 英文枚举值映射[值] ?? 值,
}
