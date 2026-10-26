import { sql } from 'kysely'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { 构造前缀已变结果 } from '../../agent/message/prefix'
import type { 内部注入消息, 回合结果, 智能体执行模式 } from '../../agent/types'
import { 智能体工具 } from '../../agent/types'
import { 校验时区 } from '../../agent/utils/timezone'
import { 转为JSON值 } from '../logger'
import { 记忆工具名 } from '../prompt/memory-tool-names'
import { 本地化记忆工具 } from '../prompt/model-language'
import { 深度推演工具 } from '../tools/deep-deduction'
import { 加载并校验动态工具 } from '../tools/dynamic-loader'
import { 提取动态工具向量文本 } from '../tools/dynamic-tool-api'
import {
  创建动态工具工具,
  更新动态工具工具,
  查看动态工具代码工具,
  移除动态工具工具,
  调用动态工具工具,
} from '../tools/dynamic-tools'
import { 执行代码工具 } from '../tools/execute-code'
import { 回忆延伸工具 } from '../tools/graph-rag'
import { 移除记忆关键词工具, 覆盖记忆关键词工具, 追加记忆关键词工具 } from '../tools/keyword'
import { 修改零级记忆工具, 添加零级记忆工具, 移除零级记忆工具 } from '../tools/level-0'
import { 修改一级记忆工具, 添加一级记忆工具, 移除一级记忆工具 } from '../tools/level-1'
import { 捞起记忆到一级工具, 添加二级记忆工具, 降级记忆为二级工具 } from '../tools/level-2'
import { 移除记忆标签工具, 覆盖记忆标签工具, 追加记忆标签工具 } from '../tools/tag'
import {
  格式化为本地时间字符串,
  记忆等级,
  记忆表Schema,
  type 内部带记忆的解决问题选项,
  type 带记忆的解决问题选项,
  type 记忆操作上下文,
  type 记忆表,
} from '../types'

export function 格式化相对时间(记忆时间: Date, 当前时间: Date, 模型语言: 'zh-CN' | 'en-US' = 'zh-CN'): string {
  let 差值ms = 当前时间.getTime() - 记忆时间.getTime()
  let 差值分钟 = Math.floor(差值ms / 60000)
  if (差值分钟 < 1) return 模型语言 === 'en-US' ? 'just now' : '刚刚'
  if (差值分钟 < 60) return 模型语言 === 'en-US' ? `${String(差值分钟)} minutes ago` : `${String(差值分钟)}分钟前`
  let 差值小时 = Math.floor(差值分钟 / 60)
  if (差值小时 < 24) return 模型语言 === 'en-US' ? `${String(差值小时)} hours ago` : `${String(差值小时)}小时前`
  let 差值天 = Math.floor(差值小时 / 24)
  if (差值天 < 30) return 模型语言 === 'en-US' ? `${String(差值天)} days ago` : `${String(差值天)}天前`
  let 差值月 = Math.floor(差值天 / 30)
  return 模型语言 === 'en-US' ? `${String(差值月)} months ago` : `${String(差值月)}个月前`
}

/** 将三态向量结果解包为工具层使用的 number[] | null */
function 解包向量结果(
  结果: { 类型: '成功'; 向量: number[] } | { 类型: '无模型' } | { 类型: '失败'; 错误信息: string },
): number[] | null {
  if (结果.类型 === '成功') return 结果.向量
  return null
}

type 记忆工具上下文 = Omit<记忆操作上下文, '获取向量' | '执行记忆变更' | '带向量缓存'> & {
  获取向量: (内容: string) => Promise<number[] | null>
  带向量缓存: (内容列表: string[]) => Promise<记忆工具上下文>
  执行记忆变更: <R>(消息: string, 操作: (上下文: 记忆工具上下文) => Promise<R>) => Promise<R>
}

type 记忆工具工厂 = (上下文: 记忆工具上下文) => 智能体工具

function 构建记忆工具上下文(上下文: 记忆操作上下文): 记忆工具上下文 {
  return {
    ...上下文,
    获取向量: async (内容: string): Promise<number[] | null> => 解包向量结果(await 上下文.获取向量(内容)),
    带向量缓存: async (内容列表: string[]): Promise<记忆工具上下文> =>
      构建记忆工具上下文(await 上下文.带向量缓存(内容列表)),
    执行记忆变更: async <R>(消息: string, 操作: (上下文: 记忆工具上下文) => Promise<R>): Promise<R> =>
      await 上下文.执行记忆变更(消息, async (事务上下文) => await 操作(构建记忆工具上下文(事务上下文))),
  }
}

function 读取文本参数(参数: Record<string, unknown>, 字段: string): string[] {
  let 值 = 参数[字段]
  return typeof 值 === 'string' ? [值] : []
}

/** 工具参数里需要向量化的文本。事务外先算好，事务内的 获取向量 只查缓存。 */
async function 提取工具向量文本(工具名称: string, 参数: Record<string, unknown>): Promise<string[]> {
  let 内容字段: Record<string, string> = {
    add_level_0_memory: '内容',
    add_level_1_memory: '内容',
    add_level_2_memory: '内容',
    edit_level_0_memory: '新内容',
    edit_level_1_memory: '新内容',
    extend_memory: '查询内容',
  }
  let 代码字段: Record<string, string> = { create_dynamic_tool: '代码', update_dynamic_tool: '新代码' }
  let 文本字段 = 内容字段[工具名称]
  if (文本字段 !== undefined) return 读取文本参数(参数, 文本字段)
  let 动态工具代码字段 = 代码字段[工具名称]
  if (动态工具代码字段 === undefined) return []
  let 文本 = await 提取动态工具向量文本(读取文本参数(参数, 动态工具代码字段)[0] ?? '')
  return 文本 === null ? [] : [文本]
}

function 创建事务化记忆工具(上下文: 记忆工具上下文, 工厂: 记忆工具工厂): 智能体工具 {
  let 模板 = 工厂(上下文)
  return 智能体工具.创建({
    名称: 模板.名称,
    描述: 模板.描述,
    参数Schema: 模板.参数Schema,
    返回值Schema: 模板.返回值Schema,
    返回值描述: 模板.返回值描述,
    实现: async (参数): Promise<{ 结果: '成功' | '失败' } & Record<string, unknown>> => {
      // 两段式：先在事务外把向量算好，再开事务；事务期间互斥锁一直被占着，不能在里面等网络
      let 带缓存上下文 = await 上下文.带向量缓存(await 提取工具向量文本(模板.名称, 参数))
      return await 带缓存上下文.执行记忆变更(
        `工具: ${模板.名称}`,
        async (事务上下文) => await 工厂(事务上下文).实现(参数),
      )
    },
  })
}

export async function 解决问题<T extends z.ZodType>(
  上下文: 记忆操作上下文,
  选项: 带记忆的解决问题选项<T>,
  执行器: (选项: 内部带记忆的解决问题选项<T>) => Promise<回合结果<T>>,
  执行模式: 智能体执行模式,
  检查前缀: (选项: 带记忆的解决问题选项<T>) => string,
): Promise<回合结果<T>> {
  let 召回开始时间 = new Date()
  let { 配置, 数据库查询器, 保存快照 } = 上下文
  let 模型语言 = 配置.模型语言 ?? 'zh-CN'
  let 当前时间 = 选项.当前时间 ?? new Date()
  let 时区 = 选项.时区 ?? 配置.时区
  if (时区 !== undefined) 校验时区(时区)

  let 记忆列表 = await 数据库查询器
    .selectFrom('记忆表')
    .selectAll()
    .where('等级', 'in', [记忆等级.零级, 记忆等级.一级])
    .orderBy('创建时间', 'asc') // 较早的在前
    .execute()

  let 零级记忆列表 = 记忆列表.filter((项) => 项.等级 === 记忆等级.零级)
  let 一级记忆列表 = 记忆列表.filter((项) => 项.等级 === 记忆等级.一级)

  let 记忆工具上下文 = 构建记忆工具上下文(上下文)
  // 工具名用常量写在这里, 先按 记忆工具筛选 的结果筛掉再创建; 顺序就是挂给模型的顺序
  let 启用的工具名 = new Set(配置.启用的记忆工具名)
  let 候选工具: Array<[string, () => 智能体工具]> = [
    [记忆工具名.执行代码, (): 智能体工具 => 执行代码工具],
    [
      记忆工具名.深度推演,
      (): 智能体工具 => 深度推演工具({ 配置, 当前解决问题选项: 选项, 保存快照: async () => await 保存快照() }),
    ],

    // ---- 零级记忆工具 ----
    [记忆工具名.添加零级记忆, (): 智能体工具 => 创建事务化记忆工具(记忆工具上下文, 添加零级记忆工具)],
    [记忆工具名.修改零级记忆, (): 智能体工具 => 创建事务化记忆工具(记忆工具上下文, 修改零级记忆工具)],
    [记忆工具名.移除零级记忆, (): 智能体工具 => 创建事务化记忆工具(记忆工具上下文, 移除零级记忆工具)],

    // ---- 一级记忆工具 ----
    [记忆工具名.添加一级记忆, (): 智能体工具 => 创建事务化记忆工具(记忆工具上下文, 添加一级记忆工具)],
    [记忆工具名.修改一级记忆, (): 智能体工具 => 创建事务化记忆工具(记忆工具上下文, 修改一级记忆工具)],
    [记忆工具名.移除一级记忆, (): 智能体工具 => 创建事务化记忆工具(记忆工具上下文, 移除一级记忆工具)],

    // ---- 二级记忆工具 ----
    [记忆工具名.添加二级记忆, (): 智能体工具 => 创建事务化记忆工具(记忆工具上下文, 添加二级记忆工具)],
    [记忆工具名.降级记忆为二级, (): 智能体工具 => 创建事务化记忆工具(记忆工具上下文, 降级记忆为二级工具)],
    [记忆工具名.捞起记忆到一级, (): 智能体工具 => 创建事务化记忆工具(记忆工具上下文, 捞起记忆到一级工具)],

    // ---- 图谱检索工具 ----
    [记忆工具名.回忆延伸, (): 智能体工具 => 创建事务化记忆工具(记忆工具上下文, 回忆延伸工具)],

    // ---- 关键词管理工具 ----
    [记忆工具名.追加记忆关键词, (): 智能体工具 => 创建事务化记忆工具(记忆工具上下文, 追加记忆关键词工具)],
    [记忆工具名.移除记忆关键词, (): 智能体工具 => 创建事务化记忆工具(记忆工具上下文, 移除记忆关键词工具)],
    [记忆工具名.覆盖记忆关键词, (): 智能体工具 => 创建事务化记忆工具(记忆工具上下文, 覆盖记忆关键词工具)],

    // ---- 标签管理工具 ----
    [记忆工具名.追加记忆标签, (): 智能体工具 => 创建事务化记忆工具(记忆工具上下文, 追加记忆标签工具)],
    [记忆工具名.移除记忆标签, (): 智能体工具 => 创建事务化记忆工具(记忆工具上下文, 移除记忆标签工具)],
    [记忆工具名.覆盖记忆标签, (): 智能体工具 => 创建事务化记忆工具(记忆工具上下文, 覆盖记忆标签工具)],

    // ---- 动态工具管理 ----
    [记忆工具名.创建动态工具, (): 智能体工具 => 创建事务化记忆工具(记忆工具上下文, 创建动态工具工具)],
    [记忆工具名.查看动态工具代码, (): 智能体工具 => 查看动态工具代码工具(记忆工具上下文)],
    [记忆工具名.更新动态工具, (): 智能体工具 => 创建事务化记忆工具(记忆工具上下文, 更新动态工具工具)],
    [记忆工具名.移除动态工具, (): 智能体工具 => 创建事务化记忆工具(记忆工具上下文, 移除动态工具工具)],
    [记忆工具名.调用动态工具, (): 智能体工具 => 调用动态工具工具(记忆工具上下文)],
  ]
  let 记忆专用工具列表 =
    执行模式 === '推演'
      ? []
      : 候选工具
          .filter(([名称]): boolean => 启用的工具名.has(名称))
          .map(([名称, 创建]): 智能体工具 => {
            let 工具 = 创建()
            if (工具.名称 !== 名称) throw new Error(`记忆工具名常量 ${名称} 与工具实际名称 ${工具.名称} 不一致`)
            return 本地化记忆工具(工具, 配置.模型语言 ?? 'zh-CN')
          })

  // 前缀已变时不能有任何副作用: 在自动召回(会更新访问计数、走事务)之前先检查, 变了就直接返回
  let 追加工具列表 = 执行模式 === '推演' ? [] : [...(选项.临时追加工具列表 ?? []), ...记忆专用工具列表]
  if (检查前缀({ ...选项, 临时追加工具列表: 追加工具列表 }) === '前缀已变') {
    return 构造前缀已变结果(选项.消息历史 ?? [])
  }

  let 零级记忆文本 =
    模型语言 === 'en-US' ? '### Current level 0 memories (core rules)\n' : '### 当前零级记忆 (核心法则)\n'
  if (零级记忆列表.length > 0) {
    for (let 记忆 of 零级记忆列表) {
      let 标签文本 = 记忆.标签.length > 0 ? `[${记忆.标签.join('][')}] ` : ''
      零级记忆文本 += `- [${记忆.id}] ${标签文本}${记忆.内容} (${模型语言 === 'en-US' ? 'keywords' : '关键词'}: ${记忆.关键词.join(', ')})\n`
    }
  } else {
    零级记忆文本 += 模型语言 === 'en-US' ? '- None\n' : '- 无\n'
  }

  let 本轮召回内容片段: string[] = []
  let 自动召回记忆id列表: string[] = []
  let 自动召回动态工具id列表: string[] = []
  let 自动召回关键词数量 = 0
  let 记忆状态文本 = `${零级记忆文本}\n${模型语言 === 'en-US' ? '### Current level 1 memories (working context)' : '### 当前一级记忆 (重点关注的工作上下文)'}\n`

  if (一级记忆列表.length > 0) {
    for (let 记忆 of 一级记忆列表) {
      let 标签文本 = 记忆.标签.length > 0 ? `[${记忆.标签.join('][')}] ` : ''
      记忆状态文本 += `- [${记忆.id}] (${模型语言 === 'en-US' ? 'score' : '评分'}:${String(记忆.评分)}, ${模型语言 === 'en-US' ? 'recorded at ' : '记录于'}${格式化为本地时间字符串(记忆.创建时间, 时区)}) ${标签文本}${记忆.内容} (${模型语言 === 'en-US' ? 'keywords' : '关键词'}: ${记忆.关键词.join(', ')})\n`
    }
  } else {
    记忆状态文本 += 模型语言 === 'en-US' ? '- None\n' : '- 无\n'
  }

  let 自动检索二级记忆数量 = 配置.自动检索二级记忆数量
  let 自动检索二级记忆起点数 = 配置.自动检索二级记忆起点数

  // 自动召回要用命令的向量：先在事务外算好，后面开事务时只读缓存
  let 自动召回上下文 =
    执行模式 !== '推演' &&
    选项.是否自动召回 !== false &&
    选项.命令 !== '' &&
    (自动检索二级记忆数量 > 0 || 自动检索二级记忆起点数 > 0 || 配置.自动检索动态工具数量 > 0)
      ? await 上下文.带向量缓存([选项.命令])
      : 上下文

  if (
    执行模式 !== '推演' &&
    选项.是否自动召回 !== false &&
    选项.命令 !== '' &&
    (自动检索二级记忆数量 > 0 || 自动检索二级记忆起点数 > 0)
  ) {
    let 结果 = await 自动召回上下文.执行记忆变更(
      '自动记忆召回',
      async (事务上下文) =>
        await 回忆延伸工具(构建记忆工具上下文(事务上下文)).实现({
          查询内容: 选项.命令,
          发散起点数: 自动检索二级记忆起点数,
          直接返回数: 自动检索二级记忆数量,
          最大扩展跳数: 1,
          最小关联阈值: 配置.向量相似度关联阈值,
        }),
    )

    if (结果.结果 === '成功') {
      let 解析结果 = z
        .object({ 搜索结果_完整记忆: z.string().optional(), 搜索结果_发散关键词: z.string().optional() })
        .safeParse(结果)

      if (解析结果.success) {
        let 数据 = 解析结果.data
        let 记忆片段: 记忆表[] = []
        let 关键词片段: string[] = []

        if (数据.搜索结果_完整记忆 !== undefined) {
          记忆片段 = z.array(记忆表Schema).parse(JSON.parse(数据.搜索结果_完整记忆))
        }
        if (数据.搜索结果_发散关键词 !== undefined) {
          关键词片段 = z.array(z.string()).parse(JSON.parse(数据.搜索结果_发散关键词))
        }

        let 二级记忆片段 = 记忆片段.filter((m) => m.等级 === 记忆等级.二级)
        自动召回记忆id列表.push(...二级记忆片段.map((记忆) => 记忆.id))
        自动召回关键词数量 += 关键词片段.length

        if (二级记忆片段.length > 0 || 关键词片段.length > 0) {
          let 召回内容文本 =
            模型语言 === 'en-US'
              ? '### Automatically recalled long-term memories and related concepts\n'
              : '### 自动唤起的潜意识片段 (二级记忆与发散概念)\n'
          if (二级记忆片段.length > 0) {
            召回内容文本 +=
              模型语言 === 'en-US'
                ? 'The following related memories were recalled:\n'
                : '随着当前的思考，你脑海中隐约浮现了以下相关历史记忆：\n'
            for (let 记忆 of 二级记忆片段) {
              let 相对时间 = 格式化相对时间(new Date(记忆.创建时间), 当前时间, 模型语言)
              let 标签文本 = 记忆.标签.length > 0 ? `[${记忆.标签.join('][')}] ` : ''
              召回内容文本 += `- [${记忆.id}] (${模型语言 === 'en-US' ? 'score' : '评分'}:${String(记忆.评分)}, ${相对时间}) ${标签文本}${记忆.内容} (${模型语言 === 'en-US' ? 'keywords' : '关键词'}: ${记忆.关键词.join(', ')})\n`
            }
          }
          if (关键词片段.length > 0) {
            召回内容文本 +=
              模型语言 === 'en-US'
                ? `Related concepts: [${关键词片段.join(', ')}]\nThese are weak associations and may concern other people or events. Do not attribute them to the current subject without reading the exact memory through extend_memory.\n`
                : `你同时联想到了这些发散概念: [${关键词片段.join(', ')}]\n(注意: 这些仅仅是潜意识边缘闪过的零散词汇，可能属于其他人或事。在未查明具体记忆前，绝对不要把这些词汇强行张冠李戴给当前讨论的对象！如果想知道细节，请继续调用「回忆延伸」工具)\n`
          }
          本轮召回内容片段.push(召回内容文本)
        }
      }
    }
  }

  // ---- 动态工具自动召回 ----
  let 自动检索动态工具数量 = 配置.自动检索动态工具数量
  if (执行模式 !== '推演' && 选项.是否自动召回 !== false && 选项.命令 !== '' && 自动检索动态工具数量 > 0) {
    let 查询向量 = 解包向量结果(await 自动召回上下文.获取向量(选项.命令))
    if (查询向量 !== null) {
      let 当前维度 = 查询向量.length
      let 向量字符串 = JSON.stringify(查询向量)
      let 相似度表达式 = sql<number>`1 - (向量 <=> ${向量字符串}::vector)`
      let 召回的工具 = await 数据库查询器
        .selectFrom('动态工具表')
        .select(['id', '名称', '描述', '代码', 相似度表达式.as('相似度')])
        .where('向量', 'is not', null)
        .where('向量维度', '=', 当前维度)
        .where(相似度表达式, '>', 配置.向量相似度关联阈值)
        .orderBy(相似度表达式, 'desc')
        .limit(自动检索动态工具数量)
        .execute()

      if (召回的工具.length > 0) {
        自动召回动态工具id列表.push(...召回的工具.map((工具) => 工具.id))
        let 动态工具提示文本 =
          模型语言 === 'en-US' ? '### Automatically recalled dynamic tools\n' : '### 自动召回的动态工具\n'
        动态工具提示文本 +=
          模型语言 === 'en-US'
            ? 'The following potentially relevant tools were recalled. Use `call_dynamic_tool` to run one.\n'
            : '系统根据当前对话内容，从你的工具库中召回了以下可能用得到的动态工具。如需使用，请调用 `call_dynamic_tool` 工具。\n'
        for (let 工具 of 召回的工具) {
          let 加载结果 = await 加载并校验动态工具(工具.代码)
          let 参数Schema = 模型语言 === 'en-US' ? 'not provided' : '未提供'
          let 返回值Schema = 模型语言 === 'en-US' ? 'not provided' : '未提供'
          if (加载结果.成功) {
            参数Schema = JSON.stringify(加载结果.工具.参数Schema)
            返回值Schema = JSON.stringify(加载结果.工具.返回值Schema)
          }
          动态工具提示文本 += `- **${工具.名称}**: ${工具.描述} (${模型语言 === 'en-US' ? 'parameter schema' : '参数Schema'}: ${参数Schema}) (${模型语言 === 'en-US' ? 'return schema' : '返回值Schema'}: ${返回值Schema}) (${模型语言 === 'en-US' ? 'similarity' : '相似度'}: ${(工具.相似度 * 100).toFixed(1)}%)\n`
        }
        本轮召回内容片段.push(动态工具提示文本)
      }
    }
  }

  // 记忆状态和召回内容交给智能体按统一规则追加: 记忆状态按指纹和历史中最后一条比较去重, 召回内容每轮都追加
  let 记忆状态指纹 = createHash('sha256')
    .update(
      JSON.stringify(
        记忆列表.map((记忆) => ({
          id: 记忆.id,
          等级: 记忆.等级,
          评分: 记忆.评分,
          内容: 记忆.内容,
          关键词: 记忆.关键词,
          标签: 记忆.标签,
          创建时间: 记忆.创建时间.toISOString(),
        })),
      ),
    )
    // 时区会改变"记录于"的写法, 所以进指纹; 没设时区时什么都不加, 指纹和旧版一致
    .update(时区 !== undefined ? `\n${时区}` : '')
    .digest('hex')
  let 本轮注入消息列表: 内部注入消息[] = [
    {
      类型: 'memory-state',
      内容:
        模型语言 === 'en-US'
          ? `### Current memory state\nThis is the complete current state. If it conflicts with an older memory-state message, use this one.\n\n${记忆状态文本}`
          : `### 本轮最新记忆状态\n以下是当前完整状态，如果与历史中更早的记忆状态冲突，以本条为准。\n\n${记忆状态文本}`,
      指纹: 记忆状态指纹,
    },
  ]
  if (本轮召回内容片段.length > 0) {
    本轮注入消息列表.push({ 类型: 'recall-context', 内容: 本轮召回内容片段.join('\n'), 总是追加: true })
  }

  await 上下文.记录交互日志({
    类型: '记忆召回',
    开始时间: 召回开始时间,
    耗时ms: Date.now() - 召回开始时间.getTime(),
    内容: 转为JSON值({
      记忆id列表: 自动召回记忆id列表,
      动态工具id列表: 自动召回动态工具id列表,
      发散关键词数量: 自动召回关键词数量,
    }),
  })

  let 新选项: 内部带记忆的解决问题选项<T> = {
    ...选项,
    内部注入消息: 本轮注入消息列表,
    临时追加工具列表: 追加工具列表,
  }

  // 执行基类的流程
  return await 执行器(新选项)
}
