import type openai from 'openai'
import { z } from 'zod'

// ============================================================
// 事件类型 - 智能体通过回调推送给外部的所有事件
// ============================================================

export let 智能体系统消息Schema = z.object({
  role: z.literal('system'),
  content: z.string(),
  name: z.string().optional(),
})
export type 智能体系统消息 = z.infer<typeof 智能体系统消息Schema>

export let 智能体开发者消息Schema = z.object({
  role: z.literal('developer'),
  content: z.string(),
  name: z.string().optional(),
})
export type 智能体开发者消息 = z.infer<typeof 智能体开发者消息Schema>

export let 智能体用户消息Schema = z.object({
  role: z.literal('user'),
  content: z.string(),
  name: z.string().optional(),
  isSystemCorrection: z.boolean().optional(),
  isSystemInjection: z.boolean().optional(),
})
export type 智能体用户消息 = z.infer<typeof 智能体用户消息Schema>

export let 智能体助手消息Schema = z.object({
  role: z.literal('assistant'),
  content: z.string().nullable().optional(),
  name: z.string().optional(),
  tool_calls: z
    .array(
      z.object({
        id: z.string(),
        type: z.literal('function'),
        function: z.object({ name: z.string(), arguments: z.string() }),
      }),
    )
    .optional(),
  function_call: z.object({ name: z.string(), arguments: z.string() }).nullable().optional(),
})
export type 智能体助手消息 = z.infer<typeof 智能体助手消息Schema>

export let 智能体工具消息Schema = z.object({ role: z.literal('tool'), content: z.string(), tool_call_id: z.string() })
export type 智能体工具消息 = z.infer<typeof 智能体工具消息Schema>

export let 智能体函数消息Schema = z.object({
  role: z.literal('function'),
  content: z.string().nullable(),
  name: z.string(),
})
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
  | { 类型: '工具调用开始'; 工具名称: string; id: string; 参数: Record<string, unknown> }
  | {
      类型: '工具调用结果'
      工具名称: string
      id: string
      结果: { 结果: '成功' | '失败' } & Record<string, unknown>
      耗时ms: number
    }
  | { 类型: '工具调用失败'; 工具名称: string; id: string; 错误信息: string }
  | { 类型: '校验失败'; 错误信息: string; 当前次数: number; 最大次数: number }
  | { 类型: '最终结果'; 结果: Record<string, unknown> }
  | { 类型: '流程信息'; 内容: string }
  | { 类型: '错误'; 错误信息: string }
  | { 类型: '原始请求配置'; 配置: object }
  | { 类型: '原始AI返回'; 完整文本: string; 工具调用列表: 累积工具调用[]; 当前消息列表: 智能体消息类型[] }

export type 智能体回调 = (事件: 智能体事件) => Promise<void>

// ============================================================
// 工具类
// ============================================================

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
    实现: (参数: z.infer<z.ZodObject<T>>) => Promise<z.infer<R>>
  }): 智能体工具 {
    return new 智能体工具({
      名称: 配置.名称,
      描述: 配置.描述,
      参数Schema: 配置.参数Schema,
      返回值Schema: 配置.返回值Schema,
      返回值描述: 配置.返回值描述,
      实现: async (参数): Promise<{ 结果: '成功' | '失败' } & Record<string, unknown>> =>
        await 配置.实现(配置.参数Schema.parse(参数)),
    })
  }

  public readonly 名称: string
  public readonly 描述: string
  public readonly 参数Schema: z.ZodObject<z.ZodRawShape>
  public readonly 返回值Schema: z.ZodType<{ 结果: '成功' | '失败' } & Record<string, unknown>>
  public readonly 返回值描述: string | undefined
  public readonly 实现: (参数: Record<string, unknown>) => Promise<{ 结果: '成功' | '失败' } & Record<string, unknown>>

  private constructor(配置: {
    名称: string
    描述: string
    参数Schema: z.ZodObject<z.ZodRawShape>
    返回值Schema: z.ZodType<{ 结果: '成功' | '失败' } & Record<string, unknown>>
    返回值描述?: string | undefined
    实现: (参数: Record<string, unknown>) => Promise<{ 结果: '成功' | '失败' } & Record<string, unknown>>
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
}

export type 解决问题选项<T extends z.ZodType> = {
  命令: string
  预期结果Schema: T
  预期结果描述: string
  回调: 智能体回调
  当前时间?: Date | undefined
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
  /** 单次解决问题时追加的临时系统提示词，放置于工具说明之后 */
  临时追加系统提示词?: string | undefined
  /** 单次解决问题时追加的临时工具列表，不污染实例的工具列表 */
  临时追加工具列表?: 智能体工具[] | undefined
}

/** 对话与推演共用的请求参数；实例负责管理对话历史。 */
export type 对话选项<T extends z.ZodType> = Omit<解决问题选项<T>, '消息历史'>

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
