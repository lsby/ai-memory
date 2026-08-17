import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { 构建openai工具列表, 构建系统工具与格式说明 } from './build-messages'
import { 提交结果函数名 } from './constants'
import { 开启交互调试 as runRepl } from './repl'
import { 流式请求AI } from './stream-request'
import { 追加系统纠正消息 } from './system-correction'
import { 从文本提取工具调用, 从文本提取结果 } from './text-fallback'
import { 处理工具调用 } from './tool-handler'
import type {
  REPL选项,
  对话选项,
  执行回合选项,
  智能体回调,
  智能体执行模式,
  智能体消息类型,
  智能体选项,
  解决问题选项,
} from './types'
import { 智能体工具, 智能体消息Schema } from './types'
import { 运行结果验证器 } from './validator'

let 智能体状态Schema = z.object({ 格式版本: z.literal(2), 消息历史: z.array(智能体消息Schema) })

function 是临时内部消息(消息: 智能体消息类型): boolean {
  return 消息.role === 'user' && (消息.isSystemCorrection === true || 消息.isSystemInjection === true)
}

function 复制消息列表(消息列表: 智能体消息类型[]): 智能体消息类型[] {
  return z.array(智能体消息Schema).parse(消息列表)
}

function 提取可见消息(消息列表: 智能体消息类型[]): 智能体消息类型[] {
  return 复制消息列表(消息列表.filter((消息) => 是临时内部消息(消息) === false))
}

function 校验工具列表(工具列表: 智能体工具[]): void {
  let 名称集合 = new Set<string>()
  for (let 工具 of 工具列表) {
    if (工具.名称 === 提交结果函数名) throw new Error(`工具名称 ${提交结果函数名} 为内置结果提交协议保留名称`)
    if (名称集合.has(工具.名称)) throw new Error(`工具名称重复: ${工具.名称}`)
    名称集合.add(工具.名称)
  }
}

function 校验结果Schema(预期结果Schema: z.ZodType): void {
  let 结果 = z
    .object({ type: z.literal('object') })
    .passthrough()
    .safeParse(zodToJsonSchema(预期结果Schema))
  if (结果.success === false) throw new TypeError('预期结果Schema 的根节点必须是对象，才能作为结果提交工具的参数')
}

export class 智能体 {
  protected 工具列表: 智能体工具[]
  private 系统提示词: string
  private 最大校验重试次数: number
  private 最大循环轮次: number
  private 请求AI时间间隔ms: number
  private 工具返回文本最大长度?: number
  private 对话历史: 智能体消息类型[] = []
  private 会话任务队列: Promise<void> = Promise.resolve()

  public constructor(选项: 智能体选项) {
    this.工具列表 = 选项.工具列表 ?? []
    校验工具列表(this.工具列表)
    this.系统提示词 = 选项.系统提示词 ?? ''
    this.最大校验重试次数 = 选项.最大校验重试次数 ?? 3
    this.最大循环轮次 = 选项.最大循环轮次 ?? 15
    this.请求AI时间间隔ms = 选项.请求AI时间间隔ms ?? 0
    this.工具返回文本最大长度 = 选项.工具返回文本最大长度 ?? 50000
  }

  public 组装系统提示词<T extends z.ZodType>(选项: 解决问题选项<T>, 执行模式: 智能体执行模式 = '普通'): string {
    let 合并工具列表 = 执行模式 === '推演' ? [] : [...this.工具列表, ...(选项.临时追加工具列表 ?? [])]
    let 工具与格式说明 = 构建系统工具与格式说明(合并工具列表, 选项)

    let parts = [this.系统提示词, 工具与格式说明, 选项.临时追加系统提示词].filter((p) => p !== undefined && p !== '')
    return parts.join('\n\n')
  }

  /**
   * 在当前实例的会话历史上追加一轮可读写对话。
   * 历史消息一经写入便不再改动，以便复用模型提供商的前缀缓存。
   */
  public async 对话<T extends z.ZodType>(
    选项: 对话选项<T>,
  ): Promise<{
    结果: z.infer<T> | null
    消息列表: 智能体消息类型[]
    新增上下文: 智能体消息类型[]
    结束原因?: '中断' | '超出最大轮次' | '提取结构化数据失败' | '校验失败次数超出上限'
  }> {
    return await this.执行会话任务(async () => {
      let 结果 = await this.执行解决问题({ ...选项, 消息历史: this.对话历史 }, '对话')
      this.对话历史 = 复制消息列表(结果.消息列表)
      return 结果
    })
  }

  /** 在当前会话环境中临时推演，不追加消息，也不向模型暴露普通工具。 */
  public async 推演<T extends z.ZodType>(
    选项: 对话选项<T>,
  ): Promise<{
    结果: z.infer<T> | null
    消息列表: 智能体消息类型[]
    新增上下文: 智能体消息类型[]
    结束原因?: '中断' | '超出最大轮次' | '提取结构化数据失败' | '校验失败次数超出上限'
  }> {
    return await this.执行会话任务(async () => await this.执行解决问题({ ...选项, 消息历史: this.对话历史 }, '推演'))
  }

  /** 执行一个由调用方管理历史的无状态回合，不读写实例会话。 */
  public async 执行回合<T extends z.ZodType>(
    选项: 执行回合选项<T>,
  ): Promise<{
    结果: z.infer<T> | null
    消息列表: 智能体消息类型[]
    新增上下文: 智能体消息类型[]
    结束原因?: '中断' | '超出最大轮次' | '提取结构化数据失败' | '校验失败次数超出上限'
  }> {
    return await this.执行解决问题({ ...选项, 消息历史: 复制消息列表(选项.消息历史 ?? []) }, '普通')
  }

  /**
   * 在当前会话环境中执行可读写操作，但不把本轮消息写入对话历史。
   * 供子类实现私有工作流时使用。
   */
  protected async 执行不追加历史的对话<T extends z.ZodType>(
    选项: 对话选项<T>,
  ): Promise<{
    结果: z.infer<T> | null
    消息列表: 智能体消息类型[]
    新增上下文: 智能体消息类型[]
    结束原因?: '中断' | '超出最大轮次' | '提取结构化数据失败' | '校验失败次数超出上限'
  }> {
    return await this.执行会话任务(async () => await this.执行解决问题({ ...选项, 消息历史: this.对话历史 }, '对话'))
  }

  /** 仅清空本实例的会话历史，不影响记忆库或工具配置。 */
  public 重置对话(): void {
    this.对话历史 = []
  }

  public 读取对话历史(): 智能体消息类型[] {
    return 复制消息列表(this.对话历史)
  }

  public 载入对话历史(消息历史: 智能体消息类型[]): void {
    this.对话历史 = 复制消息列表(消息历史)
  }

  /** 仅供界面展示；不可用它恢复模型上下文，否则会破坏前缀缓存。 */
  public 读取可见对话历史(): 智能体消息类型[] {
    return 提取可见消息(this.对话历史)
  }

  private async 执行会话任务<R>(操作: () => Promise<R>): Promise<R> {
    let 释放队列: () => void = () => {}
    let 当前任务 = new Promise<void>((resolve) => {
      释放队列 = resolve
    })
    let 前置任务 = this.会话任务队列
    this.会话任务队列 = 前置任务.then(() => 当前任务)
    await 前置任务.catch(() => {})
    try {
      return await 操作()
    } finally {
      释放队列()
    }
  }

  protected async 执行解决问题<T extends z.ZodType>(
    选项: 解决问题选项<T>,
    执行模式: 智能体执行模式,
  ): Promise<{
    结果: z.infer<T> | null
    消息列表: 智能体消息类型[]
    新增上下文: 智能体消息类型[]
    结束原因?: '中断' | '超出最大轮次' | '提取结构化数据失败' | '校验失败次数超出上限'
  }> {
    let 回调 = 选项.回调
    let 消息列表: 智能体消息类型[] = 选项.消息历史 !== undefined ? [...选项.消息历史] : []
    let 初始消息列表长度 = 消息列表.length
    let 是否有unshift = false

    let 完整系统提示词 = this.组装系统提示词(选项, 执行模式)
    if (完整系统提示词 !== '') {
      if (消息列表.length > 0 && 消息列表[0]?.role === 'system') {
        let 原内容 = 消息列表[0].content
        let 历史前缀已冻结 = 执行模式 === '对话' || 执行模式 === '推演'
        if (历史前缀已冻结 === false && !原内容.includes(完整系统提示词)) {
          消息列表[0] = { role: 'system', content: `${原内容}\n\n${完整系统提示词}` }
        }
      } else {
        消息列表.unshift({ role: 'system', content: 完整系统提示词 })
        是否有unshift = true
      }
    }

    let 提取新增上下文 = (): 智能体消息类型[] => {
      return 消息列表.slice(初始消息列表长度 + (是否有unshift ? 1 : 0))
    }

    if (选项.命令 !== '') {
      if (选项.当前时间 !== undefined) {
        let 偏移分钟 = 选项.当前时间.getTimezoneOffset()
        let 偏移毫秒 = 偏移分钟 * 60000
        let 本地时间 = new Date(选项.当前时间.getTime() - 偏移毫秒)
        let iso部分 = 本地时间.toISOString().slice(0, -1)
        let 符号 = 偏移分钟 > 0 ? '-' : '+'
        let 绝对值偏移 = Math.abs(偏移分钟)
        let 偏移小时 = Math.floor(绝对值偏移 / 60)
          .toString()
          .padStart(2, '0')
        let 偏移分 = (绝对值偏移 % 60).toString().padStart(2, '0')
        let 本地时间字符串 = `${iso部分}${符号}${偏移小时}:${偏移分}`
        消息列表.push({
          role: 'user',
          content: `[当前时间: ${本地时间字符串}]`,
          isSystemInjection: true,
          systemInjectionKind: 'current-time',
        })
      }
      消息列表.push({ role: 'user', content: 选项.命令 })
    }
    let 合并工具列表 = 执行模式 === '推演' ? [] : [...this.工具列表, ...(选项.临时追加工具列表 ?? [])]
    校验工具列表(合并工具列表)
    校验结果Schema(选项.预期结果Schema)
    let openai工具列表 = 构建openai工具列表(合并工具列表, 选项.预期结果Schema, 选项.预期结果描述)
    let 校验失败次数 = 0
    let 总轮次 = 0
    let 是否中断 = (): boolean => {
      let 信号 = 选项.中断信号
      if (信号 === undefined) return false
      return 信号.aborted === true
    }

    while (总轮次 < this.最大循环轮次) {
      if (是否中断() === true) {
        await 回调({ 类型: '流程信息', 内容: '操作被中断' })
        return { 结果: null, 消息列表, 新增上下文: 提取新增上下文(), 结束原因: '中断' }
      }
      总轮次++
      await 回调({ 类型: '流程信息', 内容: `第 ${String(总轮次)} 轮开始` })

      if (总轮次 > 1 && this.请求AI时间间隔ms > 0) {
        // await 回调({ 类型: '流程信息', 内容: `防频繁限流中, 等待 ${String(this.请求AI时间间隔ms)}ms...` })
        await new Promise<void>((resolve) => {
          let 信号 = 选项.中断信号
          let 已完成 = false
          let 完成 = (): void => {
            if (已完成 === true) return
            已完成 = true
            if (信号 !== undefined) 信号.removeEventListener('abort', 中断处理)
            resolve()
          }
          let timer = setTimeout(完成, this.请求AI时间间隔ms)
          let 中断处理 = (): void => {
            clearTimeout(timer)
            完成()
          }
          if (信号 !== undefined) {
            信号.addEventListener('abort', 中断处理, { once: true })
            if (信号.aborted === true) 中断处理()
          }
        })
        if (是否中断() === true) {
          await 回调({ 类型: '流程信息', 内容: '操作被中断' })
          return { 结果: null, 消息列表, 新增上下文: 提取新增上下文(), 结束原因: '中断' }
        }
      }

      // 流式请求 AI
      let 流式结果 = await 流式请求AI(
        选项.openai客户端,
        选项.模型名称,
        消息列表,
        openai工具列表,
        回调,
        选项.中断信号,
        选项.是否支持函数调用,
        选项.是否使用引导前缀,
        选项.最大输出token,
        选项.温度,
        选项.核采样,
        选项.存在惩罚,
        选项.频率惩罚,
      )

      // 检查是否被中断
      if (流式结果.已中断 === true) {
        await 回调({ 类型: '流程信息', 内容: '操作被中断' })
        return { 结果: null, 消息列表, 新增上下文: 提取新增上下文(), 结束原因: '中断' }
      }

      // 情况1: AI 返回了 tool_calls
      if (流式结果.工具调用列表.length > 0) {
        if (是否中断() === true) {
          await 回调({ 类型: '流程信息', 内容: '操作被中断' })
          return { 结果: null, 消息列表, 新增上下文: 提取新增上下文(), 结束原因: '中断' }
        }
        let 结果 = await this.处理工具调用并验证(
          流式结果.工具调用列表,
          消息列表,
          流式结果.完整文本,
          合并工具列表,
          选项,
          校验失败次数,
          回调,
        )
        if (结果.类型 === '返回') return { 结果: 结果.数据, 消息列表, 新增上下文: 提取新增上下文() }
        if (结果.类型 === '校验失败上限') {
          await 回调({ 类型: '流程信息', 内容: 结果.错误信息 })
          return { 结果: null, 消息列表, 新增上下文: 提取新增上下文(), 结束原因: '校验失败次数超出上限' }
        }
        if (结果.类型 === '更新次数') {
          校验失败次数 = 结果.新次数
        }
        continue
      }

      // 情况2: AI 没有 tool_calls, 尝试从文本中提取工具调用或结果 (兜底)
      if (流式结果.完整文本.trim() !== '') {
        let 文本中的工具调用 = 从文本提取工具调用(流式结果.完整文本, 合并工具列表)
        if (文本中的工具调用 !== null && 文本中的工具调用.length > 0) {
          await 回调({ 类型: '流程信息', 内容: '从文本中提取到工具调用结构, 按工具调用流程处理' })
          let 结果 = await this.处理工具调用并验证(
            文本中的工具调用,
            消息列表,
            流式结果.完整文本,
            合并工具列表,
            选项,
            校验失败次数,
            回调,
          )
          if (结果.类型 === '返回') return { 结果: 结果.数据, 消息列表, 新增上下文: 提取新增上下文() }
          if (结果.类型 === '校验失败上限') {
            await 回调({ 类型: '流程信息', 内容: 结果.错误信息 })
            return { 结果: null, 消息列表, 新增上下文: 提取新增上下文(), 结束原因: '校验失败次数超出上限' }
          }
          if (结果.类型 === '更新次数') {
            校验失败次数 = 结果.新次数
          }
          continue
        }

        // 再尝试直接提取最终结果 JSON
        let 文本提取结果 = 从文本提取结果(流式结果.完整文本, 选项.预期结果Schema)
        if (文本提取结果 !== null) {
          let 伪造id = 'call_fallback_json_' + Date.now().toString()
          await 回调({ 类型: '工具调用开始', 工具名称: 提交结果函数名, id: 伪造id, 参数: 文本提取结果 })
          let 工具执行结果 = { 结果: '成功' as const, 信息: '结果提交成功' }
          await 回调({ 类型: '工具调用结果', 工具名称: 提交结果函数名, id: 伪造id, 结果: 工具执行结果, 耗时ms: 0 })

          消息列表.push({ role: 'assistant', content: 流式结果.完整文本 })

          let 验证失败 = await 运行结果验证器(文本提取结果, 选项, 消息列表, 校验失败次数, this.最大校验重试次数, 回调)
          if (验证失败 !== null) {
            校验失败次数 = 验证失败.新校验失败次数
            continue
          }
          await 回调({ 类型: '最终结果', 结果: 文本提取结果 })
          return { 结果: 文本提取结果, 消息列表, 新增上下文: 提取新增上下文() }
        }

        // ====== 新增：纯文本兜底（自动包装） ======
        let 兜底JsonSchema = zodToJsonSchema(选项.预期结果Schema)
        if (
          typeof 兜底JsonSchema === 'object' &&
          'type' in 兜底JsonSchema &&
          兜底JsonSchema.type === 'object' &&
          'properties' in 兜底JsonSchema &&
          typeof 兜底JsonSchema.properties === 'object'
        ) {
          let 属性列表 = 兜底JsonSchema.properties
          if (Object.keys(属性列表).length === 1) {
            let 唯一字段名 = Object.keys(属性列表)[0]
            if (唯一字段名 !== undefined) {
              let 包装结果 = { [唯一字段名]: 流式结果.完整文本.trim() }
              let 校验结果 = 选项.预期结果Schema.safeParse(包装结果)
              if (校验结果.success === true) {
                await 回调({ 类型: '流程信息', 内容: `触发纯文本兜底: 自动将文本包装至字段 [${唯一字段名}]` })

                let 伪造id = 'call_fallback_text_' + Date.now().toString()
                let 伪造参数 = 校验结果.data as Record<string, unknown>
                await 回调({ 类型: '工具调用开始', 工具名称: 提交结果函数名, id: 伪造id, 参数: 伪造参数 })
                let 工具执行结果 = { 结果: '成功' as const, 信息: '结果提交成功' }
                await 回调({
                  类型: '工具调用结果',
                  工具名称: 提交结果函数名,
                  id: 伪造id,
                  结果: 工具执行结果,
                  耗时ms: 0,
                })

                消息列表.push({ role: 'assistant', content: 流式结果.完整文本 })

                let 验证失败 = await 运行结果验证器(
                  校验结果.data as Record<string, unknown>,
                  选项,
                  消息列表,
                  校验失败次数,
                  this.最大校验重试次数,
                  回调,
                )
                if (验证失败 !== null) {
                  校验失败次数 = 验证失败.新校验失败次数
                  continue
                }
                await 回调({ 类型: '最终结果', 结果: 校验结果.data as Record<string, unknown> })
                return { 结果: 校验结果.data as z.infer<T>, 消息列表, 新增上下文: 提取新增上下文() }
              }
            }
          }
        }

        // 文本提取失败, 让 AI 改用函数调用
        校验失败次数++
        if (校验失败次数 > this.最大校验重试次数) {
          await 回调({ 类型: '流程信息', 内容: 'AI 多次未能返回有效的结构化数据, 提前结束' })
          return { 结果: null, 消息列表, 新增上下文: 提取新增上下文(), 结束原因: '提取结构化数据失败' }
        }

        let 预期JsonSchema = zodToJsonSchema(选项.预期结果Schema)
        let 预期形状文本 = JSON.stringify(预期JsonSchema, null, 2)
        let 详细错误信息 = `无法从文本回复中提取有效的结构化数据。\n预期格式说明: ${选项.预期结果描述}\n预期结果形状 (JSON Schema):\n${预期形状文本}`

        await 回调({
          类型: '校验失败',
          错误信息: 详细错误信息,
          当前次数: 校验失败次数,
          最大次数: this.最大校验重试次数,
        })
        追加系统纠正消息(
          消息列表,
          流式结果.完整文本,
          `你的回复中没有包含有效的结构化数据。请使用 ${提交结果函数名} 函数调用来提交你的最终结果, 或在回复中包含一个 JSON 代码块, 内容以 \`{"type": "function", "function": {"name":\` 开头, 格式需要符合预期结果的 Schema。`,
        )
        continue
      }

      // 空回复
      await 回调({ 类型: '流程信息', 内容: 'AI 返回了空内容, 继续重试' })
      追加系统纠正消息(消息列表, null, '你的回复是空的, 请重新回答。')
    }

    await 回调({ 类型: '流程信息', 内容: `超出最大循环轮次 (${String(this.最大循环轮次)})` })
    return { 结果: null, 消息列表, 新增上下文: 提取新增上下文(), 结束原因: '超出最大轮次' }
  }

  // 统一处理 "工具调用 → 验证 → 返回/继续" 的逻辑
  private async 处理工具调用并验证<T extends z.ZodType>(
    工具调用列表: { id: string; 名称: string; 参数片段: string }[],
    消息列表: 智能体消息类型[],
    助手文本: string,
    合并工具列表: 智能体工具[],
    选项: 解决问题选项<T>,
    校验失败次数: number,
    回调: 智能体回调,
  ): Promise<
    | { 类型: '返回'; 数据: Record<string, unknown> }
    | { 类型: '更新次数'; 新次数: number }
    | { 类型: '继续' }
    | { 类型: '校验失败上限'; 错误信息: string }
  > {
    let 处理结果 = await 处理工具调用(
      工具调用列表,
      消息列表,
      助手文本,
      选项.预期结果Schema,
      回调,
      合并工具列表,
      false,
      选项.调试Hook,
      this.工具返回文本最大长度,
      选项.中断信号,
    )

    if (处理结果.类型 === '最终结果') {
      let 验证失败 = await 运行结果验证器(处理结果.数据, 选项, 消息列表, 校验失败次数, this.最大校验重试次数, 回调)
      if (验证失败 !== null) return { 类型: '更新次数', 新次数: 验证失败.新校验失败次数 }
      await 回调({ 类型: '最终结果', 结果: 处理结果.数据 })
      return { 类型: '返回', 数据: 处理结果.数据 }
    }

    if (处理结果.类型 === '校验失败') {
      let 新次数 = 校验失败次数 + 1
      if (新次数 > this.最大校验重试次数) {
        return {
          类型: '校验失败上限',
          错误信息: `校验失败次数超出上限 (${String(this.最大校验重试次数)}), 最后的错误: ${处理结果.错误信息}`,
        }
      }
      await 回调({ 类型: '校验失败', 错误信息: 处理结果.错误信息, 当前次数: 新次数, 最大次数: this.最大校验重试次数 })
      return { 类型: '更新次数', 新次数 }
    }

    return { 类型: '继续' }
  }

  public async 导出完整状态(当前消息历史?: 智能体消息类型[]): Promise<string> {
    return JSON.stringify({ 格式版本: 2, 消息历史: 复制消息列表(当前消息历史 ?? this.对话历史) })
  }

  public async 导入完整状态(状态数据: string): Promise<智能体消息类型[]> {
    let 消息历史 = 智能体状态Schema.parse(JSON.parse(状态数据)).消息历史
    this.载入对话历史(消息历史)
    return this.读取对话历史()
  }

  public async 开启交互调试<T extends z.ZodType>(选项: REPL选项<T>): Promise<void> {
    await runRepl(this, 选项)
  }
}
