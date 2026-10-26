import { Kysely } from 'kysely'
import { z } from 'zod'
import { 智能体事件, 智能体工具 } from '../../agent/types'
import { 内部带记忆的智能体配置, 记忆数据库 } from '../types'
import { 刷新记忆关联网络 } from './common'

type 关键词管理上下文 = {
  数据库查询器: Kysely<记忆数据库>
  配置: 内部带记忆的智能体配置
  回调?: ((事件: 智能体事件) => Promise<void>) | undefined
}

export function 追加记忆关键词工具(上下文: 关键词管理上下文): 智能体工具 {
  let { 数据库查询器, 回调, 配置 } = 上下文

  return 智能体工具.创建({
    名称: 'append_memory_keywords',
    描述: '',
    参数Schema: z.object({
      id: z.string().describe('需要修改关键词的记忆 ID'),
      关键词列表: z.array(z.string()).describe('需要追加的关键词列表'),
    }),
    返回值Schema: z.object({
      结果: z.enum(['成功', '失败']),
      错误信息: z.string().optional(),
      最新状态: z.string().optional(),
    }),
    实现: async (参数: {
      id: string
      关键词列表: string[]
    }): Promise<{ 结果: '成功' | '失败'; 错误信息?: string; 最新状态?: string }> => {
      try {
        let 记忆 = await 数据库查询器
          .selectFrom('记忆表')
          .select(['关键词'])
          .where('id', '=', 参数.id)
          .executeTakeFirst()
        if (记忆 === undefined) {
          return { 结果: '失败', 错误信息: 配置.模型语言包.找不到记忆(参数.id) }
        }
        let 旧关键词 = 记忆.关键词
        let 新关键词 = Array.from(new Set([...旧关键词, ...参数.关键词列表]))

        await 数据库查询器.updateTable('记忆表').set({ 关键词: 新关键词 }).where('id', '=', 参数.id).execute()

        await 刷新记忆关联网络(数据库查询器, 参数.id, 新关键词, 配置, 回调)

        if (回调 !== undefined) {
          await 回调({
            类型: '流程信息',
            内容: `[数据库更新] 追加记忆关键词成功 (ID: ${参数.id}, 新关键词: ${新关键词.join(', ')})`,
          })
        }
        return { 结果: '成功', 最新状态: 配置.模型语言包.记忆关键词状态(参数.id, 新关键词) }
      } catch (error: unknown) {
        return { 结果: '失败', 错误信息: String(error instanceof Error ? error.message : error) }
      }
    },
  })
}

export function 移除记忆关键词工具(上下文: 关键词管理上下文): 智能体工具 {
  let { 数据库查询器, 回调, 配置 } = 上下文

  return 智能体工具.创建({
    名称: 'remove_memory_keywords',
    描述: '',
    参数Schema: z.object({
      id: z.string().describe('需要修改关键词的记忆 ID'),
      关键词列表: z.array(z.string()).describe('需要移除的关键词列表'),
    }),
    返回值Schema: z.object({
      结果: z.enum(['成功', '失败']),
      错误信息: z.string().optional(),
      最新状态: z.string().optional(),
    }),
    实现: async (参数: {
      id: string
      关键词列表: string[]
    }): Promise<{ 结果: '成功' | '失败'; 错误信息?: string; 最新状态?: string }> => {
      try {
        let 记忆 = await 数据库查询器
          .selectFrom('记忆表')
          .select(['关键词'])
          .where('id', '=', 参数.id)
          .executeTakeFirst()
        if (记忆 === undefined) {
          return { 结果: '失败', 错误信息: 配置.模型语言包.找不到记忆(参数.id) }
        }
        let 旧关键词 = 记忆.关键词
        let 新关键词 = 旧关键词.filter((k: string): boolean => {
          let 包含 = 参数.关键词列表.includes(k)
          return 包含 === false
        })

        await 数据库查询器.updateTable('记忆表').set({ 关键词: 新关键词 }).where('id', '=', 参数.id).execute()

        await 刷新记忆关联网络(数据库查询器, 参数.id, 新关键词, 配置, 回调)

        if (回调 !== undefined) {
          await 回调({
            类型: '流程信息',
            内容: `[数据库更新] 移除记忆关键词成功 (ID: ${参数.id}, 新关键词: ${新关键词.join(', ')})`,
          })
        }
        return { 结果: '成功', 最新状态: 配置.模型语言包.记忆关键词状态(参数.id, 新关键词) }
      } catch (error: unknown) {
        return { 结果: '失败', 错误信息: String(error instanceof Error ? error.message : error) }
      }
    },
  })
}

export function 覆盖记忆关键词工具(上下文: 关键词管理上下文): 智能体工具 {
  let { 数据库查询器, 回调, 配置 } = 上下文

  return 智能体工具.创建({
    名称: 'overwrite_memory_keywords',
    描述: '',
    参数Schema: z.object({
      id: z.string().describe('需要修改关键词的记忆 ID'),
      关键词列表: z.array(z.string()).describe('覆盖后的新关键词列表'),
    }),
    返回值Schema: z.object({
      结果: z.enum(['成功', '失败']),
      错误信息: z.string().optional(),
      最新状态: z.string().optional(),
    }),
    实现: async (参数: {
      id: string
      关键词列表: string[]
    }): Promise<{ 结果: '成功' | '失败'; 错误信息?: string; 最新状态?: string }> => {
      try {
        let 记忆 = await 数据库查询器.selectFrom('记忆表').select(['id']).where('id', '=', 参数.id).executeTakeFirst()
        if (记忆 === undefined) {
          return { 结果: '失败', 错误信息: 配置.模型语言包.找不到记忆(参数.id) }
        }
        let 新关键词 = 参数.关键词列表

        await 数据库查询器.updateTable('记忆表').set({ 关键词: 新关键词 }).where('id', '=', 参数.id).execute()

        await 刷新记忆关联网络(数据库查询器, 参数.id, 新关键词, 配置, 回调)

        if (回调 !== undefined) {
          await 回调({
            类型: '流程信息',
            内容: `[数据库更新] 覆盖记忆关键词成功 (ID: ${参数.id}, 新关键词: ${新关键词.join(', ')})`,
          })
        }
        return { 结果: '成功', 最新状态: 配置.模型语言包.记忆关键词状态(参数.id, 新关键词) }
      } catch (error: unknown) {
        return { 结果: '失败', 错误信息: String(error instanceof Error ? error.message : error) }
      }
    },
  })
}
