import type { PGlite } from '@electric-sql/pglite'
import type { ColumnType, Kysely } from 'kysely'
import type OpenAI from 'openai'
import { z } from 'zod'
import { 格式化当前时间 } from '../agent/message/injection'
import type { 模型语言包 } from '../agent/model-language'
import {
  智能体消息Schema,
  type 内部注入消息,
  type 对话选项,
  type 智能体事件,
  type 智能体消息类型,
  type 智能体选项,
  type 解决问题选项,
} from '../agent/types'

export enum 记忆等级 {
  零级 = '零级',
  一级 = '一级',
  二级 = '二级',
}

export let 记忆表Schema = z.object({
  id: z.string(),
  等级: z.nativeEnum(记忆等级),
  评分: z.number(),
  内容: z.string(),
  关键词: z.array(z.string()),
  标签: z.array(z.string()),
  向量: z.union([z.string(), z.array(z.number())]).nullish(),
  向量维度: z.number().nullish(),
  创建时间: z.union([z.string(), z.date()]).transform((val) => new Date(val)),
  创建序号: z.number().optional(),
  最后访问序号: z.number().optional(),
  访问次数: z.number().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
})

export type 记忆表 = z.infer<typeof 记忆表Schema>

export let 记忆关联表Schema = z.object({ 起点id: z.string(), 终点id: z.string(), 关联度: z.number() })
export type 记忆关联表 = z.infer<typeof 记忆关联表Schema>

export let 记忆提交表Schema = z.object({
  id: z.string(),
  父提交id: z.string().nullable(),
  消息: z.string(),
  创建时间: z.union([z.string(), z.date()]).transform((val) => new Date(val)),
})
export type 记忆提交表 = z.infer<typeof 记忆提交表Schema>

export let 记忆变更表Schema = z.object({
  id: z.string(),
  序号: z.number().optional(),
  提交id: z.string(),
  操作类型: z.enum(['add', 'update', 'delete', 'init']),
  目标表: z.enum(['node', 'link', 'tool']),
  目标id: z.string(),
  旧值: z.string().nullable(),
  新值: z.string().nullable(),
})
export type 记忆变更表 = z.infer<typeof 记忆变更表Schema>

export let 记忆元数据表Schema = z.object({ 键: z.string(), 值: z.string() })
export type 记忆元数据表 = z.infer<typeof 记忆元数据表Schema>

export let 动态工具表Schema = z.object({
  id: z.string(),
  名称: z.string(),
  描述: z.string(),
  代码: z.string(),
  向量: z.union([z.string(), z.array(z.number())]).nullish(),
  向量维度: z.number().nullish(),
  创建时间: z.union([z.string(), z.date()]).transform((val) => new Date(val)),
})
export type 动态工具表 = z.infer<typeof 动态工具表Schema>

export type JSON值 = string | number | boolean | null | JSON值[] | { [键: string]: JSON值 }

export let JSON值Schema: z.ZodType<JSON值> = z.lazy(() =>
  z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(JSON值Schema), z.record(JSON值Schema)]),
)

let 交互日志公共字段 = {
  开始时间: z.union([z.string(), z.date()]).transform((值) => new Date(值)),
  耗时ms: z.number().finite().nonnegative().optional(),
  内容: JSON值Schema,
  上下文消息id: z.string().optional(),
  消息id: z.string().optional(),
  模型请求id: z.string().optional(),
  记忆提交id: z.string().optional(),
  前缀id: z.string().optional(),
}

export let 交互日志事件类型Schema = z.enum([
  '流程开始',
  '流程结束',
  '流程异常',
  '记忆召回',
  '记忆提交',
  '记忆分支切换',
  'AI文本片段',
  '工具调用开始',
  '工具调用结果',
  '工具调用失败',
  '校验失败',
  '最终结果',
  '流程信息',
  '错误',
  '原始请求配置',
  '原始AI返回',
  '模型请求审计',
  '模型响应完成',
  '自定义',
])

export let 交互日志事件Schema = z.discriminatedUnion('类型', [
  z.object({ 类型: z.literal('流程开始'), ...交互日志公共字段 }),
  z.object({ 类型: z.literal('流程结束'), ...交互日志公共字段 }),
  z.object({ 类型: z.literal('流程异常'), ...交互日志公共字段 }),
  z.object({ 类型: z.literal('记忆召回'), ...交互日志公共字段 }),
  z.object({ 类型: z.literal('记忆提交'), ...交互日志公共字段 }),
  z.object({ 类型: z.literal('记忆分支切换'), ...交互日志公共字段 }),
  z.object({ 类型: z.literal('AI文本片段'), ...交互日志公共字段 }),
  z.object({ 类型: z.literal('工具调用开始'), ...交互日志公共字段 }),
  z.object({ 类型: z.literal('工具调用结果'), ...交互日志公共字段 }),
  z.object({ 类型: z.literal('工具调用失败'), ...交互日志公共字段 }),
  z.object({ 类型: z.literal('校验失败'), ...交互日志公共字段 }),
  z.object({ 类型: z.literal('最终结果'), ...交互日志公共字段 }),
  z.object({ 类型: z.literal('流程信息'), ...交互日志公共字段 }),
  z.object({ 类型: z.literal('错误'), ...交互日志公共字段 }),
  z.object({ 类型: z.literal('原始请求配置'), ...交互日志公共字段 }),
  z.object({ 类型: z.literal('原始AI返回'), ...交互日志公共字段 }),
  z.object({ 类型: z.literal('模型请求审计'), ...交互日志公共字段 }),
  z.object({ 类型: z.literal('模型响应完成'), ...交互日志公共字段 }),
  z.object({ 类型: z.literal('自定义'), ...交互日志公共字段 }),
])
export type 交互日志事件 = z.infer<typeof 交互日志事件Schema>
export type 交互日志事件类型 = z.infer<typeof 交互日志事件类型Schema>

export type 交互日志表 = {
  id: string
  序号?: number
  事件组id: string
  类型: 交互日志事件类型
  开始时间: Date
  耗时ms: number | null
  内容: ColumnType<JSON值, string, string>
  上下文消息id: string | null
  消息id: string | null
  模型请求id: string | null
  记忆提交id: string | null
  前缀id: string | null
}

export type 前缀快照表 = {
  id: string
  系统提示词: string
  工具定义: ColumnType<JSON值, string, string>
  创建时间: Date
}

export type 会话表 = {
  id: string
  标题: string
  当前消息id: string | null
  前驱会话id: string | null
  前驱消息id: string | null
  创建时间: Date
  更新时间: Date
}

export type 消息表 = {
  id: string
  序号: number | undefined
  会话id: string
  父消息id: string | null
  角色: 智能体消息类型['role']
  载荷: ColumnType<智能体消息类型, string, string>
  创建时间: Date
}

export type 记忆数据库 = {
  记忆表: 记忆表
  记忆关联表: 记忆关联表
  记忆提交表: 记忆提交表
  记忆变更表: 记忆变更表
  记忆元数据表: 记忆元数据表
  动态工具表: 动态工具表
  前缀快照表: 前缀快照表
  交互日志表: 交互日志表
  会话表: 会话表
  消息表: 消息表
}

export type 自动压缩配置 = {
  触发字符数: number
  目标字符数: number
  /**
   * 压缩自己的时限(毫秒)。摘要请求在 调用方中断信号 和这个时限里先到的一个到点时被放弃。
   * 压缩超时或失败时跳过压缩、保留原会话, 正式那一轮照常使用未压缩的历史。不配则只受调用方中断信号控制。
   */
  超时毫秒?: number | undefined
  /**
   * 同一会话上次自动压缩失败后, 历史字符数比失败时多出不到这个值就不再尝试。
   * 依据从交互日志里该会话最近一次自动压缩的 流程异常 记录推出, 之后压缩成功过则不再冷却。不配则每轮都会重试。
   */
  失败后冷却字符数?: number | undefined
}

export type 带记忆的智能体选项 = 智能体选项 & {
  /** 仅在持久化对话超过阈值时自动创建摘要派生会话。失败时原会话保持可用。 */
  自动压缩?: 自动压缩配置 | undefined
  一级记忆容量?: number
  /**
   * 二级记忆保留指数的自然遗忘阈值。
   * 低于该分数的记忆将在清理时被自然遗忘。
   */
  二级记忆遗忘分数阈值?: number
  /**
   * 二级记忆物理容量的兜底防爆数量。
   * 如果高分记忆过多导致总数超过该值，将强制触发末位淘汰。
   */
  二级记忆数量上限?: number
  /**
   * 二级记忆衰减常数 k，默认 0.05。
   * 控制每次信息冲刷对记忆保留指数的影响。
   */
  二级记忆衰减常数k?: number
  /**
   * 二级记忆访问次数防爆上限，默认 10000。
   * 防止单条记忆因被检索次数过多而彻底免疫遗忘。
   */
  二级记忆访问次数上限?: number
  向量模型?:
    | { 类型: '在线'; openai客户端: OpenAI; 模型名称: string; 维度?: number }
    | {
        类型: '本地'
        模型名称?:
          | 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
          | 'Xenova/jina-embeddings-v2-base-zh'
          | 'Xenova/bge-base-zh-v1.5'
          | 'Xenova/bge-m3'
          | (string & {})
        下载缓存目录?: string
      }
    | { 类型: '无' }
  自动检索二级记忆数量?: number
  自动检索二级记忆起点数?: number
  自动检索动态工具数量?: number
  向量相似度关联阈值?: number
  /**
   * 存储位置。默认内存。三种模式都可以带 schema（默认 public，和旧版本的数据布局一致）。
   * 外部模式由调用方自己创建和关闭 PGlite（必须带 pgvector 扩展），实例的 销毁() 不会关闭这个句柄。
   * 多个实例共用一个 PGlite 时，库内部按 PGlite 对象加连接互斥锁，所有读写排同一个队。
   */
  存储?: 存储配置
  /**
   * 是否不挂深度推演工具, 默认 false。
   * 工具定义是前缀的一部分, 所以只能在实例上设置, 不能按次传。
   */
  禁用深度推演?: boolean
  /**
   * 记忆工具筛选, 默认全开。返回 false 的工具既不挂给模型, 也不出现在默认记忆提示词里。
   * 工具定义是前缀的一部分, 所以只能在实例上设置, 换了筛选会导致已有对话 前缀已变。
   * 构造时对每个工具名只调用一次, 结果在实例生命周期内固定。工具名见导出的 记忆工具名。
   */
  记忆工具筛选?: (工具名: string) => boolean
  /**
   * 记忆操作指南。不传用库自带的, 按启用的工具拼段落; 传字符串替换操作指南;
   * 传函数则收到启用的工具名列表(构造时调用一次), 返回完整操作指南。
   * 完整提示词是前缀的一部分, 只能在实例上设置。
   */
  记忆提示词?: string | ((启用的工具名: string[]) => string)
  /**
   * 遗忘豁免: 返回 true 的二级记忆不参与自然遗忘和末位淘汰。默认不豁免任何记忆。
   * 在清理的事务里同步调用, 不要在里面做网络请求。被豁免的记忆仍计入二级记忆数量上限。
   */
  遗忘豁免?: (记忆: 公开记忆) => boolean
  /**
   * 受保护标签: 返回 true 的标签不能被模型工具改动。
   * 模型工具(edit_level_0/1_memory、overwrite_memory_tags、remove_memory_tags、append_memory_tags、
   * 三个 add_level_*_memory)改标签时: 原记忆上命中的标签一律保留; 模型想新增命中的标签会被忽略。
   * 调用方自己用公开方法(添加记忆、更新记忆、批量注入记忆)改标签不受限制。
   * 只影响工具的执行结果, 不改系统提示词和工具定义, 所以不影响前缀。默认不保护任何标签。
   * 在工具执行的事务里同步调用, 不要在里面做网络请求。
   */
  受保护标签?: (标签: string) => boolean
}

export type 存储配置 =
  | { 模式: '内存'; schema?: string }
  | { 模式: '文件'; 路径: string; schema?: string }
  | { 模式: '外部'; pglite: PGlite; schema?: string }

export type 内部带记忆的智能体配置 = Omit<智能体选项, '模型语言包'> &
  Required<
    Omit<带记忆的智能体选项, keyof 智能体选项 | '自动压缩' | '记忆工具筛选' | '记忆提示词' | '遗忘豁免' | '受保护标签'>
  > & {
    模型语言包: 模型语言包
    自动压缩?: 自动压缩配置 | undefined
    记忆工具筛选?: (工具名: string) => boolean
    记忆提示词?: string | ((启用的工具名: string[]) => string)
    /** 已经按 记忆工具筛选 和 禁用深度推演 算好的启用工具名, 构造时固定 */
    启用的记忆工具名: string[]
    遗忘豁免: (记忆: 公开记忆) => boolean
    受保护标签?: (标签: string) => boolean
  }

export type 带记忆的解决问题选项<T extends z.ZodType> = 解决问题选项<T> & {
  标题?: string | undefined
  是否自动召回?: boolean | undefined
  /** 将本次流程挂到指定事件组；不传则自动生成。 */
  事件组id?: string | undefined
}

/** 库内部使用: 在公开选项上附带内部注入消息。不对外导出 */
export type 内部带记忆的解决问题选项<T extends z.ZodType> = 带记忆的解决问题选项<T> & {
  内部注入消息?: 内部注入消息[] | undefined
}

/** 库内部使用: 对话选项 附带已经确定的事件组id。不对外导出 */
export type 带事件组的对话选项<T extends z.ZodType> = 对话选项<T> & { 事件组id?: string | undefined }

/** 实例管理对话历史时使用的请求参数。 */
export type 带记忆的对话选项<T extends z.ZodType> = Omit<带记忆的解决问题选项<T>, '消息历史'>

export let 批量注入记忆项Schema = z.object({
  内容: z.string().trim().min(1),
  关键词: z.array(z.string().trim().min(1)),
  标签: z.array(z.string().trim().min(1)),
  评分: z.number().finite().min(0).max(100),
  等级: z.nativeEnum(记忆等级),
  创建时间: z.union([z.string(), z.date()]).transform((值) => new Date(值)),
})
export type 批量注入记忆项 = z.infer<typeof 批量注入记忆项Schema>

export let 更新记忆选项Schema = z
  .object({
    内容: z.string().trim().min(1).optional(),
    关键词: z.array(z.string().trim().min(1)).optional(),
    标签: z.array(z.string().trim().min(1)).optional(),
    评分: z.number().finite().min(0).max(100).optional(),
    等级: z.nativeEnum(记忆等级).optional(),
  })
  .refine((值) => Object.values(值).some((项) => 项 !== undefined), '至少提供一个需要更新的字段')
export type 更新记忆选项 = z.infer<typeof 更新记忆选项Schema>

/** 供应用读取的稳定记忆视图，不包含存储、向量和布局实现细节。 */
export type 公开记忆 = {
  id: string
  等级: 记忆等级
  评分: number
  内容: string
  关键词: string[]
  标签: string[]
  创建时间: Date
}

export type 查询记忆选项 = {
  等级?: 记忆等级 | undefined
  标签?: string | undefined
  关键词?: string | undefined
  搜索文本?: string | undefined
  偏移?: number | undefined
  数量?: number | undefined
}

export type 公开记忆关联 = { 起点id: string; 终点id: string; 关联度: number }

export type 公开动态工具 = { id: string; 名称: string; 描述: string; 代码: string; 创建时间: Date }

export type 公开记忆变更 = {
  id: string
  操作类型: 'add' | 'update' | 'delete' | 'init'
  目标表: 'node' | 'link' | 'tool'
  目标id: string
  旧值: string | null
  新值: string | null
}

export type 公开记忆提交 = {
  id: string
  父提交id: string | null
  消息: string
  创建时间: Date
  变更列表: 公开记忆变更[]
}

export type 公开交互日志 = {
  id: string
  序号: number
  事件组id: string
  类型: 交互日志事件类型
  开始时间: Date
  耗时ms?: number
  内容: JSON值
  上下文消息id?: string
  消息id?: string
  模型请求id?: string
  记忆提交id?: string
  前缀id?: string
}

export type 公开前缀快照 = {
  id: string
  系统提示词: string
  工具定义: JSON值
  创建时间: Date
}

export type 公开会话 = {
  id: string
  标题: string
  当前消息id: string | null
  前驱会话id: string | null
  前驱消息id: string | null
  创建时间: Date
  更新时间: Date
}

export type 公开消息 = {
  id: string
  序号: number
  会话id: string
  父消息id: string | null
  消息: 智能体消息类型
  创建时间: Date
}

export type 查询会话列表选项 = { 偏移?: number | undefined; 数量?: number | undefined }

export type 创建派生会话选项 = {
  前驱会话id: string
  前驱消息id: string
  摘要: string
  标题?: string | undefined
}

export type 压缩当前会话选项 = {
  openai客户端: OpenAI
  模型名称: string
  目标字符数: number
  标题?: string | undefined
  /** 合并进摘要请求体的额外参数(如关闭深度思考); 不能含库管理的字段 */
  额外请求参数?: Record<string, unknown> | undefined
  /** 中断摘要请求; 中断时放弃压缩, 原会话保持不变 */
  中断信号?: AbortSignal | undefined
  /** 压缩过程的交互日志挂到这个事件组; 不传则自动生成 */
  事件组id?: string | undefined
}

export type 查询交互日志选项 = {
  事件组id?: string | undefined
  类型?: 交互日志事件类型 | undefined
  /** 按日志的 `开始时间` 过滤: 只要 开始时间 >= 此值(包含); 必须是有效 Date */
  开始时间起?: Date | undefined
  /** 按日志的 `开始时间` 过滤: 只要 开始时间 < 此值(不包含); 必须是有效 Date; 与 `开始时间起` 同给时要求 起 < 止。按天切可用 [当天 0 点, 次日 0 点) */
  开始时间止?: Date | undefined
  偏移?: number | undefined
  数量?: number | undefined
}

export let 快照数据Schema = z.object({
  格式版本: z.literal(2),
  记忆列表: z.array(记忆表Schema),
  记忆关联列表: z.array(记忆关联表Schema),
  动态工具列表: z.array(动态工具表Schema),
})
export type 快照数据 = z.infer<typeof 快照数据Schema>

export let 完整状态Schema = z.object({
  格式版本: z.literal(4),
  记忆快照: 快照数据Schema,
  当前会话id: z.string().nullable(),
  会话列表: z.array(
    z.object({
      id: z.string(),
      标题: z.string(),
      当前消息id: z.string().nullable(),
      前驱会话id: z.string().nullable(),
      前驱消息id: z.string().nullable(),
      创建时间: z.union([z.string(), z.date()]).transform((值) => new Date(值)),
      更新时间: z.union([z.string(), z.date()]).transform((值) => new Date(值)),
    }),
  ),
  消息列表: z.array(
    z.object({
      id: z.string(),
      序号: z.number().int(),
      会话id: z.string(),
      父消息id: z.string().nullable(),
      消息: 智能体消息Schema,
      创建时间: z.union([z.string(), z.date()]).transform((值) => new Date(值)),
    }),
  ),
  前缀快照列表: z.array(
    z.object({
      id: z.string(),
      系统提示词: z.string(),
      工具定义: JSON值Schema,
      创建时间: z.union([z.string(), z.date()]).transform((值) => new Date(值)),
    }),
  ),
})
export type 完整状态 = z.infer<typeof 完整状态Schema>

// ============================================================
// 获取向量结果类型
// ============================================================

export type 获取向量结果 = { 类型: '成功'; 向量: number[] } | { 类型: '无模型' } | { 类型: '失败'; 错误信息: string }

// ============================================================
// 记忆操作上下文 — 门面类传递给外部纯函数的统一上下文
// ============================================================

export type 记忆操作上下文 = {
  数据库查询器: Kysely<记忆数据库>
  配置: 内部带记忆的智能体配置
  /** 只读取本次调用的向量缓存，缓存里没有就报错；事务内绝不发网络请求。需要向量时先用 带向量缓存 预取。 */
  获取向量: (内容: string) => Promise<获取向量结果>
  /** 在事务外把这些文本的向量先算好，返回一个带有新向量缓存的上下文（数据库查询器不变）。 */
  带向量缓存: (内容列表: string[]) => Promise<记忆操作上下文>
  检查并降级一级记忆: () => Promise<void>
  检查并清理二级记忆: () => Promise<void>
  保存快照: () => Promise<string>
  执行记忆变更: <R>(消息: string, 操作: (上下文: 记忆操作上下文) => Promise<R>) => Promise<R>
  事件组id: string
  记录交互日志: (事件: 交互日志事件) => Promise<公开交互日志>
  回调?: ((事件: 智能体事件) => Promise<void>) | undefined
}

/** 不传时区用服务器时区, 传了按 IANA 时区名 */
export function 格式化为本地时间字符串(时间: Date, 时区?: string): string {
  return 格式化当前时间(时间, 时区)
}

// ============================================================
// WebSocket 事件类型
// ============================================================

export let 记忆智能体WebSocket事件Schema = z.union([
  z.object({ type: z.literal('log'), message: z.string() }),
  z.object({
    type: z.literal('search_hit'),
    data: z.object({ nodes: z.array(z.object({ id: z.string(), x: z.number(), y: z.number() })) }),
  }),
  z.object({ type: z.literal('search_link'), data: z.object({ source: z.string(), target: z.string() }) }),
  z.object({ type: z.literal('reply_chunk'), text: z.string() }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({ type: z.literal('done'), memoryUsed: z.array(z.string()) }),
])

export type 记忆智能体WebSocket事件 = z.infer<typeof 记忆智能体WebSocket事件Schema>

export let 记忆智能体WebSocket中断Schema = z.object({ type: z.enum(['interrupt']) })
export type 记忆智能体WebSocket中断 = z.infer<typeof 记忆智能体WebSocket中断Schema>
