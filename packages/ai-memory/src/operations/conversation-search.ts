import type { Kysely } from 'kysely'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { 公开消息, 记忆数据库 } from '../types'
import { 读取当前会话谱系消息 } from './conversation-lineage'
import { 查询记忆新增相关消息 } from './memory-message-origin'
import { 时间范围Schema, 符合过滤内容模式, 解析时间范围, 过滤内容模式Schema } from './search-parameters'

let 对话过滤内容Schema = z
  .object({
    会话id: z.string().trim().min(1).describe('限定当前会话谱系中的某个会话').optional(),
    消息id: z.string().trim().min(1).describe('精确限定一条消息').optional(),
    记忆id: z.string().trim().min(1).describe('限定与某条记忆创建过程相关的消息').optional(),
    角色: z
      .enum(['system', 'developer', 'user', 'assistant', 'tool', 'function'])
      .describe('按消息角色过滤')
      .optional(),
    时间范围: 时间范围Schema.optional(),
    内容过滤正则表达式: z.string().max(1000).describe('只对消息的文本内容执行正则过滤').optional(),
  })
  .strict()
  .describe('对向量检索结果施加的精确过滤条件')
  .optional()

export let 对话搜索参数Schema = z.object({
  查询内容: z.string().trim().min(1).describe('必填的自然语言查询，用于生成查询向量并按语义相似度召回消息'),
  过滤内容: 对话过滤内容Schema,
  过滤内容模式: 过滤内容模式Schema,
  上下文消息数: z
    .number()
    .int()
    .min(0)
    .max(50)
    .default(5)
    .describe('为每条命中消息附带谱系顺序中前后各多少条消息，默认5'),
})
export type 对话搜索参数 = z.infer<typeof 对话搜索参数Schema>
export let 对话搜索参数JSONSchema = zodToJsonSchema(对话搜索参数Schema) as Record<string, unknown>

type 对话搜索结果 = {
  结果: '成功' | '失败'
  错误信息?: string
  消息列表?: Array<{ id: string; 会话id: string; 角色: string; 内容: string | null; 创建时间: string }>
}

function 读取向量(消息: 公开消息): number[] | null {
  if (消息.向量 === null) return null
  if (Array.isArray(消息.向量)) return 消息.向量
  let 值: unknown = JSON.parse(消息.向量)
  return Array.isArray(值) && 值.every((项) => typeof 项 === 'number') ? 值 : null
}

function 计算余弦相似度(左: number[], 右: number[]): number | null {
  if (左.length === 0 || 左.length !== 右.length) return null
  let 点积 = 0
  let 左平方和 = 0
  let 右平方和 = 0
  for (let 索引 = 0; 索引 < 左.length; 索引++) {
    let 左值 = 左[索引]
    let 右值 = 右[索引]
    if (左值 === undefined || 右值 === undefined) return null
    点积 += 左值 * 右值
    左平方和 += 左值 * 左值
    右平方和 += 右值 * 右值
  }
  if (左平方和 === 0 || 右平方和 === 0) return null
  return 点积 / Math.sqrt(左平方和 * 右平方和)
}

function 读取消息内容(消息: 公开消息): string {
  let 内容值 = 'content' in 消息.消息 ? 消息.消息.content : null
  return typeof 内容值 === 'string' ? 内容值 : JSON.stringify(消息.消息)
}

export async function 搜索谱系消息(
  数据库查询器: Kysely<记忆数据库>,
  当前会话id: string | null,
  参数: 对话搜索参数,
  最大结果数: number,
  获取查询向量: (查询内容: string) => Promise<number[] | null>,
  无当前会话错误: string,
): Promise<对话搜索结果> {
  if (当前会话id === null) return { 结果: '失败', 错误信息: 无当前会话错误 }
  try {
    let 查询向量 = await 获取查询向量(参数.查询内容)
    if (查询向量 === null) throw new Error('未配置可用的向量模型，无法按查询内容搜索对话')
    let 谱系消息 = await 读取当前会话谱系消息(数据库查询器, 当前会话id)
    let 允许消息id = new Set(谱系消息.map((消息) => 消息.id))
    let 记忆相关消息id: ReadonlySet<string> | undefined = undefined
    if (参数.过滤内容?.记忆id !== undefined) {
      let 关系 = await 查询记忆新增相关消息(数据库查询器, 参数.过滤内容.记忆id, 允许消息id)
      记忆相关消息id = new Set(关系.map((项) => 项.消息id))
    }
    let 内容过滤正则表达式 =
      参数.过滤内容?.内容过滤正则表达式 === undefined ? null : new RegExp(参数.过滤内容.内容过滤正则表达式, 'u')
    let { 开始时间, 结束时间 } = 解析时间范围(参数.过滤内容?.时间范围)
    let 匹配列表: Array<{ 消息: 公开消息; 相似度: number }> = []
    for (let 消息 of 谱系消息) {
      let 内容 = 读取消息内容(消息)
      let 条件列表: boolean[] = []
      if (参数.过滤内容?.会话id !== undefined) 条件列表.push(消息.会话id === 参数.过滤内容.会话id)
      if (参数.过滤内容?.消息id !== undefined) 条件列表.push(消息.id === 参数.过滤内容.消息id)
      if (记忆相关消息id !== undefined) 条件列表.push(记忆相关消息id.has(消息.id))
      if (参数.过滤内容?.角色 !== undefined) 条件列表.push(消息.消息.role === 参数.过滤内容.角色)
      if (内容过滤正则表达式 !== null) 条件列表.push(内容过滤正则表达式.test(内容))
      if (开始时间 !== null || 结束时间 !== null) {
        条件列表.push(
          (开始时间 === null || 消息.创建时间 >= 开始时间) && (结束时间 === null || 消息.创建时间 < 结束时间),
        )
      }
      if (符合过滤内容模式(条件列表, 参数.过滤内容模式) === false) continue
      let 消息向量 = 读取向量(消息)
      let 相似度 = 消息向量 === null ? null : 计算余弦相似度(查询向量, 消息向量)
      if (相似度 !== null) 匹配列表.push({ 消息, 相似度 })
    }
    匹配列表.sort((a, b): number => {
      let 相似度差 = b.相似度 - a.相似度
      return 相似度差 !== 0 ? 相似度差 : b.消息.序号 - a.消息.序号
    })
    let 命中列表 = 匹配列表.slice(0, 最大结果数).map((项) => 项.消息)
    let 返回列表 = 命中列表
    if (参数.上下文消息数 > 0) {
      let 命中id = new Set(命中列表.map((消息) => 消息.id))
      let 返回索引 = new Set<number>()
      for (let 索引 = 0; 索引 < 谱系消息.length; 索引++) {
        let 消息 = 谱系消息[索引]
        if (消息 === undefined || 命中id.has(消息.id) === false) continue
        let 起点 = Math.max(0, 索引 - 参数.上下文消息数)
        let 终点 = Math.min(谱系消息.length - 1, 索引 + 参数.上下文消息数)
        for (let 上下文索引 = 起点; 上下文索引 <= 终点; 上下文索引++) 返回索引.add(上下文索引)
      }
      返回列表 = 谱系消息.filter((_消息, 索引) => 返回索引.has(索引))
    }
    return {
      结果: '成功',
      消息列表: 返回列表.map((消息) => {
        let 内容值 = 'content' in 消息.消息 ? 消息.消息.content : null
        return {
          id: 消息.id,
          会话id: 消息.会话id,
          角色: 消息.消息.role,
          内容: typeof 内容值 === 'string' ? 内容值 : null,
          创建时间: 消息.创建时间.toISOString(),
        }
      }),
    }
  } catch (错误) {
    return { 结果: '失败', 错误信息: 错误 instanceof Error ? 错误.message : String(错误) }
  }
}
