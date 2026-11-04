import { Kysely, sql } from 'kysely'
import { z } from 'zod'
import { 智能体事件, 智能体工具 } from '../../agent/types'
import { 读取当前会话谱系消息 } from '../operations/conversation-lineage'
import { 查询记忆新增相关消息, type 记忆相关消息 } from '../operations/memory-message-origin'
import {
  时间范围Schema,
  符合过滤内容模式,
  解析时间范围,
  过滤内容模式Schema,
  type 过滤内容模式,
} from '../operations/search-parameters'
import { 内部带记忆的智能体配置, 当前记忆表, 格式化为本地时间字符串, 记忆数据库 } from '../types'
import { 获取混合关联排序 } from './common'

let 记忆过滤内容Schema = z
  .object({
    时间范围: 时间范围Schema.optional(),
    关键词过滤: z.array(z.string().trim().min(1)).describe('逐项精确匹配记忆表的关键词数组').optional(),
    标签过滤: z.array(z.string().trim().min(1)).describe('逐项精确匹配记忆表的标签数组').optional(),
    内容过滤正则表达式: z.string().max(1000).describe('只对记忆表的内容字段执行正则过滤').optional(),
  })
  .strict()
  .describe('对向量检索结果施加的精确过滤条件')
  .optional()
type 记忆过滤内容 = z.infer<typeof 记忆过滤内容Schema>

type 图谱检索上下文 = {
  配置: 内部带记忆的智能体配置
  数据库查询器: Kysely<记忆数据库>
  获取向量: (内容: string) => Promise<number[] | null>
  当前会话id?: string | undefined
  读取当前会话id: () => string | null
  回调?: ((事件: 智能体事件) => Promise<void>) | undefined
  检索策略?: { 发散起点数: number; 直接返回数: number; 最大扩展跳数: number; 最小关联阈值: number } | undefined
}

function 记忆符合过滤内容(
  记忆: 当前记忆表,
  过滤内容: 记忆过滤内容,
  过滤内容模式: 过滤内容模式,
  开始时间: Date | null,
  结束时间: Date | null,
  内容过滤正则表达式: RegExp | null,
): boolean {
  if (过滤内容 === undefined) return true
  let 条件列表: boolean[] = []
  for (let 关键词 of 过滤内容.关键词过滤 ?? []) 条件列表.push(记忆.关键词.includes(关键词))
  for (let 标签 of 过滤内容.标签过滤 ?? []) 条件列表.push(记忆.标签.includes(标签))
  if (内容过滤正则表达式 !== null) 条件列表.push(内容过滤正则表达式.test(记忆.内容))
  if (开始时间 !== null || 结束时间 !== null) {
    条件列表.push((开始时间 === null || 记忆.创建时间 >= 开始时间) && (结束时间 === null || 记忆.创建时间 < 结束时间))
  }
  return 符合过滤内容模式(条件列表, 过滤内容模式)
}

export function 回忆延伸工具(上下文: 图谱检索上下文): 智能体工具 {
  let { 配置, 数据库查询器, 获取向量, 当前会话id, 读取当前会话id, 回调 } = 上下文
  let 检索策略 = 上下文.检索策略 ?? {
    发散起点数: 5,
    直接返回数: 3,
    最大扩展跳数: 1,
    最小关联阈值: 配置.向量相似度关联阈值,
  }

  return 智能体工具.创建({
    名称: 'extend_memory',
    描述: '',
    参数Schema: z.object({
      查询内容: z.string().trim().min(1).describe('必填的自然语言查询，仅用于生成查询向量并按语义相似度召回记忆'),
      过滤内容: 记忆过滤内容Schema,
      过滤内容模式: 过滤内容模式Schema,
    }),
    返回值Schema: z.object({
      结果: z.enum(['成功', '失败']),
      搜索结果_完整记忆: z.string().optional(),
      搜索结果_发散关键词: z.string().optional(),
      错误信息: z.string().optional(),
    }),
    实现: async (参数: {
      查询内容: string
      过滤内容?: 记忆过滤内容
      过滤内容模式: 过滤内容模式
    }): Promise<{
      结果: '成功' | '失败'
      搜索结果_完整记忆?: string
      搜索结果_发散关键词?: string
      错误信息?: string
    }> => {
      try {
        let 向量 = await 获取向量(参数.查询内容)
        if (向量 === null) throw new Error('未配置可用的向量模型，无法按查询内容搜索记忆')
        let { 开始时间, 结束时间 } = 解析时间范围(参数.过滤内容?.时间范围)
        let 内容过滤正则表达式 =
          参数.过滤内容?.内容过滤正则表达式 === undefined ? null : new RegExp(参数.过滤内容.内容过滤正则表达式, 'u')

        let 匹配排序结果 = await 获取混合关联排序(数据库查询器, {
          查询关键词: [],
          查询向量: 向量,
          向量阈值: 配置.向量相似度关联阈值,
        })
        let 候选记忆 =
          匹配排序结果.length === 0
            ? []
            : await 数据库查询器
                .selectFrom('当前记忆表')
                .selectAll()
                .where(
                  'id',
                  'in',
                  匹配排序结果.map((项) => 项.id),
                )
                .execute()
        let 候选记忆映射 = new Map(候选记忆.map((记忆) => [记忆.id, 记忆]))
        匹配排序结果 = 匹配排序结果.filter((项): boolean => {
          let 记忆 = 候选记忆映射.get(项.id)
          return (
            记忆 !== undefined &&
            记忆符合过滤内容(记忆, 参数.过滤内容, 参数.过滤内容模式, 开始时间, 结束时间, 内容过滤正则表达式)
          )
        })

        let 起点ID列表 = 匹配排序结果.slice(0, 检索策略.发散起点数).map((x) => x.id)
        let 直接返回ID列表 = 匹配排序结果.slice(0, 检索策略.直接返回数).map((x) => x.id)

        let 度量映射 = new Map<string, string>()
        for (let 项 of 匹配排序结果) {
          let 度量文本 = `${配置.模型语言包.模型字段名('综合')}:${项.综合得分.toFixed(2)}`
          if (项.重叠度 !== undefined) 度量文本 += `|${配置.模型语言包.模型字段名('重叠')}:${项.重叠度}`
          if (项.相似度 !== undefined)
            度量文本 += `|${配置.模型语言包.模型字段名('相似')}:${(项.相似度 * 100).toFixed(1)}%`
          度量映射.set(项.id, 度量文本)
        }

        if (回调 !== undefined) {
          let 最大长度 = 20
          let 格式化查询内容 = 参数.查询内容.replace(/[\r\n]+/g, ' ')
          if (格式化查询内容.length > 最大长度) {
            格式化查询内容 = 格式化查询内容.slice(0, 最大长度) + '...'
          }
          await 回调({
            类型: '流程信息',
            内容: `[回忆检索] 针对查询 "${格式化查询内容}"，从记忆库中初步检索并排序了 ${匹配排序结果.length} 条记录。`,
          })
        }

        let 直接返回的记忆集合 = new Set<string>(直接返回ID列表)
        let 扩展标签记忆集合 = new Set<string>()

        // 广度优先图遍历
        if (起点ID列表.length > 0 && 检索策略.最大扩展跳数 > 0) {
          let 当前层 = [...起点ID列表]
          let 已访问 = new Set<string>(当前层)

          if (回调 !== undefined) {
            let 起点记忆 = await 数据库查询器
              .selectFrom('当前记忆表')
              .selectAll()
              .where('id', 'in', 起点ID列表)
              .execute()
            起点记忆.sort((a, b) => 起点ID列表.indexOf(a.id) - 起点ID列表.indexOf(b.id))
            let 起点详情 = 起点记忆
              .map((项): string => {
                let 简短内容 = 项.内容.length > 20 ? 项.内容.slice(0, 20) + '...' : 项.内容
                let 等级 = 项.等级 === '零级' ? 'L0' : 项.等级 === '一级' ? 'L1' : 'L2'
                let 标签文本 = 项.标签.length > 0 ? `[${项.标签.join('][')}] ` : ''
                let 度量 = 度量映射.get(项.id) ?? ''
                return `ID[${项.id.slice(0, 8)}](${等级})${度量 !== '' ? `[${度量}]` : ''}: ${标签文本}${简短内容}`
              })
              .join('; ')

            await 回调({
              类型: '流程信息',
              内容: `[图谱延伸] 选取前 ${String(当前层.length)} 条最相关的记忆作为发散起点: { ${起点详情} }，准备以关联度阈值 >= ${String(检索策略.最小关联阈值)} 挖掘周边 ${String(检索策略.最大扩展跳数)} 跳的联想网络。`,
            })
          }

          for (let d = 0; d < 检索策略.最大扩展跳数; d++) {
            if (当前层.length === 0) break
            let 关联结果 = await 数据库查询器
              .selectFrom('当前记忆关联表')
              .select(['起点id', '终点id'])
              .where((eb) => eb.or([eb('起点id', 'in', 当前层), eb('终点id', 'in', 当前层)]))
              .where('关联度', '>=', 检索策略.最小关联阈值)
              .execute()

            let 当前层集合 = new Set(当前层)
            let 下一层 = new Set<string>()
            for (let 边 of 关联结果) {
              let 对面id = 当前层集合.has(边.起点id) ? 边.终点id : 边.起点id
              if (已访问.has(对面id) === false) {
                下一层.add(对面id)
                已访问.add(对面id)
                扩展标签记忆集合.add(对面id)
              }
            }

            if (回调 !== undefined && 下一层.size > 0) {
              let 下一层列表 = Array.from(下一层)
              let 下一层记忆 = await 数据库查询器
                .selectFrom('当前记忆表')
                .selectAll()
                .where('id', 'in', 下一层列表)
                .execute()
              let 下一层详情 = 下一层记忆
                .map((项): string => {
                  let 简短内容 = 项.内容.length > 20 ? 项.内容.slice(0, 20) + '...' : 项.内容
                  let 等级 = 项.等级 === '零级' ? 'L0' : 项.等级 === '一级' ? 'L1' : 'L2'
                  let 标签文本 = 项.标签.length > 0 ? `[${项.标签.join('][')}] ` : ''
                  return `ID[${项.id.slice(0, 8)}](${等级}): ${标签文本}${简短内容} (关键词: ${项.关键词.join(', ')})`
                })
                .join('; ')

              await 回调({
                类型: '流程信息',
                内容: `[图谱延伸] 第 ${String(d + 1)} 跳挖掘: 发现了 ${String(下一层.size)} 条潜在关联记忆: { ${下一层详情} }`,
              })
            }

            当前层 = Array.from(下一层)
          }
        }

        let 所有涉及ID = Array.from(new Set([...直接返回的记忆集合, ...扩展标签记忆集合]))

        let 最终记忆: 当前记忆表[] = []
        if (所有涉及ID.length > 0) {
          最终记忆 = await 数据库查询器.selectFrom('当前记忆表').selectAll().where('id', 'in', 所有涉及ID).execute()
        }

        let 最终直接内容: 当前记忆表[] = []
        let 最终扩展标签 = new Set<string>()

        for (let 记忆 of 最终记忆) {
          if (
            记忆符合过滤内容(记忆, 参数.过滤内容, 参数.过滤内容模式, 开始时间, 结束时间, 内容过滤正则表达式) === false
          )
            continue

          if (直接返回的记忆集合.has(记忆.id)) {
            最终直接内容.push(记忆)
          }
          if (扩展标签记忆集合.has(记忆.id)) {
            for (let k of 记忆.关键词) 最终扩展标签.add(k)
          }
        }

        if (回调 !== undefined) {
          最终直接内容.sort((a, b) => 直接返回ID列表.indexOf(a.id) - 直接返回ID列表.indexOf(b.id))
          let 直接命中详情 = 最终直接内容
            .map((项): string => {
              let 简短内容 = 项.内容.length > 20 ? 项.内容.slice(0, 20) + '...' : 项.内容
              let 等级 = 项.等级 === '零级' ? 'L0' : 项.等级 === '一级' ? 'L1' : 'L2'
              let 标签文本 = 项.标签.length > 0 ? `[${项.标签.join('][')}] ` : ''
              let 度量 = 度量映射.get(项.id) ?? ''
              return `ID[${项.id.slice(0, 8)}](${等级})${度量 !== '' ? `[${度量}]` : ''}: ${标签文本}${简短内容}`
            })
            .join('; ')
          let 发散的关键词 = Array.from(最终扩展标签).join(', ')

          await 回调({
            类型: '流程信息',
            内容: `[总结返回] 图谱延伸检索结束。直接给大模型返回了 ${String(最终直接内容.length)} 条最相关的完整记录: { ${直接命中详情} }。同时通过图谱联想，为大模型提供了 ${String(最终扩展标签.size)} 个发散关键词灵感: [${发散的关键词}]。`,
          })
        }

        let 命中的IDs = 最终直接内容.map((x) => x.id)
        if (命中的IDs.length > 0) {
          await 数据库查询器
            .updateTable('当前记忆表')
            .set({
              最后访问序号: sql<number>`(SELECT COALESCE(MAX(创建序号), 0) FROM 当前记忆表)`,
              访问次数: sql`访问次数 + 1`,
            })
            .where('id', 'in', 命中的IDs)
            .execute()
        }

        let 相关消息映射 = new Map<string, 记忆相关消息[]>()
        let 实际当前会话id = 当前会话id ?? 读取当前会话id() ?? undefined
        if (配置.博闻强记模式 === true && 实际当前会话id !== undefined) {
          let 谱系消息 = await 读取当前会话谱系消息(数据库查询器, 实际当前会话id)
          let 允许消息id = new Set(谱系消息.map((消息) => 消息.id))
          for (let 记忆 of 最终直接内容) {
            相关消息映射.set(记忆.id, await 查询记忆新增相关消息(数据库查询器, 记忆.id, 允许消息id))
          }
        }

        return {
          结果: '成功',
          搜索结果_完整记忆: JSON.stringify(
            最终直接内容.map((m) => {
              let 相关度 = 度量映射.get(m.id)
              return {
                id: m.id,
                [配置.模型语言包.模型字段名('等级')]: 配置.模型语言包.模型枚举值(m.等级),
                [配置.模型语言包.模型字段名('评分')]: m.评分,
                [配置.模型语言包.模型字段名('内容')]: m.内容,
                [配置.模型语言包.模型字段名('关键词')]: m.关键词,
                [配置.模型语言包.模型字段名('标签')]: m.标签,
                [配置.模型语言包.模型字段名('相关度')]: 相关度 ?? 配置.模型语言包.模型枚举值('未知'),
                [配置.模型语言包.模型字段名('创建时间')]: 格式化为本地时间字符串(m.创建时间, 配置.时区),
                ...(配置.博闻强记模式 === true
                  ? {
                      [配置.模型语言包.模型字段名('相关消息')]: (相关消息映射.get(m.id) ?? []).map((相关消息) => ({
                        [配置.模型语言包.模型字段名('消息id')]: 相关消息.消息id,
                        [配置.模型语言包.模型字段名('关系')]: 配置.模型语言包.模型枚举值(相关消息.关系),
                        [配置.模型语言包.模型字段名('记忆提交id')]: 相关消息.记忆提交id,
                      })),
                    }
                  : {}),
              }
            }),
          ),
          搜索结果_发散关键词: JSON.stringify(Array.from(最终扩展标签)),
        }
      } catch (error: unknown) {
        return { 结果: '失败', 错误信息: String(error instanceof Error ? error.message : error) }
      }
    },
  })
}
