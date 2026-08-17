import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type OpenAI from 'openai'
import { z } from 'zod'
import type { 智能体事件 } from '../agent/types'
import {
  格式化为本地时间字符串,
  type 带记忆的解决问题选项,
  type 记忆操作上下文,
  type 记忆数据库,
} from './agent-memory-types'

export async function 执行记忆重组(
  数据库查询器: Kysely<记忆数据库>,
  解决问题: <T extends z.ZodType>(选项: 带记忆的解决问题选项<T>) => Promise<unknown>,
  选项: {
    openai客户端: OpenAI
    模型名称: string
    当前时间?: Date
    种子关键词?: string[]
    回调?: (事件: 智能体事件) => Promise<void>
  },
): Promise<void> {
  let 随机词: string[] = []
  if (选项.种子关键词 !== undefined && 选项.种子关键词.length > 0) {
    随机词 = 选项.种子关键词
  } else {
    // 从记忆表中随机捞取几个关键词
    let 结果 = await sql<{ 关键词: string }>`
      SELECT unnest(关键词) as 关键词
      FROM 记忆表
      ORDER BY RANDOM()
      LIMIT 15
    `.execute(数据库查询器)

    let 所有词 = Array.from(new Set(结果.rows.map((r) => r.关键词)))
    随机词 = 所有词.sort(() => Math.random() - 0.5).slice(0, 3)
  }
  if (随机词.length === 0) {
    if (选项.回调 !== undefined) {
      await 选项.回调({ 类型: '流程信息', 内容: '潜意识太空旷，无法进行记忆重组' })
    }
    return
  }

  if (选项.回调 !== undefined) {
    await 选项.回调({ 类型: '流程信息', 内容: `[开始记忆重组] 潜意识浮现了这些概念: ${随机词.join(', ')}` })
  }

  let 命令 = `记忆重组任务: 你的脑海中浮现了这几个概念: [${随机词.join(', ')}]。
请你主动调用「回忆延伸」工具，或者使用其他可用工具来检索相关的知识。
仔细审视你的这些历史记忆，寻找它们之间的潜在逻辑联系，发现矛盾并修正，或者提取出更高的规律。
如果你发现这几个概念之间确实没有实质性或有价值的逻辑联系，请不要强行进行关联和修改，不要为了处理而处理，直接结束即可。
若有真正有价值的发现，再将你反思合并后得出的新洞见，通过「添加一级记忆」工具保存下来，将标签设为 \`底层规律\` 或 \`灵光一闪\` 等。`

  let 重组结果Schema = z.object({ 重组完成: z.boolean().describe('已完成知识关联和合并') })
  let 重组选项: 带记忆的解决问题选项<typeof 重组结果Schema> = {
    标题: '记忆重组',
    命令,
    预期结果Schema: 重组结果Schema,
    预期结果描述: '包含 重组完成 字段的 JSON',
    openai客户端: 选项.openai客户端,
    模型名称: 选项.模型名称,
    回调: async (事件: 智能体事件): Promise<void> => {
      if (事件.类型 === '流程信息' && 选项.回调 !== undefined) {
        await 选项.回调({ 类型: '流程信息', 内容: `[重组中] ${事件.内容}` })
      } else if (事件.类型 === '工具调用开始' && 选项.回调 !== undefined) {
        await 选项.回调({
          类型: '流程信息',
          内容: `[重组中] [调用工具: ${事件.工具名称}] 参数: ${JSON.stringify(事件.参数)}`,
        })
      } else if (事件.类型 === '工具调用结果' && 选项.回调 !== undefined) {
        await 选项.回调({
          类型: '流程信息',
          内容: `[重组中] [工具结果: ${事件.工具名称}] 结果: ${JSON.stringify(事件.结果)}`,
        })
      } else if (事件.类型 === '工具调用失败' && 选项.回调 !== undefined) {
        await 选项.回调({ 类型: '流程信息', 内容: `[重组中] [工具失败: ${事件.工具名称}] 错误: ${事件.错误信息}` })
      }
    },
    ...(选项.当前时间 !== undefined ? { 当前时间: 选项.当前时间 } : {}),
  }

  await 解决问题(重组选项)
  if (选项.回调 !== undefined) {
    await 选项.回调({ 类型: '流程信息', 内容: `[记忆重组结束] 潜意识重组完成。` })
  }
}

/**
 * 定时任务统一入口
 * 可以被外部定时器（如 cron 或 setTimeout）周期性调用，用于维护记忆网络和触发自主活动。
 * 包含一级记忆降级、二级记忆遗忘曲线清理以及可选的自动记忆重组。
 */
export async function 定时任务入口(
  上下文: 记忆操作上下文,
  解决问题: <T extends z.ZodType>(选项: 带记忆的解决问题选项<T>) => Promise<unknown>,
  选项?: { 当前时间?: Date; 回调?: (事件: 智能体事件) => Promise<void>; openai客户端?: OpenAI; 模型名称?: string },
): Promise<void> {
  let 当前时间 = 选项?.当前时间 ?? new Date()

  if (选项?.回调 !== undefined) {
    await 选项.回调({ 类型: '流程信息', 内容: `[定时任务] 开始执行，当前时间: ${格式化为本地时间字符串(当前时间)}` })
  }

  await 上下文.执行记忆变更('定时任务维护', async (事务上下文) => {
    await 事务上下文.检查并降级一级记忆()
    await 事务上下文.检查并清理二级记忆()
  })

  if (选项?.openai客户端 !== undefined && 选项.模型名称 !== undefined) {
    await 执行记忆重组(上下文.数据库查询器, 解决问题, {
      openai客户端: 选项.openai客户端,
      模型名称: 选项.模型名称,
      当前时间: 当前时间,
      ...(选项.回调 !== undefined ? { 回调: 选项.回调 } : {}),
    })
  }

  if (选项?.回调 !== undefined) {
    await 选项.回调({ 类型: '流程信息', 内容: `[定时任务] 执行完毕。` })
  }
}
