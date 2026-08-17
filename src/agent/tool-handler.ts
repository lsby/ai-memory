import { jsonrepair } from 'jsonrepair'
import type { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { 提交结果函数名 } from './constants'
import type { 智能体回调, 智能体工具, 智能体消息类型, 累积工具调用, 调试拦截钩子 } from './types'
import { 格式化zod错误 } from './validator'

export type 工具调用处理结果 =
  { 类型: '最终结果'; 数据: Record<string, unknown> } | { 类型: '校验失败'; 错误信息: string } | { 类型: '继续循环' }

async function 处理工具错误(
  调用: 累积工具调用,
  参数: string | Record<string, unknown>,
  错误消息: string,
  回调: 智能体回调,
  调试Hook?: 调试拦截钩子 | undefined,
  耗时?: number,
): Promise<{ handled: boolean; message?: 智能体消息类型 }> {
  if (调试Hook?.出错时 !== undefined) {
    let 拦截返回 = await 调试Hook.出错时(调用.名称, 参数, 错误消息)
    if (拦截返回.动作 === '拦截') {
      let 伪造结果 = { 结果: '成功' as const, 拦截提示: 拦截返回.返回给AI的文本 }
      await 回调({ 类型: '工具调用结果', 工具名称: 调用.名称, id: 调用.id, 结果: 伪造结果, 耗时ms: 耗时 ?? 0 })
      return {
        handled: true,
        message: { role: 'tool', tool_call_id: 调用.id, content: JSON.stringify(伪造结果, null, 2) },
      }
    }
    if (拦截返回.动作 === '打回') {
      let 失败结果 = { 结果: '失败' as const, 错误信息: 拦截返回.返回给AI的错误信息 }
      await 回调({ 类型: '工具调用失败', 工具名称: 调用.名称, id: 调用.id, 错误信息: 拦截返回.返回给AI的错误信息 })
      await 回调({ 类型: '工具调用结果', 工具名称: 调用.名称, id: 调用.id, 结果: 失败结果, 耗时ms: 耗时 ?? 0 })
      return {
        handled: true,
        message: { role: 'tool', tool_call_id: 调用.id, content: JSON.stringify(失败结果, null, 2) },
      }
    }
  }
  return { handled: false }
}

async function 执行单个普通工具调用(
  调用: 累积工具调用,
  回调: 智能体回调,
  工具定义列表: 智能体工具[],
  调试Hook?: 调试拦截钩子 | undefined,
  工具返回文本最大长度?: number,
  中断信号?: AbortSignal,
): Promise<智能体消息类型> {
  if (中断信号?.aborted === true) {
    let 失败结果 = { 结果: '失败' as const, 错误信息: '操作已中断，工具未执行' }
    await 回调({ 类型: '工具调用失败', 工具名称: 调用.名称, id: 调用.id, 错误信息: 失败结果.错误信息 })
    return { role: 'tool', tool_call_id: 调用.id, content: JSON.stringify(失败结果) }
  }
  let 参数: Record<string, unknown> | null = null
  try {
    let 修复后 = jsonrepair(调用.参数片段)
    参数 = JSON.parse(修复后) as Record<string, unknown>
  } catch {
    let 错误消息 = `解析函数 ${调用.名称} 的参数失败: ${调用.参数片段}`
    let 错误处理结果 = await 处理工具错误(调用, 调用.参数片段, 错误消息, 回调, 调试Hook)
    if (错误处理结果.handled === true && 错误处理结果.message !== undefined) return 错误处理结果.message
    await 回调({ 类型: '工具调用失败', 工具名称: 调用.名称, id: 调用.id, 错误信息: 错误消息 })
    return {
      role: 'tool',
      tool_call_id: 调用.id,
      content: JSON.stringify({ 结果: '失败', 错误信息: `参数解析失败: ${调用.参数片段}` }, null, 2),
    }
  }

  let 工具定义 = 工具定义列表.find((t) => t.名称 === 调用.名称) ?? null
  if (工具定义 === null) {
    let 错误消息 = `未知工具: ${调用.名称}`
    let 错误处理结果 = await 处理工具错误(调用, 调用.参数片段, 错误消息, 回调, 调试Hook)
    if (错误处理结果.handled === true && 错误处理结果.message !== undefined) return 错误处理结果.message
    await 回调({ 类型: '工具调用失败', 工具名称: 调用.名称, id: 调用.id, 错误信息: 错误消息 })
    return {
      role: 'tool',
      tool_call_id: 调用.id,
      content: JSON.stringify({ 结果: '失败', 错误信息: `未知工具: ${调用.名称}` }, null, 2),
    }
  }

  let 参数校验结果 = 工具定义.参数Schema.safeParse(参数)
  if (参数校验结果.success === false) {
    let 错误描述 = 格式化zod错误(参数校验结果.error)
    let 错误消息 = `参数校验失败: ${错误描述}`
    let 错误处理结果 = await 处理工具错误(调用, 参数, 错误消息, 回调, 调试Hook)
    if (错误处理结果.handled === true && 错误处理结果.message !== undefined) return 错误处理结果.message
    await 回调({ 类型: '工具调用失败', 工具名称: 调用.名称, id: 调用.id, 错误信息: 错误消息 })
    return {
      role: 'tool',
      tool_call_id: 调用.id,
      content: JSON.stringify({ 结果: '失败', 错误信息: `工具参数不正确: ${错误描述}` }, null, 2),
    }
  }

  if (调试Hook?.调用前 !== undefined) {
    let 拦截返回 = await 调试Hook.调用前(调用.名称, 参数校验结果.data)
    if (拦截返回.动作 === '拦截') {
      let 伪造结果 = { 结果: '成功' as const, 拦截提示: 拦截返回.返回给AI的文本 }
      await 回调({ 类型: '工具调用结果', 工具名称: 调用.名称, id: 调用.id, 结果: 伪造结果, 耗时ms: 0 })
      return { role: 'tool', tool_call_id: 调用.id, content: JSON.stringify(伪造结果, null, 2) }
    }
    if (拦截返回.动作 === '打回') {
      let 失败结果 = { 结果: '失败' as const, 错误信息: 拦截返回.返回给AI的错误信息 }
      await 回调({ 类型: '工具调用失败', 工具名称: 调用.名称, id: 调用.id, 错误信息: 拦截返回.返回给AI的错误信息 })
      await 回调({ 类型: '工具调用结果', 工具名称: 调用.名称, id: 调用.id, 结果: 失败结果, 耗时ms: 0 })
      return { role: 'tool', tool_call_id: 调用.id, content: JSON.stringify(失败结果, null, 2) }
    }
  }

  await 回调({
    类型: '工具调用开始',
    工具名称: 调用.名称,
    id: 调用.id,
    参数: 参数校验结果.data,
  })
  let 开始时间 = Date.now()
  try {
    let 原始结果 = await 工具定义.实现(参数校验结果.data, { 中断信号 })
    let 返回值校验结果 = 工具定义.返回值Schema.safeParse(原始结果)
    if (返回值校验结果.success === false) {
      throw new Error(`工具内部错误：返回了不符合约定格式的数据: ${格式化zod错误(返回值校验结果.error)}`)
    }
    let 结果 = 返回值校验结果.data

    if (调试Hook?.调用后 !== undefined) {
      let 拦截返回 = await 调试Hook.调用后(调用.名称, 参数校验结果.data, 结果)
      if (拦截返回.动作 === '拦截') {
        let 伪造结果 = { 结果: '成功' as const, 拦截提示: 拦截返回.返回给AI的文本 }
        await 回调({ 类型: '工具调用结果', 工具名称: 调用.名称, id: 调用.id, 结果: 伪造结果, 耗时ms: 0 })
        return { role: 'tool', tool_call_id: 调用.id, content: JSON.stringify(伪造结果, null, 2) }
      }
      if (拦截返回.动作 === '打回') {
        let 失败结果 = { 结果: '失败' as const, 错误信息: 拦截返回.返回给AI的错误信息 }
        await 回调({ 类型: '工具调用失败', 工具名称: 调用.名称, id: 调用.id, 错误信息: 拦截返回.返回给AI的错误信息 })
        await 回调({ 类型: '工具调用结果', 工具名称: 调用.名称, id: 调用.id, 结果: 失败结果, 耗时ms: 0 })
        return { role: 'tool', tool_call_id: 调用.id, content: JSON.stringify(失败结果, null, 2) }
      }
    }

    let 耗时 = Date.now() - 开始时间
    await 回调({ 类型: '工具调用结果', 工具名称: 调用.名称, id: 调用.id, 结果, 耗时ms: 耗时 })
    let 结果文本 = JSON.stringify(结果, null, 2)
    if (工具返回文本最大长度 !== undefined && 结果文本.length > 工具返回文本最大长度) {
      结果文本 = 结果文本.substring(0, 工具返回文本最大长度) + '\n... (因长度限制被截断)'
    }
    return { role: 'tool', tool_call_id: 调用.id, content: 结果文本 }
  } catch (error) {
    let 耗时 = Date.now() - 开始时间
    let 错误消息 = error instanceof Error ? error.message : String(error)
    let 错误处理结果 = await 处理工具错误(调用, 参数校验结果.data, 错误消息, 回调, 调试Hook, 耗时)
    if (错误处理结果.handled === true && 错误处理结果.message !== undefined) return 错误处理结果.message
    await 回调({ 类型: '工具调用失败', 工具名称: 调用.名称, id: 调用.id, 错误信息: 错误消息 })
    let 失败结果 = { 结果: '失败' as const, 错误信息: 错误消息 }
    await 回调({ 类型: '工具调用结果', 工具名称: 调用.名称, id: 调用.id, 结果: 失败结果, 耗时ms: 耗时 })
    let 结果文本 = JSON.stringify(失败结果, null, 2)
    if (工具返回文本最大长度 !== undefined && 结果文本.length > 工具返回文本最大长度) {
      结果文本 = 结果文本.substring(0, 工具返回文本最大长度) + '\n... (因长度限制被截断)'
    }
    return { role: 'tool', tool_call_id: 调用.id, content: 结果文本 }
  }
}

export async function 处理工具调用(
  工具调用列表: 累积工具调用[],
  消息列表: 智能体消息类型[],
  助手文本: string,
  预期结果Schema: z.ZodType,
  回调: 智能体回调,
  工具定义列表: 智能体工具[],
  允许混用: boolean = false,
  调试Hook?: 调试拦截钩子 | undefined,
  工具返回文本最大长度?: number,
  中断信号?: AbortSignal,
): Promise<工具调用处理结果> {
  // 构建 assistant 消息 (包含 tool_calls)
  let assistant消息: 智能体消息类型 = {
    role: 'assistant',
    content: 助手文本 !== '' ? 助手文本 : null,
    tool_calls: 工具调用列表.map((调用) => ({
      id: 调用.id,
      type: 'function',
      function: { name: 调用.名称, arguments: 调用.参数片段 },
    })),
  }
  消息列表.push(assistant消息)

  let 普通工具调用列表: 累积工具调用[] = []
  let 提交结果调用列表: 累积工具调用[] = []

  for (let 调用 of 工具调用列表) {
    if (调用.名称 === 提交结果函数名) {
      提交结果调用列表.push(调用)
    } else {
      普通工具调用列表.push(调用)
    }
  }

  // 顺序执行所有普通工具调用，以支持存在依赖关系的工具调用顺序
  if (普通工具调用列表.length > 0) {
    for (let 调用 of 普通工具调用列表) {
      let 消息 = await 执行单个普通工具调用(调用, 回调, 工具定义列表, 调试Hook, 工具返回文本最大长度, 中断信号)
      消息列表.push(消息)
    }
  }

  if (提交结果调用列表.length > 1) {
    let 错误消息 = `单次回复只能调用一次 ${提交结果函数名}。请根据已执行的工具结果重新提交一份唯一的最终结果。`
    for (let 调用 of 提交结果调用列表) {
      await 回调({ 类型: '工具调用失败', 工具名称: 调用.名称, id: 调用.id, 错误信息: 错误消息 })
      消息列表.push({
        role: 'tool',
        tool_call_id: 调用.id,
        content: JSON.stringify({ 结果: '失败', 错误信息: 错误消息 }),
      })
    }
    return { 类型: '继续循环' }
  }

  // 如果有提交结果调用，则在普通工具调用处理完毕后执行
  let 提交结果调用 = 提交结果调用列表[0]
  if (提交结果调用 !== undefined) {
    let 调用 = 提交结果调用

    if (中断信号?.aborted === true) {
      let 错误消息 = '操作已中断，最终结果未提交'
      await 回调({ 类型: '工具调用失败', 工具名称: 调用.名称, id: 调用.id, 错误信息: 错误消息 })
      消息列表.push({
        role: 'tool',
        tool_call_id: 调用.id,
        content: JSON.stringify({ 结果: '失败', 错误信息: 错误消息 }),
      })
      return { 类型: '继续循环' }
    }

    if (!允许混用 && 普通工具调用列表.length > 0) {
      let 错误消息 = `请不要将 ${提交结果函数名} 与其他普通工具混合调用。已为您执行了其他工具调用，请先查看它们的结果，然后再单独调用 ${提交结果函数名} 提交最终结果。`
      await 回调({ 类型: '工具调用失败', 工具名称: 调用.名称, id: 调用.id, 错误信息: 错误消息 })
      消息列表.push({
        role: 'tool',
        tool_call_id: 调用.id,
        content: JSON.stringify({ 结果: '失败', 错误信息: 错误消息 }),
      })
      return { 类型: '继续循环' }
    }

    let 参数: Record<string, unknown> | null = null
    try {
      let 修复后 = jsonrepair(调用.参数片段)
      参数 = JSON.parse(修复后) as Record<string, unknown>
    } catch {
      let 错误消息 = `解析函数 ${调用.名称} 的参数失败: ${调用.参数片段}`
      let 错误处理结果 = await 处理工具错误(调用, 调用.参数片段, 错误消息, 回调, 调试Hook)
      if (错误处理结果.handled === true && 错误处理结果.message !== undefined) {
        消息列表.push(错误处理结果.message)
      } else {
        await 回调({ 类型: '工具调用失败', 工具名称: 调用.名称, id: 调用.id, 错误信息: 错误消息 })
        消息列表.push({
          role: 'tool',
          tool_call_id: 调用.id,
          content: JSON.stringify({ 结果: '失败', 错误信息: 错误消息 }),
        })
      }
      return { 类型: '继续循环' }
    }

    let 校验结果 = 预期结果Schema.safeParse(参数)
    if (校验结果.success === true) {
      if (调试Hook?.调用前 !== undefined) {
        let 拦截返回 = await 调试Hook.调用前(调用.名称, 参数)
        if (拦截返回.动作 === '拦截') {
          let 伪造结果 = { 结果: '失败' as const, 拦截提示: 拦截返回.返回给AI的文本 }
          await 回调({ 类型: '工具调用结果', 工具名称: 调用.名称, id: 调用.id, 结果: 伪造结果, 耗时ms: 0 })
          消息列表.push({ role: 'tool', tool_call_id: 调用.id, content: JSON.stringify(伪造结果, null, 2) })
          return { 类型: '继续循环' }
        }
        if (拦截返回.动作 === '打回') {
          let 失败结果 = { 结果: '失败' as const, 错误信息: 拦截返回.返回给AI的错误信息 }
          await 回调({ 类型: '工具调用失败', 工具名称: 调用.名称, id: 调用.id, 错误信息: 拦截返回.返回给AI的错误信息 })
          await 回调({ 类型: '工具调用结果', 工具名称: 调用.名称, id: 调用.id, 结果: 失败结果, 耗时ms: 0 })
          消息列表.push({ role: 'tool', tool_call_id: 调用.id, content: JSON.stringify(失败结果, null, 2) })
          return { 类型: '继续循环' }
        }
      }

      // 校验通过
      await 回调({ 类型: '工具调用开始', 工具名称: 调用.名称, id: 调用.id, 参数 })
      let 结果 = { 结果: '成功' as const, 信息: '结果提交成功' }
      await 回调({ 类型: '工具调用结果', 工具名称: 调用.名称, id: 调用.id, 结果, 耗时ms: 0 })

      // 修复: 必须将提交结果的 tool 响应加入消息列表，否则下次请求 AI 时
      // 历史记录中的 assistant 消息会带有无响应的 tool_calls，导致 400 错误。
      消息列表.push({ role: 'tool', tool_call_id: 调用.id, content: JSON.stringify(结果) })

      return { 类型: '最终结果', 数据: 校验结果.data as Record<string, unknown> }
    }

    // 校验失败
    let 错误描述 = 格式化zod错误(校验结果.error)
    let 预期JsonSchema = zodToJsonSchema(预期结果Schema)
    let 预期形状文本 = JSON.stringify(预期JsonSchema, null, 2)
    let 详细错误信息 = `${错误描述}\n预期结果形状 (JSON Schema):\n${预期形状文本}`

    let 工具返回内容 = `提交的数据不符合预期格式:\n${错误描述}\n\n请修复后重新调用 ${提交结果函数名}`
    let 错误处理结果 = await 处理工具错误(调用, 参数, 工具返回内容, 回调, 调试Hook)
    if (错误处理结果.handled === true && 错误处理结果.message !== undefined) {
      消息列表.push(错误处理结果.message)
      return { 类型: '继续循环' }
    }
    await 回调({ 类型: '工具调用失败', 工具名称: 调用.名称, id: 调用.id, 错误信息: 工具返回内容 })

    消息列表.push({
      role: 'tool',
      tool_call_id: 调用.id,
      content: JSON.stringify({ 结果: '失败', 错误信息: 工具返回内容 }),
    })
    return { 类型: '校验失败', 错误信息: 详细错误信息 }
  }

  return { 类型: '继续循环' }
}
