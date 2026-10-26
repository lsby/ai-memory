import type openai from 'openai'
import { z } from 'zod'

// ============================================================
// 事件类型 - 智能体通过回调推送给外部的所有事件
// ============================================================

export let 智能体系统消息Schema = z
  .object({
    role: z.literal('system'),
    content: z.string(),
    name: z.string().optional(),
    /** 前缀指纹: 系统提示词全文与工具定义的 sha256, 仅供库内部校验, 发给模型时不携带 */
    prefixFingerprint: z.string().optional(),
    /** 持久化消息 ID，仅供库内部关联遥测，不发给模型商。 */
    持久化消息id: z.string().optional(),
  })
  .passthrough()
export type 智能体系统消息 = z.infer<typeof 智能体系统消息Schema>

export let 智能体开发者消息Schema = z
  .object({
    role: z.literal('developer'),
    content: z.string(),
    name: z.string().optional(),
    持久化消息id: z.string().optional(),
  })
  .passthrough()
export type 智能体开发者消息 = z.infer<typeof 智能体开发者消息Schema>

export let 智能体用户消息Schema = z
  .object({
    role: z.literal('user'),
    content: z.string(),
    name: z.string().optional(),
    isSystemCorrection: z.boolean().optional(),
    isSystemInjection: z.boolean().optional(),
    /** 注入消息的类型。库自己使用 memory-state、recall-context、current-time, 调用方可传任意字符串 */
    systemInjectionKind: z.string().optional(),
    systemInjectionFingerprint: z.string().optional(),
    持久化消息id: z.string().optional(),
  })
  .passthrough()
export type 智能体用户消息 = z.infer<typeof 智能体用户消息Schema>

export let 智能体助手消息Schema = z
  .object({
    role: z.literal('assistant'),
    content: z.string().nullable().optional(),
    name: z.string().optional(),
    tool_calls: z
      .array(
        z
          .object({
            id: z.string(),
            type: z.literal('function'),
            function: z.object({ name: z.string(), arguments: z.string() }).passthrough(),
          })
          .passthrough(),
      )
      .optional(),
    function_call: z.object({ name: z.string(), arguments: z.string() }).passthrough().nullable().optional(),
    持久化消息id: z.string().optional(),
  })
  .passthrough()
export type 智能体助手消息 = z.infer<typeof 智能体助手消息Schema>

export let 智能体工具消息Schema = z
  .object({
    role: z.literal('tool'),
    content: z.string(),
    tool_call_id: z.string(),
    持久化消息id: z.string().optional(),
  })
  .passthrough()
export type 智能体工具消息 = z.infer<typeof 智能体工具消息Schema>

export let 智能体函数消息Schema = z
  .object({
    role: z.literal('function'),
    content: z.string().nullable(),
    name: z.string(),
    持久化消息id: z.string().optional(),
  })
  .passthrough()
export type 智能体函数消息 = z.infer<typeof 智能体函数消息Schema>

export let 智能体消息Schema = z.discriminatedUnion('role', [
  智能体系统消息Schema,
  智能体开发者消息Schema,
  智能体用户消息Schema,
  智能体助手消息Schema,
  智能体工具消息Schema,
  智能体函数消息Schema,
])
export type 智能体消息类型 = z.infer<typeof 智能体消息Schema>

export type 智能体事件 =
  | { 类型: 'AI文本片段'; 内容: string }
  | {
      类型: '工具调用开始'
      工具名称: string
      id: string
      参数: Record<string, unknown>
      模型请求id?: string
      模型请求序号?: number
      前缀id?: string
    }
  | {
      类型: '工具调用结果'
      工具名称: string
      id: string
      结果: { 结果: '成功' | '失败' } & Record<string, unknown>
      耗时ms: number
      模型请求id?: string
      模型请求序号?: number
      前缀id?: string
    }
  | {
      类型: '工具调用失败'
      工具名称: string
      id: string
      错误信息: string
      模型请求id?: string
      模型请求序号?: number
      前缀id?: string
    }
  | { 类型: '校验失败'; 错误信息: string; 当前次数: number; 最大次数: number }
  | { 类型: '最终结果'; 结果: Record<string, unknown> }
  | { 类型: '流程信息'; 内容: string }
  | { 类型: '错误'; 错误信息: string }
  | { 类型: '原始请求配置'; 配置: object; 模型请求id: string; 模型请求序号: number; 前缀id: string }
  | {
      类型: '原始AI返回'
      完整文本: string
      工具调用列表: 累积工具调用[]
      当前消息列表: 智能体消息类型[]
      模型请求id: string
      模型请求序号: number
      前缀id: string
    }
  | {
      类型: '模型响应完成'
      模型请求id: string
      模型请求序号: number
      前缀id: string
      状态: '完成' | '中断' | '空响应'
      响应消息id?: string
      工具调用数量: number
    }
  | { 类型: '模型请求审计'; 记录: 模型请求审计记录; 模型请求id: string; 模型请求序号: number; 前缀id: string }

export type 模型请求上下文 = { id: string; 序号: number; 前缀id: string }

export type 智能体回调 = (事件: 智能体事件) => Promise<void>

export type 模型请求审计记录 = {
  id: string
  会话标识: string
  请求序号: number
  时间: Date
  缓存判定: '新建对话' | '复用已有对话'
  发出字符数: number
  返回字符数: number
}

/** 一次模型请求的真实 token 用量; 模型商没有返回的字段留空 */
export type 模型用量 = { 输入token数?: number; 缓存命中token数?: number; 输出token数?: number }

export type 智能体结束原因 = '中断' | '超出最大轮次' | '提取结构化数据失败' | '校验失败次数超出上限' | '前缀已变'

/** 一轮执行的返回结果 */
export type 回合结果<T extends z.ZodType> = {
  结果: z.infer<T> | null
  消息列表: 智能体消息类型[]
  /** 本轮新增的消息, 调用方按顺序追加到自己保存的历史末尾。首轮包含带前缀指纹的 system 消息 */
  新增上下文: 智能体消息类型[]
  结束原因?: 智能体结束原因
  /** 每次模型请求一项 */
  用量: 模型用量[]
}

export type 模型审计汇总 = {
  模型请求次数: number
  新建对话请求次数: number
  缓存复用请求次数: number
  发出字符数: number
  返回字符数: number
}

// ============================================================
// 工具类
// ============================================================

export type 智能体工具上下文 = { 中断信号?: AbortSignal | undefined }

/** 智能体工具: 将工具的定义和实现封装在一起, 通过静态方法 创建() 获得完整的类型推断 */
export class 智能体工具 {
  /** 类型安全的工厂方法, 泛型 T 确保 实现 的参数类型与 参数Schema 一致 */
  public static 创建<
    T extends z.ZodRawShape,
    R extends z.ZodType<{ 结果: '成功' | '失败' } & Record<string, unknown>>,
  >(配置: {
    名称: string
    描述: string
    参数Schema: z.ZodObject<T>
    返回值Schema: R
    返回值描述?: string | undefined
    实现: (参数: z.infer<z.ZodObject<T>>, 上下文: 智能体工具上下文) => Promise<z.infer<R>>
  }): 智能体工具 {
    return new 智能体工具({
      名称: 配置.名称,
      描述: 配置.描述,
      参数Schema: 配置.参数Schema,
      返回值Schema: 配置.返回值Schema,
      返回值描述: 配置.返回值描述,
      实现: async (参数, 上下文 = {}): Promise<{ 结果: '成功' | '失败' } & Record<string, unknown>> =>
        await 配置.实现(配置.参数Schema.parse(参数), 上下文),
    })
  }

  public readonly 名称: string
  public readonly 描述: string
  public readonly 参数Schema: z.ZodObject<z.ZodRawShape>
  public readonly 返回值Schema: z.ZodType<{ 结果: '成功' | '失败' } & Record<string, unknown>>
  public readonly 返回值描述: string | undefined
  public readonly 实现: (
    参数: Record<string, unknown>,
    上下文?: 智能体工具上下文,
  ) => Promise<{ 结果: '成功' | '失败' } & Record<string, unknown>>

  private constructor(配置: {
    名称: string
    描述: string
    参数Schema: z.ZodObject<z.ZodRawShape>
    返回值Schema: z.ZodType<{ 结果: '成功' | '失败' } & Record<string, unknown>>
    返回值描述?: string | undefined
    实现: (
      参数: Record<string, unknown>,
      上下文?: 智能体工具上下文,
    ) => Promise<{ 结果: '成功' | '失败' } & Record<string, unknown>>
  }) {
    this.名称 = 配置.名称
    this.描述 = 配置.描述
    this.参数Schema = 配置.参数Schema
    this.返回值Schema = 配置.返回值Schema
    this.返回值描述 = 配置.返回值描述
    this.实现 = 配置.实现
  }
}

// ============================================================
// 配置类型
// ============================================================

export type 智能体选项 = {
  工具列表?: 智能体工具[]
  系统提示词?: string
  最大校验重试次数?: number // 默认 3
  最大循环轮次?: number // 默认 15
  请求AI时间间隔ms?: number // 默认 0, 表示不延迟
  工具返回文本最大长度?: number // 默认 50000
  /**
   * 额外请求参数: 合并进每次请求体, 各家模型的私有参数(比如豆包的 thinking)从这里传。
   * 不能包含库自己管理的字段 model、messages、tools、stream、stream_options, 否则构造时报错。
   * 它不改变消息和工具, 所以不算进前缀指纹; 一个对话里请自己保证不换参数。
   */
  额外请求参数?: Record<string, unknown>
  /**
   * 时区(IANA 名称, 如 Asia/Shanghai)。用于注入的 [当前时间: …] 和记忆状态里的"记录于…"。
   * 实例上设置默认值, 单次调用的 时区 优先。不传用服务器时区。
   */
  时区?: string
}

/** 追加注入消息: 每轮可传, 追加在本轮末尾。类型 相同且内容和历史中同类型最后一条相同时不重复追加 */
export type 追加注入消息 = { 类型: string; 内容: string }

/** 库内部使用的注入消息, 在 追加注入消息 的基础上可指定去重指纹, 或者每次都追加。不对外导出 */
export type 内部注入消息 = 追加注入消息 & { 指纹?: string; 总是追加?: boolean }

export type 解决问题选项<T extends z.ZodType> = {
  命令: string
  预期结果Schema: T
  预期结果描述: string
  回调: 智能体回调
  当前时间?: Date | undefined
  /** 本次调用使用的时区(IANA 名称), 优先于实例上的 时区。时间注入是按次追加的, 不影响前缀 */
  时区?: string | undefined
  消息历史?: Array<智能体消息类型>
  openai客户端: openai
  模型名称: string
  中断信号?: AbortSignal
  /** 可选的后置验证器: zod 校验通过后执行, 失败时错误信息会发给 AI 要求修正 */
  结果验证器?: ((结果: z.infer<T>) => Promise<{ 通过: true } | { 通过: false; 错误信息: string }>) | undefined
  /** 是否支持原生函数调用，默认 true，若不支持，则会在请求时使用 prefill 引导 */
  是否支持函数调用?: boolean | undefined
  /** 是否使用引导前缀，默认 true，配合 是否支持函数调用=false 使用 */
  是否使用引导前缀?: boolean | undefined
  /** 单次流式输出的最大 token 数量，若不传则可以使用默认限制 */
  最大输出token?: number | undefined
  /** AI 温度 */
  温度?: number | undefined
  /** 核采样 (Top P) */
  核采样?: number | undefined
  /** 存在惩罚 (Presence Penalty) */
  存在惩罚?: number | undefined
  /** 频率惩罚 (Frequency Penalty) */
  频率惩罚?: number | undefined
  /** 调试拦截钩子：用于 REPL 等交互式调试场景 */
  调试Hook?: 调试拦截钩子 | undefined
  /** 单次解决问题时追加的注入消息, 追加在本轮末尾。顺序: 记忆状态、召回、这里的注入(按传入顺序)、当前时间、用户命令 */
  追加注入消息?: 追加注入消息[] | undefined
  /** 单次解决问题时追加的临时工具列表，不污染实例的工具列表 */
  临时追加工具列表?: 智能体工具[] | undefined
}

/** 库内部在选项上附带的注入消息(记忆状态、召回), 先于调用方的 追加注入消息 追加。不对外导出 */
export type 内部解决问题选项<T extends z.ZodType> = 解决问题选项<T> & { 内部注入消息?: 内部注入消息[] | undefined }

/** 对话与推演共用的请求参数；实例负责管理对话历史。 */
export type 对话选项<T extends z.ZodType> = Omit<解决问题选项<T>, '消息历史'>

/** 由调用方管理消息历史的无状态单回合执行选项。 */
export type 执行回合选项<T extends z.ZodType> = 解决问题选项<T>

export type 智能体执行模式 = '普通' | '对话' | '推演'

export type 调试拦截钩子 = {
  调用前?: (
    工具名称: string,
    参数: Record<string, unknown>,
  ) => Promise<
    { 动作: '放行' } | { 动作: '拦截'; 返回给AI的文本: string } | { 动作: '打回'; 返回给AI的错误信息: string }
  >
  调用后?: (
    工具名称: string,
    参数: Record<string, unknown>,
    真实结果: Record<string, unknown>,
  ) => Promise<
    { 动作: '放行' } | { 动作: '拦截'; 返回给AI的文本: string } | { 动作: '打回'; 返回给AI的错误信息: string }
  >
  出错时?: (
    工具名称: string,
    参数片段或解析后参数: string | Record<string, unknown>,
    错误信息: string,
  ) => Promise<
    { 动作: '放行' } | { 动作: '拦截'; 返回给AI的文本: string } | { 动作: '打回'; 返回给AI的错误信息: string }
  >
}

export type 拦截策略 = '调用前' | '调用后' | '出错时'

export type REPL选项<T extends z.ZodType> = 解决问题选项<T> & {
  状态文件路径?: string
  自动保存?: boolean
  拦截策略?: 拦截策略[]
}

// ============================================================
// 内部类型
// ============================================================

/** 累积的 tool_call 信息 */
export type 累积工具调用 = { id: string; 名称: string; 参数片段: string }

// ============================================================
// WebSocket 事件类型
// ============================================================

export let 通用智能体WebSocket事件Schema = z.object({
  type: z.enum([
    'text',
    'toolCallStart',
    'toolCallResult',
    'toolCallError',
    'validateFail',
    'agentError',
    'agentComplete',
    'initState',
  ]),
  data: z.string(),
})

export type 通用智能体WebSocket事件 = z.infer<typeof 通用智能体WebSocket事件Schema>

export let 通用智能体WebSocket中断Schema = z.object({ type: z.enum(['interrupt', 'attach']) })
export type 通用智能体WebSocket中断 = z.infer<typeof 通用智能体WebSocket中断Schema>
