import type { Kysely } from 'kysely'
import type OpenAI from 'openai'
import { z } from 'zod'
import { 智能体消息Schema, type 智能体事件, type 智能体选项, type 解决问题选项 } from '../agent/types'

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
  目标表: z.enum(['node', 'link']),
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

export type 记忆数据库 = {
  记忆表: 记忆表
  记忆关联表: 记忆关联表
  记忆提交表: 记忆提交表
  记忆变更表: 记忆变更表
  记忆元数据表: 记忆元数据表
  动态工具表: 动态工具表
}

export type 带记忆的智能体选项 = 智能体选项 & {
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
    | { 类型: '在线'; openai客户端: OpenAI; 模型名称: string }
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
  存储?: { 模式: '内存' } | { 模式: '文件'; 路径: string }
}

export type 内部带记忆的智能体配置 = 智能体选项 & Required<Omit<带记忆的智能体选项, keyof 智能体选项>>

export type 带记忆的解决问题选项<T extends z.ZodType> = 解决问题选项<T> & {
  禁用深度推演?: boolean | undefined
  标题?: string | undefined
  是否自动召回?: boolean | undefined
}

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
  目标表: 'node' | 'link'
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

export let 快照数据Schema = z.object({
  格式版本: z.literal(2),
  记忆列表: z.array(记忆表Schema),
  记忆关联列表: z.array(记忆关联表Schema),
  动态工具列表: z.array(动态工具表Schema),
})
export type 快照数据 = z.infer<typeof 快照数据Schema>

export let 完整状态Schema = z.object({
  格式版本: z.literal(2),
  会话标识: z.string().optional(),
  记忆快照: 快照数据Schema,
  消息历史: z.array(智能体消息Schema),
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
  获取向量: (内容: string) => Promise<获取向量结果>
  检查并降级一级记忆: () => Promise<void>
  检查并清理二级记忆: () => Promise<void>
  保存快照: () => Promise<string>
  执行记忆变更: <R>(消息: string, 操作: (上下文: 记忆操作上下文) => Promise<R>) => Promise<R>
  回调?: ((事件: 智能体事件) => Promise<void>) | undefined
}

export function 格式化为本地时间字符串(时间: Date): string {
  let 偏移分钟 = 时间.getTimezoneOffset()
  let 偏移毫秒 = 偏移分钟 * 60000
  let 本地时间 = new Date(时间.getTime() - 偏移毫秒)
  let iso部分 = 本地时间.toISOString().slice(0, -1)
  let 符号 = 偏移分钟 > 0 ? '-' : '+'
  let 绝对值偏移 = Math.abs(偏移分钟)
  let 偏移小时 = Math.floor(绝对值偏移 / 60)
    .toString()
    .padStart(2, '0')
  let 偏移分 = (绝对值偏移 % 60).toString().padStart(2, '0')
  return `${iso部分}${符号}${偏移小时}:${偏移分}`
}
