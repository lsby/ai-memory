import { Kysely, sql } from 'kysely'
import { z } from 'zod'
import { 智能体事件, 智能体工具 } from '../../agent/types'
import { 内部带记忆的智能体配置, 格式化为本地时间字符串, 记忆数据库, 记忆表 } from '../agent-memory-types'
import { 获取混合关联排序 } from './common'

type 图谱检索上下文 = {
  配置: 内部带记忆的智能体配置
  数据库查询器: Kysely<记忆数据库>
  获取向量: (内容: string) => Promise<number[] | null>
  回调?: ((事件: 智能体事件) => Promise<void>) | undefined
}

export function 回忆延伸工具(上下文: 图谱检索上下文): 智能体工具 {
  let { 配置, 数据库查询器, 获取向量, 回调 } = 上下文

  return 智能体工具.创建({
    名称: 'extend_memory',
    描述: '图谱检索增强（`Graph RAG`）工具，用于进行深度联想和上下文回忆。当你需要寻找与当前任务相关的背景知识，或希望通过某些概念发散出更多关联线索时使用。如果有特定的专有名词或相关概念，可传入 `目标关键词` 作为额外检索词来扩充召回范围。工作流程：1. 根据`查询内容`及`目标关键词`，找到最相关的一批记忆直接返回。2. 同时选取相关度最高的几条记忆作为图谱发散的起点。3. 以设定的`最大扩展跳数`和`最小关联阈值`为限制进行联想，收集沿途记忆中的关键词作为发散线索返回。4. 可选通过`正则表达式过滤`对最终结果进行二次过滤。返回的`搜索结果_发散关键词`可用于帮助你规划下一次更精确的搜索。',
    参数Schema: z.object({
      查询内容: z.string().describe('用于搜索的自然语言文本内容'),
      时间范围: z
        .object({
          开始相对天数: z
            .number()
            .nullable()
            .optional()
            .describe(
              '限定检索范围的起始点（表示距离今天过去的某一天）。例如传 30 表示从 30 天前开始找。留空表示不限更早的时间。',
            ),
          结束相对天数: z
            .number()
            .nullable()
            .optional()
            .describe(
              '限定检索范围的结束点（表示距离今天过去的某一天）。例如传 7 表示只找到 7 天前为止的数据。传 0 或留空表示一直检索到现在。',
            ),
        })
        .nullable()
        .optional()
        .describe('将检索限定在特定的时间范围内，为空表示搜索所有记忆'),
      目标关键词: z
        .array(z.string())
        .nullable()
        .optional()
        .describe('额外指定需要尝试匹配的核心关键词（如特定人名、事件名等），用于补充检索条件以提升召回率'),
      正则表达式过滤: z.string().nullable().optional().describe('用于过滤结果的正则表达式，仅保留内容匹配的记忆'),
      发散起点数: z.number().default(5).describe('作为图谱发散起点的相关记忆数量'),
      直接返回数: z.number().default(3).describe('直接返回完整内容的相关记忆数量'),
      最大扩展跳数: z.number().default(1).describe('图遍历的最大跳数，0表示不发散'),
      最小关联阈值: z
        .number()
        .default(配置.向量相似度关联阈值)
        .describe(
          `图遍历的最小综合关联度。建议设为 ${String(配置.向量相似度关联阈值)} 左右以支持纯语义关联，若大于 1 则必须有关键词重叠。`,
        ),
    }),
    返回值Schema: z.object({
      结果: z.enum(['成功', '失败']),
      搜索结果_完整记忆: z.string().optional(),
      搜索结果_发散关键词: z.string().optional(),
      错误信息: z.string().optional(),
    }),
    实现: async (参数: {
      查询内容: string
      时间范围?:
        { 开始相对天数?: number | null | undefined; 结束相对天数?: number | null | undefined } | null | undefined
      目标关键词?: string[] | null | undefined
      正则表达式过滤?: string | null | undefined
      发散起点数: number
      直接返回数: number
      最大扩展跳数: number
      最小关联阈值: number
    }): Promise<{
      结果: '成功' | '失败'
      搜索结果_完整记忆?: string
      搜索结果_发散关键词?: string
      错误信息?: string
    }> => {
      try {
        let segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
        let 基础分词 = [...segmenter.segment(参数.查询内容)].filter((s) => s.isWordLike === true).map((s) => s.segment)

        let 词语列表 = Array.from(new Set([...基础分词, ...(参数.目标关键词 ?? [])])).filter((s) => s.trim().length > 0)

        let 向量 = await 获取向量(参数.查询内容)

        let 解析开始时间: Date | undefined = undefined
        let 解析结束时间: Date | undefined = undefined
        let 现在 = new Date()

        let 开始天数 = 参数.时间范围?.开始相对天数
        let 结束天数 = 参数.时间范围?.结束相对天数

        if (开始天数 !== undefined && 开始天数 !== null) {
          解析开始时间 = new Date(现在.getTime())
          解析开始时间.setDate(解析开始时间.getDate() - 开始天数)
        }
        if (结束天数 !== undefined && 结束天数 !== null) {
          解析结束时间 = new Date(现在.getTime())
          解析结束时间.setDate(解析结束时间.getDate() - 结束天数)
        }

        let 匹配排序结果 = await 获取混合关联排序(数据库查询器, {
          查询关键词: 词语列表,
          查询向量: 向量,
          向量阈值: 配置.向量相似度关联阈值,
          开始时间: 解析开始时间,
          结束时间: 解析结束时间,
        })

        let 起点ID列表 = 匹配排序结果.slice(0, 参数.发散起点数).map((x) => x.id)
        let 直接返回ID列表 = 匹配排序结果.slice(0, 参数.直接返回数).map((x) => x.id)

        let 度量映射 = new Map<string, string>()
        for (let 项 of 匹配排序结果) {
          let 度量文本 = `综合:${项.综合得分.toFixed(2)}`
          if (项.重叠度 !== undefined) 度量文本 += `|重叠:${项.重叠度}`
          if (项.相似度 !== undefined) 度量文本 += `|相似:${(项.相似度 * 100).toFixed(1)}%`
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

        let 正则 =
          参数.正则表达式过滤 !== undefined && 参数.正则表达式过滤 !== null && 参数.正则表达式过滤 !== ''
            ? new RegExp(参数.正则表达式过滤)
            : null

        let 直接返回的记忆集合 = new Set<string>(直接返回ID列表)
        let 扩展标签记忆集合 = new Set<string>()

        // 广度优先图遍历
        if (起点ID列表.length > 0 && 参数.最大扩展跳数 > 0) {
          let 当前层 = [...起点ID列表]
          let 已访问 = new Set<string>(当前层)

          if (回调 !== undefined) {
            let 起点记忆 = await 数据库查询器.selectFrom('记忆表').selectAll().where('id', 'in', 起点ID列表).execute()
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
              内容: `[图谱延伸] 选取前 ${String(当前层.length)} 条最相关的记忆作为发散起点: { ${起点详情} }，准备以关联度阈值 >= ${String(参数.最小关联阈值)} 挖掘周边 ${String(参数.最大扩展跳数)} 跳的联想网络。`,
            })
          }

          for (let d = 0; d < 参数.最大扩展跳数; d++) {
            if (当前层.length === 0) break
            let 关联结果 = await 数据库查询器
              .selectFrom('记忆关联表')
              .select(['起点id', '终点id'])
              .where((eb) => eb.or([eb('起点id', 'in', 当前层), eb('终点id', 'in', 当前层)]))
              .where('关联度', '>=', 参数.最小关联阈值)
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
                .selectFrom('记忆表')
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

        let 最终记忆: 记忆表[] = []
        if (所有涉及ID.length > 0) {
          最终记忆 = await 数据库查询器.selectFrom('记忆表').selectAll().where('id', 'in', 所有涉及ID).execute()
        }

        let 最终直接内容: 记忆表[] = []
        let 最终扩展标签 = new Set<string>()

        for (let 记忆 of 最终记忆) {
          if (正则 !== null && 正则.test(记忆.内容) === false) continue

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
            .updateTable('记忆表')
            .set({
              最后访问序号: sql<number>`(SELECT COALESCE(MAX(创建序号), 0) FROM 记忆表)`,
              访问次数: sql`访问次数 + 1`,
            })
            .where('id', 'in', 命中的IDs)
            .execute()
        }

        return {
          结果: '成功',
          搜索结果_完整记忆: JSON.stringify(
            最终直接内容.map((m) => {
              return {
                id: m.id,
                等级: m.等级,
                评分: m.评分,
                内容: m.内容,
                关键词: m.关键词,
                标签: m.标签,
                相关度: 度量映射.get(m.id) ?? '未知',
                创建时间: 格式化为本地时间字符串(m.创建时间),
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
