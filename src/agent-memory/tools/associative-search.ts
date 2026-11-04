import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { z } from 'zod'
import type { 智能体事件 } from '../../agent/types'
import { 智能体工具 } from '../../agent/types'
import { 读取技能线索映射, 读取记忆线索映射 } from '../storage/clue-storage'
import { 记忆等级, type 内部带记忆的智能体配置, type 记忆数据库 } from '../types'
import { 加载并校验技能 } from './skill-loader'

export type 联想检索上下文 = {
  配置: 内部带记忆的智能体配置
  数据库查询器: Kysely<记忆数据库>
  获取向量: (内容: string) => Promise<number[] | null>
  回调?: ((事件: 智能体事件) => Promise<void>) | undefined
}

let 内容Schema = z.array(z.string().trim().min(1)).min(1).describe('用于联想的一个或多个自然语言内容')
let 查询记忆参数Schema = z.object({
  内容: 内容Schema,
  完整记忆数量: z.number().int().min(0).max(50).optional().default(5),
  线索来源数量: z.number().int().min(0).max(100).optional().default(10),
})
let 查询技能参数Schema = z.object({
  内容: 内容Schema,
  完整技能数量: z.number().int().min(0).max(50).optional().default(5),
  线索来源数量: z.number().int().min(0).max(100).optional().default(10),
})
let 查询线索参数Schema = z.object({
  内容: 内容Schema,
  记忆数量: z.number().int().min(0).max(50).optional().default(5),
  技能数量: z.number().int().min(0).max(50).optional().default(5),
})

type 检索得分 = {
  记忆: Map<string, number>
  技能: Map<string, number>
  线索: Map<string, number>
}
type 记忆结果 = { id: string; 等级: 记忆等级; 评分: number; 内容: string; 线索: string[] }
type 技能结果 = {
  id: string
  名称: string
  描述: string
  线索: string[]
  参数Schema?: Record<string, unknown>
  返回值Schema?: Record<string, unknown>
}
type 查询记忆结果 = { 结果: '成功' | '失败'; 完整记忆?: 记忆结果[]; 闪现出的线索?: string[]; 错误信息?: string }
type 查询技能结果 = { 结果: '成功' | '失败'; 完整技能?: 技能结果[]; 闪现出的线索?: string[]; 错误信息?: string }
type 查询线索结果 = {
  结果: '成功' | '失败'
  匹配的线索?: string[]
  相关记忆?: 记忆结果[]
  相关技能?: 技能结果[]
  错误信息?: string
}

function 取较大值<K>(映射: Map<K, number>, 键: K, 值: number): void {
  if (值 > (映射.get(键) ?? Number.NEGATIVE_INFINITY)) 映射.set(键, 值)
}

export function 线索信息权重(实体总数: number, 使用次数: number): number {
  if (实体总数 <= 1) return 1
  let 有效使用次数 = Math.max(1, Math.min(实体总数, 使用次数))
  let 最大IDF = Math.log((实体总数 + 1) / 2)
  let 归一化IDF = Math.log((实体总数 + 1) / (有效使用次数 + 1)) / 最大IDF
  return 0.1 + 0.9 * Math.max(0, Math.min(1, 归一化IDF))
}

function 排序id(映射: Map<string, number>, 数量?: number): string[] {
  let 列表 = Array.from(映射.entries())
    .sort((左, 右) => 右[1] - 左[1])
    .map(([id]) => id)
  return 数量 === undefined ? 列表 : 列表.slice(0, 数量)
}

async function 计算检索得分(上下文: 联想检索上下文, 内容列表: string[], 候选数量: number): Promise<检索得分> {
  let { 配置, 数据库查询器, 获取向量 } = 上下文
  let 记忆数量 = Number(
    (
      await 数据库查询器
        .selectFrom('当前记忆表')
        .select(sql<number>`count(id)`.as('数量'))
        .executeTakeFirst()
    )?.数量 ?? 0,
  )
  let 技能数量 = Number(
    (
      await 数据库查询器
        .selectFrom('当前技能表')
        .select(sql<number>`count(id)`.as('数量'))
        .executeTakeFirst()
    )?.数量 ?? 0,
  )
  let 记忆使用 = await 数据库查询器
    .selectFrom('当前记忆线索关联表')
    .select(['线索id', sql<number>`count(记忆id)`.as('数量')])
    .groupBy('线索id')
    .execute()
  let 技能使用 = await 数据库查询器
    .selectFrom('当前技能线索关联表')
    .select(['线索id', sql<number>`count(技能id)`.as('数量')])
    .groupBy('线索id')
    .execute()
  let 使用次数 = new Map<string, number>()
  for (let 项 of [...记忆使用, ...技能使用]) 使用次数.set(项.线索id, (使用次数.get(项.线索id) ?? 0) + Number(项.数量))
  let 实体总数 = 记忆数量 + 技能数量
  let 记忆 = new Map<string, number>()
  let 技能 = new Map<string, number>()
  let 线索 = new Map<string, number>()
  let 直接记忆 = new Map<string, number>()
  let 直接技能 = new Map<string, number>()
  let 直接线索 = new Map<string, number>()
  let 阈值 = 配置.向量召回相似度阈值
  let 有查询向量 = false
  for (let 内容 of Array.from(new Set(内容列表))) {
    let 查询向量 = await 获取向量(内容)
    if (查询向量 === null) continue
    有查询向量 = true
    let 向量文本 = JSON.stringify(查询向量)
    let 维度 = 查询向量.length
    let 相似度 = sql<number>`1 - (向量 <=> ${向量文本}::vector)`
    let 记忆命中 = await 数据库查询器
      .selectFrom('当前记忆表')
      .select(['id', 相似度.as('相似度')])
      .where('等级', '=', 记忆等级.二级)
      .where('向量', 'is not', null)
      .where('向量维度', '=', 维度)
      .where(相似度, '>', 阈值)
      .orderBy(相似度, 'desc')
      .limit(候选数量)
      .execute()
    for (let 命中 of 记忆命中) {
      取较大值(直接记忆, 命中.id, 命中.相似度)
      取较大值(记忆, 命中.id, 命中.相似度)
    }
    let 技能命中 = await 数据库查询器
      .selectFrom('当前技能表')
      .select(['id', 相似度.as('相似度')])
      .where('向量', 'is not', null)
      .where('向量维度', '=', 维度)
      .where(相似度, '>', 阈值)
      .orderBy(相似度, 'desc')
      .limit(候选数量)
      .execute()
    for (let 命中 of 技能命中) {
      取较大值(直接技能, 命中.id, 命中.相似度)
      取较大值(技能, 命中.id, 命中.相似度)
    }
    let 线索命中 = await 数据库查询器
      .selectFrom('当前线索表')
      .select(['id', 相似度.as('相似度')])
      .where('向量', 'is not', null)
      .where('向量维度', '=', 维度)
      .where(相似度, '>', 阈值)
      .orderBy(相似度, 'desc')
      .limit(候选数量)
      .execute()
    for (let 命中 of 线索命中) {
      let 得分 = 命中.相似度 * 线索信息权重(实体总数, 使用次数.get(命中.id) ?? 0)
      取较大值(直接线索, 命中.id, 得分)
      取较大值(线索, 命中.id, 得分)
    }
    let 关联相似度 = sql<number>`1 - (关联.向量 <=> ${向量文本}::vector)`
    let 记忆关联 = await 数据库查询器
      .selectFrom('当前记忆线索关联表 as 关联')
      .innerJoin('当前记忆表 as 记忆', '记忆.id', '关联.记忆id')
      .select(['关联.记忆id', '关联.线索id', 关联相似度.as('相似度')])
      .where('记忆.等级', '=', 记忆等级.二级)
      .where('关联.向量', 'is not', null)
      .where('关联.向量维度', '=', 维度)
      .where(关联相似度, '>', 阈值)
      .orderBy(关联相似度, 'desc')
      .limit(候选数量)
      .execute()
    for (let 命中 of 记忆关联) {
      let 得分 = 命中.相似度 * Math.sqrt(线索信息权重(实体总数, 使用次数.get(命中.线索id) ?? 0))
      取较大值(记忆, 命中.记忆id, 得分)
      取较大值(线索, 命中.线索id, 得分)
    }
    let 技能关联 = await 数据库查询器
      .selectFrom('当前技能线索关联表 as 关联')
      .select(['关联.技能id', '关联.线索id', 关联相似度.as('相似度')])
      .where('关联.向量', 'is not', null)
      .where('关联.向量维度', '=', 维度)
      .where(关联相似度, '>', 阈值)
      .orderBy(关联相似度, 'desc')
      .limit(候选数量)
      .execute()
    for (let 命中 of 技能关联) {
      let 得分 = 命中.相似度 * Math.sqrt(线索信息权重(实体总数, 使用次数.get(命中.线索id) ?? 0))
      取较大值(技能, 命中.技能id, 得分)
      取较大值(线索, 命中.线索id, 得分)
    }
  }
  let 直接线索id = Array.from(直接线索.keys())
  if (直接线索id.length > 0) {
    let 记忆桥 = await 数据库查询器
      .selectFrom('当前记忆线索关联表 as 关联')
      .innerJoin('当前记忆表 as 记忆', '记忆.id', '关联.记忆id')
      .select(['关联.记忆id', '关联.线索id'])
      .where('记忆.等级', '=', 记忆等级.二级)
      .where('关联.线索id', 'in', 直接线索id)
      .execute()
    for (let 项 of 记忆桥)
      取较大值(记忆, 项.记忆id, (直接线索.get(项.线索id) ?? 0) * 线索信息权重(实体总数, 使用次数.get(项.线索id) ?? 0))
    let 技能桥 = await 数据库查询器
      .selectFrom('当前技能线索关联表')
      .select(['技能id', '线索id'])
      .where('线索id', 'in', 直接线索id)
      .execute()
    for (let 项 of 技能桥)
      取较大值(技能, 项.技能id, (直接线索.get(项.线索id) ?? 0) * 线索信息权重(实体总数, 使用次数.get(项.线索id) ?? 0))
  }
  if (直接记忆.size > 0) {
    let 关联 = await 数据库查询器
      .selectFrom('当前记忆线索关联表')
      .select(['记忆id', '线索id'])
      .where('记忆id', 'in', Array.from(直接记忆.keys()))
      .execute()
    for (let 项 of 关联)
      取较大值(线索, 项.线索id, (直接记忆.get(项.记忆id) ?? 0) * 线索信息权重(实体总数, 使用次数.get(项.线索id) ?? 0))
  }
  if (直接技能.size > 0) {
    let 关联 = await 数据库查询器
      .selectFrom('当前技能线索关联表')
      .select(['技能id', '线索id'])
      .where('技能id', 'in', Array.from(直接技能.keys()))
      .execute()
    for (let 项 of 关联)
      取较大值(线索, 项.线索id, (直接技能.get(项.技能id) ?? 0) * 线索信息权重(实体总数, 使用次数.get(项.线索id) ?? 0))
  }
  if (有查询向量 === false) throw new Error(配置.模型语言包.模型字段描述('未配置可用的向量模型，无法进行联想查询'))
  return { 记忆, 技能, 线索 }
}

async function 读取记忆结果(数据库查询器: Kysely<记忆数据库>, id列表: string[]): Promise<记忆结果[]> {
  if (id列表.length === 0) return []
  let 列表 = await 数据库查询器
    .selectFrom('当前记忆表')
    .select(['id', '等级', '评分', '内容'])
    .where('id', 'in', id列表)
    .execute()
  let 线索 = await 读取记忆线索映射(数据库查询器, id列表)
  列表.sort((左, 右) => id列表.indexOf(左.id) - id列表.indexOf(右.id))
  return 列表.map((记忆) => ({ ...记忆, 线索: 线索.get(记忆.id) ?? [] }))
}

async function 读取技能结果(上下文: 联想检索上下文, id列表: string[]): Promise<技能结果[]> {
  if (id列表.length === 0) return []
  let 列表 = await 上下文.数据库查询器
    .selectFrom('当前技能表')
    .select(['id', '名称', '描述', '代码'])
    .where('id', 'in', id列表)
    .execute()
  let 线索 = await 读取技能线索映射(上下文.数据库查询器, id列表)
  列表.sort((左, 右) => id列表.indexOf(左.id) - id列表.indexOf(右.id))
  let 结果 = []
  for (let 技能 of 列表) {
    let 加载结果 = await 加载并校验技能(技能.代码, 上下文.配置.模型语言包)
    结果.push({
      ...技能,
      代码: undefined,
      线索: 线索.get(技能.id) ?? [],
      ...(加载结果.成功 ? { 参数Schema: 加载结果.技能.参数Schema, 返回值Schema: 加载结果.技能.返回值Schema } : {}),
    })
  }
  return 结果
}

async function 读取来源线索(
  数据库查询器: Kysely<记忆数据库>,
  类型: '记忆' | '技能',
  来源id: string[],
): Promise<string[]> {
  if (来源id.length === 0) return []
  let 关联 =
    类型 === '记忆'
      ? await 数据库查询器
          .selectFrom('当前记忆线索关联表')
          .innerJoin('当前线索表', '当前线索表.id', '当前记忆线索关联表.线索id')
          .select(['当前记忆线索关联表.记忆id as 来源id', '当前线索表.内容'])
          .where('当前记忆线索关联表.记忆id', 'in', 来源id)
          .execute()
      : await 数据库查询器
          .selectFrom('当前技能线索关联表')
          .innerJoin('当前线索表', '当前线索表.id', '当前技能线索关联表.线索id')
          .select(['当前技能线索关联表.技能id as 来源id', '当前线索表.内容'])
          .where('当前技能线索关联表.技能id', 'in', 来源id)
          .execute()
  关联.sort((左, 右) => 来源id.indexOf(左.来源id) - 来源id.indexOf(右.来源id))
  return Array.from(new Set(关联.map((项) => 项.内容)))
}

async function 更新访问记录(数据库查询器: Kysely<记忆数据库>, id列表: string[]): Promise<void> {
  if (id列表.length === 0) return
  await 数据库查询器
    .updateTable('当前记忆表')
    .set({
      最后访问序号: sql<number>`(SELECT COALESCE(MAX(创建序号), 0) FROM 当前记忆表)`,
      访问次数: sql`访问次数 + 1`,
    })
    .where('id', 'in', id列表)
    .execute()
}

function 失败(错误: unknown): { 结果: '失败'; 错误信息: string } {
  return { 结果: '失败', 错误信息: 错误 instanceof Error ? 错误.message : String(错误) }
}

export function 查询记忆工具(上下文: 联想检索上下文): 智能体工具 {
  return 智能体工具.创建({
    名称: 'search_memories',
    描述: '',
    参数Schema: 查询记忆参数Schema,
    返回值Schema: z.object({
      结果: z.enum(['成功', '失败']),
      完整记忆: z
        .array(
          z.object({
            id: z.string(),
            等级: z.nativeEnum(记忆等级),
            评分: z.number(),
            内容: z.string(),
            线索: z.array(z.string()),
          }),
        )
        .optional(),
      闪现出的线索: z.array(z.string()).optional(),
      错误信息: z.string().optional(),
    }),
    实现: async (原参数): Promise<查询记忆结果> => {
      try {
        let 参数 = 查询记忆参数Schema.parse(原参数)
        let 得分 = await 计算检索得分(上下文, 参数.内容, Math.max(20, 参数.完整记忆数量, 参数.线索来源数量) * 4)
        let 全部id = 排序id(得分.记忆)
        let 完整id = 全部id.slice(0, 参数.完整记忆数量)
        let 来源id = 全部id.slice(0, 参数.线索来源数量)
        let 完整记忆 = await 读取记忆结果(上下文.数据库查询器, 完整id)
        let 闪现出的线索 = await 读取来源线索(上下文.数据库查询器, '记忆', 来源id)
        if (上下文.配置.只读模式 === false) await 更新访问记录(上下文.数据库查询器, 完整id)
        if (上下文.回调 !== undefined)
          await 上下文.回调({
            类型: '流程信息',
            内容: `[联想检索] 返回 ${String(完整记忆.length)} 条记忆与 ${String(闪现出的线索.length)} 条线索`,
          })
        return { 结果: '成功', 完整记忆, 闪现出的线索 }
      } catch (错误: unknown) {
        return 失败(错误)
      }
    },
  })
}

export function 查询技能工具(上下文: 联想检索上下文): 智能体工具 {
  return 智能体工具.创建({
    名称: 'search_skills',
    描述: '',
    参数Schema: 查询技能参数Schema,
    返回值Schema: z.object({
      结果: z.enum(['成功', '失败']),
      完整技能: z
        .array(
          z.object({
            id: z.string(),
            名称: z.string(),
            描述: z.string(),
            线索: z.array(z.string()),
            参数Schema: z.record(z.unknown()).optional(),
            返回值Schema: z.record(z.unknown()).optional(),
          }),
        )
        .optional(),
      闪现出的线索: z.array(z.string()).optional(),
      错误信息: z.string().optional(),
    }),
    实现: async (原参数): Promise<查询技能结果> => {
      try {
        let 参数 = 查询技能参数Schema.parse(原参数)
        let 得分 = await 计算检索得分(上下文, 参数.内容, Math.max(20, 参数.完整技能数量, 参数.线索来源数量) * 4)
        let 全部id = 排序id(得分.技能)
        let 完整技能 = await 读取技能结果(上下文, 全部id.slice(0, 参数.完整技能数量))
        let 闪现出的线索 = await 读取来源线索(上下文.数据库查询器, '技能', 全部id.slice(0, 参数.线索来源数量))
        return { 结果: '成功', 完整技能, 闪现出的线索 }
      } catch (错误: unknown) {
        return 失败(错误)
      }
    },
  })
}

export function 查询线索工具(上下文: 联想检索上下文): 智能体工具 {
  return 智能体工具.创建({
    名称: 'search_clues',
    描述: '',
    参数Schema: 查询线索参数Schema,
    返回值Schema: z.object({
      结果: z.enum(['成功', '失败']),
      匹配的线索: z.array(z.string()).optional(),
      相关记忆: z
        .array(
          z.object({
            id: z.string(),
            等级: z.nativeEnum(记忆等级),
            评分: z.number(),
            内容: z.string(),
            线索: z.array(z.string()),
          }),
        )
        .optional(),
      相关技能: z
        .array(
          z.object({
            id: z.string(),
            名称: z.string(),
            描述: z.string(),
            线索: z.array(z.string()),
            参数Schema: z.record(z.unknown()).optional(),
            返回值Schema: z.record(z.unknown()).optional(),
          }),
        )
        .optional(),
      错误信息: z.string().optional(),
    }),
    实现: async (原参数): Promise<查询线索结果> => {
      try {
        let 参数 = 查询线索参数Schema.parse(原参数)
        let 得分 = await 计算检索得分(上下文, 参数.内容, Math.max(20, 参数.记忆数量, 参数.技能数量) * 4)
        let 线索id = 排序id(得分.线索, Math.max(10, 参数.记忆数量 + 参数.技能数量))
        let 线索列表 =
          线索id.length === 0
            ? []
            : await 上下文.数据库查询器
                .selectFrom('当前线索表')
                .select(['id', '内容'])
                .where('id', 'in', 线索id)
                .execute()
        线索列表.sort((左, 右) => 线索id.indexOf(左.id) - 线索id.indexOf(右.id))
        let 记忆关联 =
          线索id.length === 0
            ? []
            : await 上下文.数据库查询器
                .selectFrom('当前记忆线索关联表 as 关联')
                .innerJoin('当前记忆表 as 记忆', '记忆.id', '关联.记忆id')
                .select('关联.记忆id')
                .where('记忆.等级', '=', 记忆等级.二级)
                .where('关联.线索id', 'in', 线索id)
                .execute()
        let 技能关联 =
          线索id.length === 0
            ? []
            : await 上下文.数据库查询器
                .selectFrom('当前技能线索关联表')
                .select('技能id')
                .where('线索id', 'in', 线索id)
                .execute()
        let 相关记忆候选 = new Set(记忆关联.map((关联) => 关联.记忆id))
        let 相关技能候选 = new Set(技能关联.map((关联) => 关联.技能id))
        let 相关记忆id = 排序id(得分.记忆)
          .filter((id) => 相关记忆候选.has(id))
          .slice(0, 参数.记忆数量)
        let 相关技能id = 排序id(得分.技能)
          .filter((id) => 相关技能候选.has(id))
          .slice(0, 参数.技能数量)
        let 相关记忆 = await 读取记忆结果(上下文.数据库查询器, 相关记忆id)
        let 相关技能 = await 读取技能结果(上下文, 相关技能id)
        if (上下文.配置.只读模式 === false) await 更新访问记录(上下文.数据库查询器, 相关记忆id)
        return { 结果: '成功', 匹配的线索: 线索列表.map((线索) => 线索.内容), 相关记忆, 相关技能 }
      } catch (错误: unknown) {
        return 失败(错误)
      }
    },
  })
}
