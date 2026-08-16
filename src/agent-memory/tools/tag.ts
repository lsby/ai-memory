import { Kysely } from 'kysely'
import { z } from 'zod'
import { 智能体事件, 智能体工具 } from '../../agent/types'
import { 记忆数据库 } from '../agent-memory-types'

type 标签管理上下文 = { 数据库查询器: Kysely<记忆数据库>; 回调?: ((事件: 智能体事件) => Promise<void>) | undefined }

export function 追加记忆标签工具(上下文: 标签管理上下文): 智能体工具 {
  let { 数据库查询器, 回调 } = 上下文

  return 智能体工具.创建({
    名称: 'append_memory_tags',
    描述: '向指定记忆中追加新的标签。标签用于分类和描述元数据，不参与图谱关联。',
    参数Schema: z.object({
      id: z.string().describe('需要修改标签的记忆 ID'),
      标签列表: z.array(z.string()).describe('需要追加的标签列表'),
    }),
    返回值Schema: z.object({
      结果: z.enum(['成功', '失败']),
      错误信息: z.string().optional(),
      最新状态: z.string().optional(),
    }),
    实现: async (参数: {
      id: string
      标签列表: string[]
    }): Promise<{ 结果: '成功' | '失败'; 错误信息?: string; 最新状态?: string }> => {
      try {
        let 记忆 = await 数据库查询器.selectFrom('记忆表').select(['标签']).where('id', '=', 参数.id).executeTakeFirst()
        if (记忆 === undefined) {
          return { 结果: '失败', 错误信息: `找不到指定 ID (${参数.id}) 的记忆。` }
        }
        let 旧标签 = 记忆.标签
        let 新标签 = Array.from(new Set([...旧标签, ...参数.标签列表]))

        await 数据库查询器.updateTable('记忆表').set({ 标签: 新标签 }).where('id', '=', 参数.id).execute()

        if (回调 !== undefined) {
          await 回调({
            类型: '流程信息',
            内容: `[数据库更新] 追加记忆标签成功 (ID: ${参数.id}, 新标签: ${新标签.join(', ')})`,
          })
        }
        return { 结果: '成功', 最新状态: `[记忆 ID: ${参数.id}] 最新标签列表: ${新标签.join(', ')}` }
      } catch (error: unknown) {
        return { 结果: '失败', 错误信息: String(error instanceof Error ? error.message : error) }
      }
    },
  })
}

export function 移除记忆标签工具(上下文: 标签管理上下文): 智能体工具 {
  let { 数据库查询器, 回调 } = 上下文

  return 智能体工具.创建({
    名称: 'remove_memory_tags',
    描述: '从指定记忆中移除指定的标签。',
    参数Schema: z.object({
      id: z.string().describe('需要修改标签的记忆 ID'),
      标签列表: z.array(z.string()).describe('需要移除的标签列表'),
    }),
    返回值Schema: z.object({
      结果: z.enum(['成功', '失败']),
      错误信息: z.string().optional(),
      最新状态: z.string().optional(),
    }),
    实现: async (参数: {
      id: string
      标签列表: string[]
    }): Promise<{ 结果: '成功' | '失败'; 错误信息?: string; 最新状态?: string }> => {
      try {
        let 记忆 = await 数据库查询器.selectFrom('记忆表').select(['标签']).where('id', '=', 参数.id).executeTakeFirst()
        if (记忆 === undefined) {
          return { 结果: '失败', 错误信息: `找不到指定 ID (${参数.id}) 的记忆。` }
        }
        let 旧标签 = 记忆.标签
        let 新标签 = 旧标签.filter((k: string): boolean => {
          let 包含 = 参数.标签列表.includes(k)
          return 包含 === false
        })

        await 数据库查询器.updateTable('记忆表').set({ 标签: 新标签 }).where('id', '=', 参数.id).execute()

        if (回调 !== undefined) {
          await 回调({
            类型: '流程信息',
            内容: `[数据库更新] 移除记忆标签成功 (ID: ${参数.id}, 新标签: ${新标签.join(', ')})`,
          })
        }
        return { 结果: '成功', 最新状态: `[记忆 ID: ${参数.id}] 最新标签列表: ${新标签.join(', ')}` }
      } catch (error: unknown) {
        return { 结果: '失败', 错误信息: String(error instanceof Error ? error.message : error) }
      }
    },
  })
}

export function 覆盖记忆标签工具(上下文: 标签管理上下文): 智能体工具 {
  let { 数据库查询器, 回调 } = 上下文

  return 智能体工具.创建({
    名称: 'overwrite_memory_tags',
    描述: '用新的标签列表覆盖指定记忆的原有标签列表。',
    参数Schema: z.object({
      id: z.string().describe('需要修改标签的记忆 ID'),
      标签列表: z.array(z.string()).describe('覆盖后的新标签列表'),
    }),
    返回值Schema: z.object({
      结果: z.enum(['成功', '失败']),
      错误信息: z.string().optional(),
      最新状态: z.string().optional(),
    }),
    实现: async (参数: {
      id: string
      标签列表: string[]
    }): Promise<{ 结果: '成功' | '失败'; 错误信息?: string; 最新状态?: string }> => {
      try {
        let 记忆 = await 数据库查询器.selectFrom('记忆表').select(['id']).where('id', '=', 参数.id).executeTakeFirst()
        if (记忆 === undefined) {
          return { 结果: '失败', 错误信息: `找不到指定 ID (${参数.id}) 的记忆。` }
        }
        let 新标签 = 参数.标签列表

        await 数据库查询器.updateTable('记忆表').set({ 标签: 新标签 }).where('id', '=', 参数.id).execute()

        if (回调 !== undefined) {
          await 回调({
            类型: '流程信息',
            内容: `[数据库更新] 覆盖记忆标签成功 (ID: ${参数.id}, 新标签: ${新标签.join(', ')})`,
          })
        }
        return { 结果: '成功', 最新状态: `[记忆 ID: ${参数.id}] 最新标签列表: ${新标签.join(', ')}` }
      } catch (error: unknown) {
        return { 结果: '失败', 错误信息: String(error instanceof Error ? error.message : error) }
      }
    },
  })
}
