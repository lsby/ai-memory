import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { z } from 'zod'
import type { 智能体事件 } from '../../agent/types'
import { 智能体工具 } from '../../agent/types'
import { 读取记忆线索映射 } from '../storage/clue-storage'
import { 记忆等级, type 内部带记忆的智能体配置, type 记忆数据库 } from '../types'

type 联想检索上下文 = {
  配置: 内部带记忆的智能体配置
  数据库查询器: Kysely<记忆数据库>
  获取向量: (内容: string) => Promise<number[] | null>
  回调?: ((事件: 智能体事件) => Promise<void>) | undefined
}

let 回忆延伸参数Schema = z.object({
  内容: z.array(z.string().trim().min(1)).optional().default([]).describe('当前想到的一个或多个自然语言内容'),
  线索: z.array(z.string().trim().min(1)).optional().default([]).describe('当前想到的一个或多个自然语言线索'),
})

type 候选记忆得分 = { 直接: number; 关联: number; 线索桥接: number }
type 候选线索得分 = { 直接: number; 关联: number; 记忆桥接: number }

function 取较大值<K>(映射: Map<K, number>, 键: K, 值: number): void {
  if (值 > (映射.get(键) ?? Number.NEGATIVE_INFINITY)) 映射.set(键, 值)
}

export function 线索信息权重(记忆总数: number, 使用次数: number): number {
  if (记忆总数 <= 1) return 1
  let 有效使用次数 = Math.max(1, Math.min(记忆总数, 使用次数))
  let 最大IDF = Math.log((记忆总数 + 1) / 2)
  let 归一化IDF = Math.log((记忆总数 + 1) / (有效使用次数 + 1)) / 最大IDF
  return 0.1 + 0.9 * Math.max(0, Math.min(1, 归一化IDF))
}

function 最强路径得分(...得分列表: number[]): number {
  return Math.max(...得分列表)
}

export function 回忆延伸工具(上下文: 联想检索上下文): 智能体工具 {
  let { 配置, 数据库查询器, 获取向量, 回调 } = 上下文
  return 智能体工具.创建({
    名称: 'extend_memory',
    描述: '',
    参数Schema: 回忆延伸参数Schema,
    返回值Schema: z.object({
      结果: z.enum(['成功', '失败']),
      直接联想到的记忆: z
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
    实现: async (原参数: {
      内容: string[]
      线索: string[]
    }): Promise<{
      结果: '成功' | '失败'
      直接联想到的记忆?: Array<{ id: string; 等级: 记忆等级; 评分: number; 内容: string; 线索: string[] }>
      闪现出的线索?: string[]
      错误信息?: string
    }> => {
      try {
        let 参数 = 回忆延伸参数Schema.parse(原参数)
        if (参数.内容.length === 0 && 参数.线索.length === 0) {
          throw new Error(配置.模型语言包.模型字段描述('内容和线索至少提供一项'))
        }
        let 查询文本列表 = Array.from(new Set([...参数.内容, ...参数.线索]))
        let 查询向量列表: number[][] = []
        for (let 查询文本 of 查询文本列表) {
          let 向量 = await 获取向量(查询文本)
          if (向量 !== null) 查询向量列表.push(向量)
        }
        if (查询向量列表.length === 0) {
          throw new Error(配置.模型语言包.模型字段描述('未配置可用的向量模型，无法联想记忆'))
        }

        let 记忆数量结果 = await 数据库查询器
          .selectFrom('当前记忆表')
          .select(sql<number>`count(id)`.as('数量'))
          .executeTakeFirst()
        let 记忆总数 = Number(记忆数量结果?.数量 ?? 0)
        let 线索使用次数结果 = await 数据库查询器
          .selectFrom('当前记忆线索关联表')
          .select(['线索id', sql<number>`count(记忆id)`.as('数量')])
          .groupBy('线索id')
          .execute()
        let 线索使用次数 = new Map(线索使用次数结果.map((项) => [项.线索id, Number(项.数量)]))

        let 直接记忆得分 = new Map<string, number>()
        let 直接线索得分 = new Map<string, number>()
        let 关联记忆得分 = new Map<string, number>()
        let 关联线索得分 = new Map<string, number>()
        let 阈值 = 配置.向量召回相似度阈值
        let 候选数量 = Math.max(配置.自动检索关联数量, 配置.自动检索线索数量, 配置.自动检索二级记忆数量) * 4

        for (let 查询向量 of 查询向量列表) {
          let 向量文本 = JSON.stringify(查询向量)
          let 维度 = 查询向量.length
          let 记忆相似度 = sql<number>`1 - (向量 <=> ${向量文本}::vector)`
          let 记忆命中 = await 数据库查询器
            .selectFrom('当前记忆表')
            .select(['id', 记忆相似度.as('相似度')])
            .where('等级', '=', 记忆等级.二级)
            .where('向量', 'is not', null)
            .where('向量维度', '=', 维度)
            .where(记忆相似度, '>', 阈值)
            .orderBy(记忆相似度, 'desc')
            .limit(候选数量)
            .execute()
          for (let 命中 of 记忆命中) 取较大值(直接记忆得分, 命中.id, 命中.相似度)

          let 线索相似度 = sql<number>`1 - (向量 <=> ${向量文本}::vector)`
          let 线索命中 = await 数据库查询器
            .selectFrom('当前线索表')
            .select(['id', 线索相似度.as('相似度')])
            .where('向量', 'is not', null)
            .where('向量维度', '=', 维度)
            .where(线索相似度, '>', 阈值)
            .orderBy(线索相似度, 'desc')
            .limit(候选数量)
            .execute()
          for (let 命中 of 线索命中) {
            let 权重 = 线索信息权重(记忆总数, 线索使用次数.get(命中.id) ?? 0)
            取较大值(直接线索得分, 命中.id, 命中.相似度 * 权重)
          }

          let 关联相似度 = sql<number>`1 - (关联.向量 <=> ${向量文本}::vector)`
          let 关联命中 = await 数据库查询器
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
          for (let 命中 of 关联命中) {
            let 权重 = Math.sqrt(线索信息权重(记忆总数, 线索使用次数.get(命中.线索id) ?? 0))
            let 得分 = 命中.相似度 * 权重
            取较大值(关联记忆得分, 命中.记忆id, 得分)
            取较大值(关联线索得分, 命中.线索id, 得分)
          }
        }

        for (let 输入线索 of 参数.线索) {
          let 精确线索 = await 数据库查询器
            .selectFrom('当前线索表')
            .select('id')
            .where('内容', '=', 输入线索)
            .executeTakeFirst()
          if (精确线索 !== undefined) 取较大值(直接线索得分, 精确线索.id, 1)
        }

        let 记忆桥接得分 = new Map<string, number>()
        if (直接线索得分.size > 0) {
          let 关联 = await 数据库查询器
            .selectFrom('当前记忆线索关联表 as 关联')
            .innerJoin('当前记忆表 as 记忆', '记忆.id', '关联.记忆id')
            .select(['关联.记忆id', '关联.线索id'])
            .where('记忆.等级', '=', 记忆等级.二级)
            .where('关联.线索id', 'in', Array.from(直接线索得分.keys()))
            .execute()
          for (let 项 of 关联) {
            let 权重 = 线索信息权重(记忆总数, 线索使用次数.get(项.线索id) ?? 0)
            取较大值(记忆桥接得分, 项.记忆id, (直接线索得分.get(项.线索id) ?? 0) * 权重)
          }
        }

        let 线索桥接得分 = new Map<string, number>()
        if (直接记忆得分.size > 0) {
          let 关联 = await 数据库查询器
            .selectFrom('当前记忆线索关联表')
            .select(['记忆id', '线索id'])
            .where('记忆id', 'in', Array.from(直接记忆得分.keys()))
            .execute()
          for (let 项 of 关联) {
            let 权重 = 线索信息权重(记忆总数, 线索使用次数.get(项.线索id) ?? 0)
            取较大值(线索桥接得分, 项.线索id, (直接记忆得分.get(项.记忆id) ?? 0) * 权重)
          }
        }

        let 记忆候选 = new Map<string, 候选记忆得分>()
        for (let id of new Set([...直接记忆得分.keys(), ...关联记忆得分.keys(), ...记忆桥接得分.keys()])) {
          记忆候选.set(id, {
            直接: 直接记忆得分.get(id) ?? 0,
            关联: 关联记忆得分.get(id) ?? 0,
            线索桥接: 记忆桥接得分.get(id) ?? 0,
          })
        }
        let 排序记忆id = Array.from(记忆候选.entries())
          .sort(
            (左, 右) =>
              最强路径得分(右[1].直接, 右[1].关联, 右[1].线索桥接) -
              最强路径得分(左[1].直接, 左[1].关联, 左[1].线索桥接),
          )
          .slice(0, 配置.自动检索二级记忆数量)
          .map(([id]) => id)

        let 线索候选 = new Map<string, 候选线索得分>()
        for (let id of new Set([...直接线索得分.keys(), ...关联线索得分.keys(), ...线索桥接得分.keys()])) {
          线索候选.set(id, {
            直接: 直接线索得分.get(id) ?? 0,
            关联: 关联线索得分.get(id) ?? 0,
            记忆桥接: 线索桥接得分.get(id) ?? 0,
          })
        }
        let 排序线索id = Array.from(线索候选.entries())
          .sort(
            (左, 右) =>
              最强路径得分(右[1].直接, 右[1].关联, 右[1].记忆桥接) -
              最强路径得分(左[1].直接, 左[1].关联, 左[1].记忆桥接),
          )
          .slice(0, 配置.自动检索线索数量)
          .map(([id]) => id)

        let 记忆列表 =
          排序记忆id.length === 0
            ? []
            : await 数据库查询器.selectFrom('当前记忆表').selectAll().where('id', 'in', 排序记忆id).execute()
        记忆列表.sort((左, 右) => 排序记忆id.indexOf(左.id) - 排序记忆id.indexOf(右.id))
        let 线索映射 = await 读取记忆线索映射(数据库查询器, 排序记忆id)
        let 线索列表 =
          排序线索id.length === 0
            ? []
            : await 数据库查询器.selectFrom('当前线索表').select(['id', '内容']).where('id', 'in', 排序线索id).execute()
        线索列表.sort((左, 右) => 排序线索id.indexOf(左.id) - 排序线索id.indexOf(右.id))

        if (排序记忆id.length > 0) {
          await 数据库查询器
            .updateTable('当前记忆表')
            .set({
              最后访问序号: sql<number>`(SELECT COALESCE(MAX(创建序号), 0) FROM 当前记忆表)`,
              访问次数: sql`访问次数 + 1`,
            })
            .where('id', 'in', 排序记忆id)
            .execute()
        }
        if (回调 !== undefined) {
          await 回调({
            类型: '流程信息',
            内容: `[联想检索] 返回 ${String(记忆列表.length)} 条记忆与 ${String(线索列表.length)} 条线索`,
          })
        }
        return {
          结果: '成功',
          直接联想到的记忆: 记忆列表.map((记忆) => ({
            id: 记忆.id,
            等级: 记忆.等级,
            评分: 记忆.评分,
            内容: 记忆.内容,
            线索: 线索映射.get(记忆.id) ?? [],
          })),
          闪现出的线索: 线索列表.map((线索) => 线索.内容),
        }
      } catch (错误: unknown) {
        return { 结果: '失败', 错误信息: 错误 instanceof Error ? 错误.message : String(错误) }
      }
    },
  })
}
