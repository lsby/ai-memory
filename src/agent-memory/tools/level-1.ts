import { Kysely } from 'kysely'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { 智能体事件, 智能体工具 } from '../../agent/types'
import { 内部带记忆的智能体配置, 记忆数据库, 记忆等级 } from '../agent-memory-types'
import { 刷新记忆关联网络 } from './common'
import { 增量排版 } from './layout'

type 一级记忆上下文 = {
  数据库查询器: Kysely<记忆数据库>
  获取向量: (内容: string) => Promise<number[] | null>
  检查并降级一级记忆: () => Promise<void>
  配置: 内部带记忆的智能体配置
  回调?: ((事件: 智能体事件) => Promise<void>) | undefined
}

export function 添加一级记忆工具(上下文: 一级记忆上下文): 智能体工具 {
  let { 数据库查询器, 获取向量, 检查并降级一级记忆, 回调, 配置 } = 上下文

  return 智能体工具.创建({
    名称: 'add_level_1_memory',
    描述: '把当前任务的重点放入工作记忆中。容量满载时会自动降级评分最低的记忆。',
    参数Schema: z.object({
      内容: z.string().describe('记忆的内容'),
      关键词: z.array(z.string()).describe('相关关键词提取，将依据这些关键词自动构建记忆关联图谱'),
      标签: z
        .array(z.string())
        .optional()
        .default([])
        .describe('元数据标签，用于分类和描述（例如 "临时猜想"、"置信度:80%" 等）'),
      评分: z.number().describe('0.0 到 100.0 的浮点数，代表重要程度。分数越低越容易被挤出工作区。'),
    }),
    返回值Schema: z.object({
      结果: z.enum(['成功', '失败']),
      id: z.string().optional(),
      错误信息: z.string().optional(),
      最新状态: z.string().optional(),
    }),
    实现: async (参数: {
      内容: string
      关键词: string[]
      标签: string[]
      评分: number
    }): Promise<{ 结果: '成功' | '失败'; id?: string; 错误信息?: string; 最新状态?: string }> => {
      try {
        let id = randomUUID()
        let 向量 = await 获取向量(参数.内容)
        let 插入结果 = await 数据库查询器
          .insertInto('记忆表')
          .values({
            id,
            等级: 记忆等级.一级,
            评分: 参数.评分,
            内容: 参数.内容,
            关键词: 参数.关键词,
            标签: 参数.标签,
            向量: 向量 !== null ? JSON.stringify(向量) : null,
            向量维度: 向量 !== null ? 向量.length : null,
            创建时间: new Date(),
            访问次数: 0,
          })
          .returning('创建序号')
          .executeTakeFirst()
        if (插入结果?.创建序号 !== undefined) {
          await 数据库查询器
            .updateTable('记忆表')
            .set({ 最后访问序号: 插入结果.创建序号 })
            .where('id', '=', id)
            .execute()
        }
        await 刷新记忆关联网络(数据库查询器, id, 参数.关键词, 配置, 回调)
        await 增量排版(数据库查询器, id)

        if (回调 !== undefined) {
          await 回调({
            类型: '流程信息',
            内容: `[数据库更新] 成功新增一级记忆 (ID: ${id}, 评分: ${String(参数.评分)})`,
          })
        }

        await 检查并降级一级记忆()
        return {
          结果: '成功',
          id,
          最新状态: `[一级记忆 ID: ${id}] (评分: ${String(参数.评分)}) 内容: ${参数.内容} (关键词: ${参数.关键词.join(', ')}, 标签: ${参数.标签.join(', ')})`,
        }
      } catch (error: unknown) {
        return { 结果: '失败', 错误信息: String(error instanceof Error ? error.message : error) }
      }
    },
  })
}

export function 修改一级记忆工具(上下文: 一级记忆上下文): 智能体工具 {
  let { 数据库查询器, 获取向量, 检查并降级一级记忆, 回调, 配置 } = 上下文

  return 智能体工具.创建({
    名称: 'edit_level_1_memory',
    描述: '修改某条已有的一级记忆的内容、关键词和评分。',
    参数Schema: z.object({
      id: z.string(),
      新内容: z.string().describe('修改后的内容'),
      新关键词: z.array(z.string()).describe('修改后的关键词列表'),
      新标签: z.array(z.string()).describe('修改后的标签列表'),
      新评分: z.number().describe('重新评估这在当前任务的重要度 (0.0 - 100.0)'),
    }),
    返回值Schema: z.object({
      结果: z.enum(['成功', '失败']),
      错误信息: z.string().optional(),
      最新状态: z.string().optional(),
    }),
    实现: async (参数: {
      id: string
      新内容: string
      新关键词: string[]
      新标签: string[]
      新评分: number
    }): Promise<{ 结果: '成功' | '失败'; 错误信息?: string; 最新状态?: string }> => {
      try {
        let 向量 = await 获取向量(参数.新内容)
        let updateData: {
          内容: string
          关键词: string[]
          评分: number
          向量: string | null
          向量维度: number | null
          标签: string[]
        } = {
          内容: 参数.新内容,
          关键词: 参数.新关键词,
          评分: 参数.新评分,
          向量: 向量 !== null ? JSON.stringify(向量) : null,
          向量维度: 向量 !== null ? 向量.length : null,
          标签: 参数.新标签,
        }
        await 数据库查询器
          .updateTable('记忆表')
          .set(updateData)
          .where('id', '=', 参数.id)
          .where('等级', '=', 记忆等级.一级)
          .execute()
        await 刷新记忆关联网络(数据库查询器, 参数.id, 参数.新关键词, 配置, 回调)

        if (回调 !== undefined) {
          await 回调({
            类型: '流程信息',
            内容: `[数据库更新] 成功修改一级记忆 (ID: ${参数.id}, 新评分: ${String(参数.新评分)})`,
          })
        }

        await 检查并降级一级记忆()
        return {
          结果: '成功',
          最新状态: `[一级记忆 ID: ${参数.id}] (评分: ${String(参数.新评分)}) 内容: ${参数.新内容} (关键词: ${参数.新关键词.join(', ')}, 标签: ${参数.新标签.join(', ')})`,
        }
      } catch (error: unknown) {
        return { 结果: '失败', 错误信息: String(error instanceof Error ? error.message : error) }
      }
    },
  })
}

export function 删除一级记忆工具(上下文: 一级记忆上下文): 智能体工具 {
  let { 数据库查询器, 回调 } = 上下文

  return 智能体工具.创建({
    名称: 'delete_level_1_memory',
    描述: '直接删除某条一级记忆（而不是降级）。',
    参数Schema: z.object({ id: z.string() }),
    返回值Schema: z.object({
      结果: z.enum(['成功', '失败']),
      错误信息: z.string().optional(),
      最新状态: z.string().optional(),
    }),
    实现: async (参数: { id: string }): Promise<{ 结果: '成功' | '失败'; 错误信息?: string; 最新状态?: string }> => {
      try {
        await 数据库查询器
          .deleteFrom('记忆关联表')
          .where((eb) => eb.or([eb('起点id', '=', 参数.id), eb('终点id', '=', 参数.id)]))
          .execute()

        await 数据库查询器.deleteFrom('记忆表').where('id', '=', 参数.id).where('等级', '=', 记忆等级.一级).execute()
        if (回调 !== undefined) {
          await 回调({ 类型: '流程信息', 内容: `[数据库更新] 成功删除一级记忆 (ID: ${参数.id})` })
        }
        return { 结果: '成功', 最新状态: `[一级记忆 ID: ${参数.id}] 已彻底删除` }
      } catch (error: unknown) {
        return { 结果: '失败', 错误信息: String(error instanceof Error ? error.message : error) }
      }
    },
  })
}
