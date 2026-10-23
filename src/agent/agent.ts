import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { 模型审计器, 统计模型输入字符数, 统计模型输出字符数 } from './audit'
import { 构建openai工具列表, 构建系统工具与格式说明 } from './build-messages'
import { 提交结果函数名 } from './constants'
import { 格式化当前时间, 追加注入消息到列表 } from './injection'
import { 前缀是否一致, 构造前缀已变结果, 计算前缀指纹 } from './prefix'
import { 开启交互调试 as runRepl } from './repl'
import { 复制消息列表, 提取可见消息, 智能体状态Schema } from './session-state'
import { 校验工具列表, 校验结果Schema } from './setup-validation'
import { 流式请求AI } from './stream-request'
import { 追加系统纠正消息 } from './system-correction'
import { 从文本提取工具调用, 从文本提取结果 } from './text-fallback'
import { 处理工具调用 } from './tool-handler'
import { 按需自动截断 } from './truncate'
import type {
  REPL选项,
  回合结果,
  对话选项,
  执行回合选项,
  智能体回调,
  智能体执行模式,
  智能体消息类型,
  智能体结束原因,
  智能体选项,
  模型审计汇总,
  模型用量,
  模型请求审计记录,
  解决问题选项,
} from './types'
import { 智能体工具 } from './types'
import { 运行结果验证器 } from './validator'

export class 智能体 {
  protected 工具列表: 智能体工具[]
  private 系统提示词: string
  private 最大校验重试次数: number
  private 最大循环轮次: number
  private 请求AI时间间隔ms: number
  private 工具返回文本最大长度?: number
  private 自动截断?: 智能体选项['自动截断']
  private 上次输入token数: number | undefined
  private 对话历史: 智能体消息类型[] = []
  private 会话任务队列: Promise<void> = Promise.resolve()
  private 审计器 = new 模型审计器()

  public constructor(选项: 智能体选项) {
    this.工具列表 = 选项.工具列表 ?? []
    校验工具列表(this.工具列表)
    this.系统提示词 = 选项.系统提示词 ?? ''
    this.最大校验重试次数 = 选项.最大校验重试次数 ?? 3
    this.最大循环轮次 = 选项.最大循环轮次 ?? 15
    this.请求AI时间间隔ms = 选项.请求AI时间间隔ms ?? 0
    this.工具返回文本最大长度 = 选项.工具返回文本最大长度 ?? 50000
    if (选项.自动截断 !== undefined) this.自动截断 = 选项.自动截断
  }

  /**
   * 子类提供的、拼在工具说明之后的固定系统提示词。
   * 它是前缀的一部分, 一个对话里必须保持不变, 所以不接受按次参数。
   */
  protected 提供附加系统提示词(): string | undefined {
    return undefined
  }

  public 组装系统提示词<T extends z.ZodType>(选项: 解决问题选项<T>, 执行模式: 智能体执行模式 = '普通'): string {
    let 合并工具列表 = 执行模式 === '推演' ? [] : [...this.工具列表, ...(选项.临时追加工具列表 ?? [])]
    let 工具与格式说明 = 构建系统工具与格式说明(合并工具列表, 选项)

    let parts = [this.系统提示词, 工具与格式说明, this.提供附加系统提示词()].filter((p) => p !== undefined && p !== '')
    return parts.join('\n\n')
  }

  /**
   * 在当前实例的会话历史上追加一轮可读写对话。
   * 历史消息一经写入便不再改动，以便复用模型提供商的前缀缓存。
   */
  public async 对话<T extends z.ZodType>(选项: 对话选项<T>): Promise<回合结果<T>> {
    return await this.执行会话任务(async () => {
      let 结果 = await this.执行解决问题(
        { ...选项, 消息历史: this.对话历史, 上次输入token数: this.上次输入token数 },
        '对话',
        this.审计器.当前会话是否已有请求() === false,
        true,
      )
      this.对话历史 = 复制消息列表(结果.消息列表)
      this.上次输入token数 =
        结果.用量.findLast((项) => 项.输入token数 !== undefined)?.输入token数 ?? this.上次输入token数
      return 结果
    })
  }

  /** 在当前会话环境中临时推演，不追加消息，也不向模型暴露普通工具。 */
  public async 推演<T extends z.ZodType>(选项: 对话选项<T>): Promise<回合结果<T>> {
    return await this.执行会话任务(
      async () =>
        await this.执行解决问题(
          { ...选项, 消息历史: this.对话历史 },
          '推演',
          this.审计器.当前会话是否已有请求() === false,
        ),
    )
  }

  /** 执行一个由调用方管理历史的无状态回合，不读写实例会话。 */
  public async 执行回合<T extends z.ZodType>(选项: 执行回合选项<T>): Promise<回合结果<T>> {
    let 消息历史 = 复制消息列表(选项.消息历史 ?? [])
    return await this.执行解决问题({ ...选项, 消息历史 }, '普通', 消息历史.length === 0)
  }

  /**
   * 在当前会话环境中执行可读写操作，但不把本轮消息写入对话历史。
   * 供子类实现私有工作流时使用。
   */
  protected async 执行不追加历史的对话<T extends z.ZodType>(选项: 对话选项<T>): Promise<回合结果<T>> {
    return await this.执行会话任务(
      async () =>
        await this.执行解决问题(
          { ...选项, 消息历史: this.对话历史 },
          '对话',
          this.审计器.当前会话是否已有请求() === false,
        ),
    )
  }

  /** 仅清空本实例的会话历史，不影响记忆库或工具配置。 */
  public 重置对话(): void {
    this.对话历史 = []
    this.上次输入token数 = undefined
    this.审计器.切换会话()
  }

  public 读取对话历史(): 智能体消息类型[] {
    return 复制消息列表(this.对话历史)
  }

  public 载入对话历史(消息历史: 智能体消息类型[], 会话标识?: string): void {
    this.对话历史 = 复制消息列表(消息历史)
    this.上次输入token数 = undefined
    this.审计器.切换会话(会话标识, this.对话历史.length > 0)
  }

  /** 仅供界面展示；不可用它恢复模型上下文，否则会破坏前缀缓存。 */
  public 读取可见对话历史(): 智能体消息类型[] {
    return 提取可见消息(this.对话历史)
  }

  public 读取会话标识(): string {
    return this.审计器.读取会话标识()
  }

  public 读取模型审计记录(): 模型请求审计记录[] {
    return this.审计器.读取记录()
  }

  public 读取模型审计汇总(): 模型审计汇总 {
    return this.审计器.读取汇总()
  }

  public 清空模型审计记录(): void {
    this.审计器.清空记录()
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

  /** 按本轮参数算出工具列表、系统提示词和前缀指纹(没有任何副作用) */
  protected 计算前缀<T extends z.ZodType>(
    选项: 解决问题选项<T>,
    执行模式: 智能体执行模式,
  ): {
    合并工具列表: 智能体工具[]
    openai工具列表: ReturnType<typeof 构建openai工具列表>
    完整系统提示词: string
    前缀指纹: string
  } {
    let 合并工具列表 = 执行模式 === '推演' ? [] : [...this.工具列表, ...(选项.临时追加工具列表 ?? [])]
    校验工具列表(合并工具列表)
    校验结果Schema(选项.预期结果Schema)
    let openai工具列表 = 构建openai工具列表(合并工具列表, 选项.预期结果Schema, 选项.预期结果描述)
    let 完整系统提示词 = this.组装系统提示词(选项, 执行模式)
    let 前缀指纹 = 计算前缀指纹(完整系统提示词, 选项.是否支持函数调用 === false ? [] : openai工具列表)
    return { 合并工具列表, openai工具列表, 完整系统提示词, 前缀指纹 }
  }

  /**
   * 只检查前缀、不做任何别的事。一致返回前缀指纹, 不一致返回 '前缀已变'。
   * 子类在做有副作用的准备工作(比如自动召回)之前先调用它。
   */
  protected 检查前缀<T extends z.ZodType>(选项: 解决问题选项<T>, 执行模式: 智能体执行模式): string | '前缀已变' {
    let { 前缀指纹 } = this.计算前缀(选项, 执行模式)
    return 前缀是否一致(选项.消息历史 ?? [], 执行模式, 前缀指纹) ? 前缀指纹 : '前缀已变'
  }

  protected async 执行解决问题<T extends z.ZodType>(
    选项: 解决问题选项<T>,
    执行模式: 智能体执行模式,
    首次请求是否新建对话: boolean = false,
    更新当前会话审计状态: boolean = false,
  ): Promise<回合结果<T>> {
    let 回调 = 选项.回调
    let 原历史 = 选项.消息历史 ?? []
    let 用量列表: 模型用量[] = []

    let { 合并工具列表, openai工具列表, 完整系统提示词, 前缀指纹 } = this.计算前缀(选项, 执行模式)

    // 前缀 = 第一条 system + 工具定义。前缀变了就不发请求, 由调用方决定新开对话还是用新前缀重开。推演是从主历史分出去的支线, 不检查。
    if (前缀是否一致(原历史, 执行模式, 前缀指纹) === false) {
      await 回调({ 类型: '流程信息', 内容: '前缀已变: 系统提示词或工具定义与历史不一致, 未发出请求' })
      return 构造前缀已变结果<T>(原历史)
    }

    // 自动截断: 只在本轮请求前、整体替换历史时发生
    let 基础历史 = 原历史
    let 历史已截断 = false
    if (执行模式 !== '推演' && this.自动截断 !== undefined) {
      let 截断结果 = 按需自动截断(原历史, this.自动截断, 选项.上次输入token数)
      if (截断结果 !== null) {
        基础历史 = 截断结果
        历史已截断 = true
        await 回调({
          类型: '流程信息',
          内容: `历史过长, 已从头截断: ${String(原历史.length)} 条 -> ${String(截断结果.length)} 条`,
        })
      }
    }

    let 消息列表: 智能体消息类型[] = [...基础历史]
    // 返回给调用方的新增上下文从这里开始。首轮插入的带指纹的 system 属于新增上下文; 推演临时补的 system 不是。
    let 新增起点 = 消息列表.length
    if (消息列表.length === 0) {
      if (执行模式 === '推演') {
        消息列表.push({ role: 'system', content: 完整系统提示词 })
        新增起点 = 1
      } else {
        消息列表.push({ role: 'system', content: 完整系统提示词, prefixFingerprint: 前缀指纹 })
        新增起点 = 0
      }
    } else if (执行模式 === '推演' && 消息列表[0]?.role !== 'system') {
      消息列表.unshift({ role: 'system', content: 完整系统提示词 })
      新增起点 += 1
    }

    let 提取新增上下文 = (): 智能体消息类型[] => 消息列表.slice(新增起点)
    let 结束 = (结果: z.infer<T> | null, 结束原因?: 智能体结束原因): 回合结果<T> => ({
      结果,
      消息列表,
      新增上下文: 提取新增上下文(),
      ...(结束原因 !== undefined ? { 结束原因 } : {}),
      用量: 用量列表,
      历史已截断,
      ...(历史已截断 === true ? { 截断后历史: 基础历史 } : {}),
    })

    // 本轮追加顺序: 记忆状态 -> 召回 -> 调用方注入(按传入顺序) -> 当前时间 -> 用户命令
    追加注入消息到列表(消息列表, 选项.追加注入消息 ?? [])

    if (选项.命令 !== '') {
      if (选项.当前时间 !== undefined) {
        消息列表.push({
          role: 'user',
          content: `[当前时间: ${格式化当前时间(选项.当前时间)}]`,
          isSystemInjection: true,
          systemInjectionKind: 'current-time',
        })
      }
      消息列表.push({ role: 'user', content: 选项.命令 })
    }
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
        return 结束(null, '中断')
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
          return 结束(null, '中断')
        }
      }

      // 流式请求 AI
      let 发出字符数 = 统计模型输入字符数(消息列表, openai工具列表, 选项.是否支持函数调用, 选项.是否使用引导前缀)
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
      let 审计记录 = this.审计器.添加记录(
        总轮次 === 1 && 首次请求是否新建对话,
        流式结果.输入token数 ?? 发出字符数,
        流式结果.输出token数 ?? 统计模型输出字符数(流式结果.原始完整文本 ?? 流式结果.完整文本, 流式结果.工具调用列表),
        更新当前会话审计状态,
      )
      await 回调({ 类型: '模型请求审计', 记录: 审计记录 })
      用量列表.push({
        ...(流式结果.输入token数 !== undefined ? { 输入token数: 流式结果.输入token数 } : {}),
        ...(流式结果.缓存命中token数 !== undefined ? { 缓存命中token数: 流式结果.缓存命中token数 } : {}),
        ...(流式结果.输出token数 !== undefined ? { 输出token数: 流式结果.输出token数 } : {}),
      })

      // 检查是否被中断
      if (流式结果.已中断 === true) {
        await 回调({ 类型: '流程信息', 内容: '操作被中断' })
        return 结束(null, '中断')
      }

      // 情况1: AI 返回了 tool_calls
      if (流式结果.工具调用列表.length > 0) {
        if (是否中断() === true) {
          await 回调({ 类型: '流程信息', 内容: '操作被中断' })
          return 结束(null, '中断')
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
        if (结果.类型 === '返回') return 结束(结果.数据)
        if (结果.类型 === '校验失败上限') {
          await 回调({ 类型: '流程信息', 内容: 结果.错误信息 })
          return 结束(null, '校验失败次数超出上限')
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
          if (结果.类型 === '返回') return 结束(结果.数据)
          if (结果.类型 === '校验失败上限') {
            await 回调({ 类型: '流程信息', 内容: 结果.错误信息 })
            return 结束(null, '校验失败次数超出上限')
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
          return 结束(文本提取结果)
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
                return 结束(校验结果.data as z.infer<T>)
              }
            }
          }
        }

        // 文本提取失败, 让 AI 改用函数调用
        校验失败次数++
        if (校验失败次数 > this.最大校验重试次数) {
          await 回调({ 类型: '流程信息', 内容: 'AI 多次未能返回有效的结构化数据, 提前结束' })
          return 结束(null, '提取结构化数据失败')
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
    return 结束(null, '超出最大轮次')
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
    return JSON.stringify({
      格式版本: 2,
      会话标识: this.读取会话标识(),
      消息历史: 复制消息列表(当前消息历史 ?? this.对话历史),
    })
  }

  public async 导入完整状态(状态数据: string): Promise<智能体消息类型[]> {
    let 状态 = 智能体状态Schema.parse(JSON.parse(状态数据))
    this.载入对话历史(状态.消息历史, 状态.会话标识)
    return this.读取对话历史()
  }

  public async 开启交互调试<T extends z.ZodType>(选项: REPL选项<T>): Promise<void> {
    await runRepl(this, 选项)
  }
}
