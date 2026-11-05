import type { 智能体事件 } from '@lsby/ai-agent'
import { 智能体工具 } from '@lsby/ai-agent'
import type { Kysely } from 'kysely'
import { z } from 'zod'
import { 同步记忆线索, 读取记忆线索映射 } from '../storage/clue-storage'
import type { 内部带记忆的智能体配置, 记忆数据库 } from '../types'

type 线索管理上下文 = {
  数据库查询器: Kysely<记忆数据库>
  获取向量: (内容: string) => Promise<number[] | null>
  配置: 内部带记忆的智能体配置
  回调?: ((事件: 智能体事件) => Promise<void>) | undefined
}

async function 修改线索(
  上下文: 线索管理上下文,
  id: string,
  变换: (旧线索: string[]) => string[],
): Promise<{ 成功: true; 线索: string[] } | { 成功: false; 错误信息: string }> {
  let 记忆 = await 上下文.数据库查询器
    .selectFrom('当前记忆表')
    .select(['id', '内容'])
    .where('id', '=', id)
    .executeTakeFirst()
  if (记忆 === undefined) return { 成功: false, 错误信息: 上下文.配置.模型语言包.找不到记忆(id) }
  let 映射 = await 读取记忆线索映射(上下文.数据库查询器, [id])
  let 新线索 = Array.from(
    new Set(
      变换(映射.get(id) ?? [])
        .map((线索) => 线索.trim())
        .filter((线索) => 线索 !== ''),
    ),
  )
  await 同步记忆线索(上下文, id, 记忆.内容, 新线索)
  return { 成功: true, 线索: 新线索 }
}

function 创建线索工具(
  上下文: 线索管理上下文,
  名称: 'append_memory_clues' | 'remove_memory_clues' | 'overwrite_memory_clues',
  描述: string,
  变换: (旧线索: string[], 请求线索: string[]) => string[],
): 智能体工具 {
  return 智能体工具.创建({
    名称,
    描述: '',
    参数Schema: z.object({
      id: z.string().describe('需要修改线索的记忆 ID'),
      线索: z.array(z.string()).describe(描述),
    }),
    返回值Schema: z.object({
      结果: z.enum(['成功', '失败']),
      错误信息: z.string().optional(),
      最新状态: z.string().optional(),
    }),
    实现: async (参数: {
      id: string
      线索: string[]
    }): Promise<{ 结果: '成功' | '失败'; 错误信息?: string; 最新状态?: string }> => {
      try {
        let 结果 = await 修改线索(上下文, 参数.id, (旧线索) => 变换(旧线索, 参数.线索))
        if (结果.成功 === false) return { 结果: '失败', 错误信息: 结果.错误信息 }
        if (上下文.回调 !== undefined) {
          await 上下文.回调({ 类型: '流程信息', 内容: `[数据库更新] 修改记忆线索成功 (ID: ${参数.id})` })
        }
        return { 结果: '成功', 最新状态: `记忆 ${参数.id} 的线索: ${结果.线索.join(', ')}` }
      } catch (错误: unknown) {
        return { 结果: '失败', 错误信息: 错误 instanceof Error ? 错误.message : String(错误) }
      }
    },
  })
}

export function 追加记忆线索工具(上下文: 线索管理上下文): 智能体工具 {
  return 创建线索工具(上下文, 'append_memory_clues', '需要追加的线索', (旧线索, 请求线索) => [...旧线索, ...请求线索])
}

export function 移除记忆线索工具(上下文: 线索管理上下文): 智能体工具 {
  return 创建线索工具(上下文, 'remove_memory_clues', '需要移除的线索', (旧线索, 请求线索) =>
    旧线索.filter((线索) => 请求线索.includes(线索) === false),
  )
}

export function 覆盖记忆线索工具(上下文: 线索管理上下文): 智能体工具 {
  return 创建线索工具(上下文, 'overwrite_memory_clues', '覆盖后的线索', (_旧线索, 请求线索) => 请求线索)
}
