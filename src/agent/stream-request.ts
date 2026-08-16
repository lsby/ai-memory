import type OpenAI from 'openai'
import type { 智能体回调, 智能体消息类型, 累积工具调用 } from './types'

export async function 流式请求AI(
  openai客户端: OpenAI,
  模型名称: string,
  消息列表: 智能体消息类型[],
  工具列表: OpenAI.Chat.Completions.ChatCompletionTool[],
  回调: 智能体回调,
  中断信号: AbortSignal | undefined,
  是否支持函数调用: boolean = true,
  是否使用引导前缀: boolean = true,
  最大输出token?: number,
  温度?: number,
  核采样?: number,
  存在惩罚?: number,
  频率惩罚?: number,
): Promise<{ 完整文本: string; 工具调用列表: 累积工具调用[]; 已中断: boolean }> {
  let 完整文本 = ''
  let 工具调用映射 = new Map<number, 累积工具调用>()
  let 已中断 = false

  let 实际工具列表 = 工具列表
  let 实际消息列表 = 消息列表
  let 引导前缀 = '```json\n{"type": "function", "function": {"name":'

  if (是否支持函数调用 === false) {
    实际工具列表 = []
    if (是否使用引导前缀 !== false) {
      实际消息列表 = [...消息列表, { role: 'assistant', content: 引导前缀 }]
    }
  }

  try {
    let 请求配置: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model: 模型名称,
      messages: 实际消息列表 as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      stream: true,
    }
    if (最大输出token !== undefined) {
      请求配置.max_tokens = 最大输出token
    }
    if (温度 !== undefined) {
      请求配置.temperature = 温度
    }
    if (核采样 !== undefined) {
      请求配置.top_p = 核采样
    }
    if (存在惩罚 !== undefined) {
      请求配置.presence_penalty = 存在惩罚
    }
    if (频率惩罚 !== undefined) {
      请求配置.frequency_penalty = 频率惩罚
    }
    if (实际工具列表.length > 0) {
      请求配置.tools = 实际工具列表
    }

    try {
      await 回调({ 类型: '原始请求配置', 配置: 请求配置 })
    } catch (e) {
      console.error('[Agent Stream] Callback error on 原始请求配置:', e)
    }

    let 流式响应 = await openai客户端.chat.completions.create(请求配置, { signal: 中断信号 })

    for await (let chunk of 流式响应) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (chunk.choices === undefined || chunk.choices === null || chunk.choices.length === 0) {
        continue
      }
      let 选项 = chunk.choices[0] ?? null
      if (选项 === null) continue

      let delta = 选项.delta
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (delta === undefined || delta === null) continue

      // 累积文本内容
      let 文本片段 = delta.content ?? null
      if (文本片段 !== null) {
        完整文本 += 文本片段
        try {
          await 回调({ 类型: 'AI文本片段', 内容: 文本片段 })
        } catch (e) {
          console.error('[Agent Stream] Callback error on AI文本片段:', e)
        }
      }

      // 累积 tool_calls
      let 工具调用片段列表 = delta.tool_calls ?? null
      if (工具调用片段列表 !== null) {
        for (let 片段 of 工具调用片段列表) {
          let 索引 = 片段.index
          let 已有条目 = 工具调用映射.get(索引) ?? null
          if (已有条目 === null) {
            工具调用映射.set(索引, {
              id: 片段.id ?? '',
              名称: 片段.function?.name ?? '',
              参数片段: 片段.function?.arguments ?? '',
            })
          } else {
            if (片段.function?.name !== undefined) {
              已有条目.名称 += 片段.function.name
            }
            if (片段.function?.arguments !== undefined) {
              已有条目.参数片段 += 片段.function.arguments
            }
          }
        }
      }
    }
  } catch (error) {
    let 是否中断 =
      (中断信号 !== undefined && 中断信号.aborted === true) ||
      (error instanceof Error &&
        (error.name === 'AbortError' ||
          error.name === 'APIUserAbortError' ||
          error.message.includes('abort') ||
          error.message.includes('aborted')))
    if (是否中断 === true) {
      已中断 = true
    } else {
      throw error
    }
  }

  if (是否支持函数调用 === false && 是否使用引导前缀 !== false) {
    if (完整文本.trim().startsWith(引导前缀) === false) {
      完整文本 = 引导前缀 + 完整文本
    }
  }

  let 工具调用列表 = Array.from(工具调用映射.values())
  try {
    await 回调({ 类型: '原始AI返回', 完整文本, 工具调用列表, 当前消息列表: 消息列表 })
  } catch (e) {
    console.error('[Agent Stream] Callback error on 原始AI返回:', e)
  }
  return { 完整文本, 工具调用列表, 已中断 }
}
