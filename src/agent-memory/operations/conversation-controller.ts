import type { Kysely } from 'kysely'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { 模型语言包 } from '../../agent/model-language'
import { 智能体工具, type 智能体执行模式, type 智能体消息类型 } from '../../agent/types'
import {
  创建会话 as 存储创建会话,
  原子创建压缩派生会话 as 存储原子创建压缩派生会话,
  更新会话标题 as 存储更新会话标题,
  查询会话 as 存储查询会话,
  查询会话列表 as 存储查询会话列表,
  查询派生会话 as 存储查询派生会话,
  查询消息分支 as 存储查询消息分支,
  检出消息 as 存储检出消息,
  读取会话消息 as 存储读取会话消息,
  读取消息历史 as 存储读取消息历史,
  追加消息列表 as 存储追加消息列表,
} from '../storage/conversation-storage'
import type { 公开会话, 公开消息, 创建派生会话选项, 查询会话列表选项, 记忆数据库 } from '../types'
import { 读取当前会话谱系消息 } from './conversation-lineage'
import { 查询记忆新增相关消息 } from './memory-message-origin'

type 会话控制器依赖 = {
  数据库查询器: Kysely<记忆数据库>
  确保已初始化: () => Promise<void>
  读取新会话标识: () => string
  载入内存历史: (消息列表: 智能体消息类型[], 会话id: string) => void
  模型语言包: 模型语言包
}

export class 会话控制器 {
  private 当前会话id值: string | null = null
  private 当前消息id值: string | null = null
  private 已持久化消息数量: number = 0
  private 待创建会话标题: string = ''

  public constructor(private readonly 依赖: 会话控制器依赖) {}

  public 当前会话id(): string | null {
    return this.当前会话id值
  }

  public 当前消息id(): string | null {
    return this.当前消息id值
  }

  public 设置待创建会话标题(标题: string): void {
    this.待创建会话标题 = 标题
  }

  public 重置(): void {
    this.当前会话id值 = null
    this.当前消息id值 = null
    this.已持久化消息数量 = 0
    this.待创建会话标题 = ''
  }

  public async 同步消息(消息列表: 智能体消息类型[], 执行模式: 智能体执行模式): Promise<void> {
    if (执行模式 !== '对话') return
    await this.依赖.确保已初始化()
    let 会话id = await this.确保当前会话()
    if (消息列表.length < this.已持久化消息数量) throw new Error('当前消息列表短于已经持久化的会话历史')
    if (this.已持久化消息数量 > 0) {
      let 内存末尾id = 消息列表[this.已持久化消息数量 - 1]?.持久化消息id
      if (内存末尾id !== this.当前消息id值) throw new Error('内存历史与数据库 HEAD 不一致')
    } else if (this.当前消息id值 !== null) {
      throw new Error('内存历史与数据库 HEAD 不一致')
    }
    let 新消息列表 = 消息列表.slice(this.已持久化消息数量)
    if (新消息列表.length === 0) return
    for (let 消息 of 新消息列表) {
      if (消息.持久化消息id === undefined) 消息.持久化消息id = randomUUID()
    }
    let 新消息 = await 存储追加消息列表(this.依赖.数据库查询器, 会话id, this.当前消息id值, 新消息列表)
    let 末尾 = 新消息.at(-1)
    if (末尾 === undefined) return
    this.当前消息id值 = 末尾.id
    this.已持久化消息数量 += 新消息.length
  }

  public async 创建会话(选项: { 标题?: string | undefined } = {}): Promise<公开会话> {
    await this.依赖.确保已初始化()
    let 会话 = await 存储创建会话(this.依赖.数据库查询器, { 标题: 选项.标题 })
    await this.激活会话(会话)
    return 会话
  }

  public async 查询会话(id: string): Promise<公开会话 | null> {
    await this.依赖.确保已初始化()
    return await 存储查询会话(this.依赖.数据库查询器, id)
  }

  public async 查询会话列表(选项: 查询会话列表选项 = {}): Promise<公开会话[]> {
    await this.依赖.确保已初始化()
    return await 存储查询会话列表(this.依赖.数据库查询器, 选项)
  }

  public async 查询派生会话(前驱会话id: string): Promise<公开会话[]> {
    await this.依赖.确保已初始化()
    return await 存储查询派生会话(this.依赖.数据库查询器, 前驱会话id)
  }

  /** 确保存储就绪后返回数据库查询器, 供压缩流程写交互日志和读取冷却依据。 */
  public async 取数据库查询器(): Promise<Kysely<记忆数据库>> {
    await this.依赖.确保已初始化()
    return this.依赖.数据库查询器
  }

  public async 读取当前会话(): Promise<公开会话> {
    await this.依赖.确保已初始化()
    let 会话id = this.当前会话id值
    if (会话id === null) throw new Error('当前没有已经持久化的会话')
    let 会话 = await 存储查询会话(this.依赖.数据库查询器, 会话id)
    if (会话 === null) throw new Error(`会话不存在: ${会话id}`)
    return 会话
  }

  public async 切换会话(id: string): Promise<void> {
    await this.依赖.确保已初始化()
    let 会话 = await 存储查询会话(this.依赖.数据库查询器, id)
    if (会话 === null) throw new Error(`会话不存在: ${id}`)
    await this.激活会话(会话)
  }

  public async 恢复当前会话(): Promise<void> {
    let 会话id = this.当前会话id值
    if (会话id === null) return
    let 会话 = await 存储查询会话(this.依赖.数据库查询器, 会话id)
    if (会话 === null) throw new Error(`会话不存在: ${会话id}`)
    await this.激活会话(会话)
  }

  public async 读取会话消息(会话id: string): Promise<公开消息[]> {
    await this.依赖.确保已初始化()
    return await 存储读取会话消息(this.依赖.数据库查询器, 会话id)
  }

  public async 读取消息历史(消息id: string, 向上回溯条数?: number): Promise<公开消息[]> {
    await this.依赖.确保已初始化()
    return await 存储读取消息历史(this.依赖.数据库查询器, 消息id, 向上回溯条数)
  }

  public async 查询消息分支(消息id: string): Promise<公开消息[]> {
    await this.依赖.确保已初始化()
    return await 存储查询消息分支(this.依赖.数据库查询器, 消息id)
  }

  public async 检出消息(会话id: string, 消息id: string | null): Promise<void> {
    await this.依赖.确保已初始化()
    await 存储检出消息(this.依赖.数据库查询器, 会话id, 消息id)
    let 会话 = await 存储查询会话(this.依赖.数据库查询器, 会话id)
    if (会话 === null) throw new Error(`会话不存在: ${会话id}`)
    await this.激活会话(会话)
  }

  public async 更新会话标题(会话id: string, 标题: string): Promise<公开会话> {
    await this.依赖.确保已初始化()
    return await 存储更新会话标题(this.依赖.数据库查询器, 会话id, 标题)
  }

  public async 追加会话消息(选项: {
    会话id: string
    预期父消息id: string | null
    消息: 智能体消息类型
  }): Promise<公开消息> {
    await this.依赖.确保已初始化()
    let 新消息列表 = await 存储追加消息列表(this.依赖.数据库查询器, 选项.会话id, 选项.预期父消息id, [选项.消息])
    let 新消息 = 新消息列表[0]
    if (新消息 === undefined) throw new Error('未能追加消息')
    if (this.当前会话id值 === 选项.会话id) {
      let 会话 = await 存储查询会话(this.依赖.数据库查询器, 选项.会话id)
      if (会话 !== null) await this.激活会话(会话)
    }
    return 新消息
  }

  public async 创建派生会话(选项: 创建派生会话选项): Promise<公开会话> {
    await this.依赖.确保已初始化()
    let 前驱链 = await 存储读取消息历史(this.依赖.数据库查询器, 选项.前驱消息id)
    let 前驱末尾 = 前驱链.at(-1)
    if (前驱末尾 === undefined) throw new Error(`前驱消息不存在: ${选项.前驱消息id}`)
    let 系统消息 = 前驱链[0]?.消息
    if (系统消息 === undefined || 系统消息.role !== 'system') throw new Error('前驱会话缺少可复用的系统前缀')
    let 会话 = await 存储创建会话(this.依赖.数据库查询器, {
      标题: 选项.标题 ?? '压缩会话',
      前驱消息id: 选项.前驱消息id,
    })
    let { 持久化消息id: _原消息id, ...派生系统消息 } = 系统消息
    await 存储追加消息列表(this.依赖.数据库查询器, 会话.id, null, [
      派生系统消息,
      {
        role: 'system',
        content: 选项.摘要,
        compressionSourceSessionId: 前驱末尾.会话id,
        compressionSourceMessageId: 选项.前驱消息id,
      },
    ])
    let 已更新会话 = await 存储查询会话(this.依赖.数据库查询器, 会话.id)
    if (已更新会话 === null) throw new Error(`会话不存在: ${会话.id}`)
    await this.激活会话(已更新会话)
    return 已更新会话
  }

  public async 创建当前压缩派生会话(摘要: string, 标题?: string): Promise<公开会话> {
    await this.依赖.确保已初始化()
    let 会话id = this.当前会话id值
    let 消息id = this.当前消息id值
    if (会话id === null || 消息id === null) throw new Error('当前没有可压缩的持久化会话')
    let 历史 = await 存储读取消息历史(this.依赖.数据库查询器, 消息id)
    let 系统消息 = 历史[0]?.消息
    if (系统消息 === undefined || 系统消息.role !== 'system') throw new Error('当前会话缺少可复用的系统前缀')
    let { 持久化消息id: _原消息id, ...派生系统消息 } = 系统消息
    let 派生会话 = await 存储原子创建压缩派生会话(this.依赖.数据库查询器, {
      前驱会话id: 会话id,
      前驱消息id: 消息id,
      系统消息: 派生系统消息,
      摘要,
      标题: 标题 ?? this.依赖.模型语言包.压缩会话标题(),
    })
    await this.激活会话(派生会话)
    return 派生会话
  }

  public async 恢复导入会话(会话id: string | null): Promise<void> {
    if (会话id === null) {
      this.重置()
      return
    }
    let 会话 = await 存储查询会话(this.依赖.数据库查询器, 会话id)
    if (会话 === null) throw new Error(`完整状态中的当前会话不存在: ${会话id}`)
    await this.激活会话(会话)
  }

  public 创建消息搜索工具(最大结果数: number): 智能体工具 {
    let 工具 = 智能体工具.创建({
      名称: 'search_conversation_messages',
      描述:
        this.依赖.模型语言包.博闻强记消息搜索工具描述?.() ??
        '在当前会话及其压缩前驱链中搜索原始消息，不会读取其他会话或分支。',
      参数Schema: z.object({
        conversation_id: z.string().trim().min(1).optional(),
        message_id: z.string().trim().min(1).optional(),
        memory_id: z.string().trim().min(1).optional(),
        text: z.string().optional(),
        regex: z.string().max(1000).optional(),
        role: z.enum(['system', 'user', 'assistant', 'tool']).optional(),
        started_at: z.string().datetime().optional(),
        ended_before: z.string().datetime().optional(),
        context_count: z.number().int().min(0).max(50).default(0),
      }),
      返回值Schema: z.object({
        结果: z.enum(['成功', '失败']),
        错误信息: z.string().optional(),
        消息列表: z
          .array(
            z.object({
              id: z.string(),
              会话id: z.string(),
              角色: z.string(),
              内容: z.string().nullable(),
              创建时间: z.string(),
            }),
          )
          .optional(),
      }),
      实现: async (参数) => await this.搜索谱系消息(参数, 最大结果数),
    })
    return 智能体工具.创建模型适配(工具, {
      描述: 工具.描述,
      参数JSONSchema: {
        type: 'object',
        properties: {
          conversation_id: { type: 'string' },
          message_id: { type: 'string' },
          memory_id: { type: 'string' },
          text: { type: 'string' },
          regex: { type: 'string', maxLength: 1000 },
          role: { type: 'string', enum: ['system', 'user', 'assistant', 'tool'] },
          started_at: { type: 'string', format: 'date-time' },
          ended_before: { type: 'string', format: 'date-time' },
          context_count: {
            type: 'integer',
            minimum: 0,
            maximum: 50,
            default: 0,
            description: '为每条命中消息额外返回谱系顺序中的前后消息数，上下文消息不再受其他筛选条件过滤',
          },
        },
      },
      解析参数: (参数): Record<string, unknown> => 参数,
      转换返回值: (返回值): unknown => {
        let 已解析返回值 = z
          .object({
            结果: z.enum(['成功', '失败']),
            错误信息: z.string().optional(),
            消息列表: z
              .array(
                z.object({
                  id: z.string(),
                  会话id: z.string(),
                  角色: z.string(),
                  内容: z.string().nullable(),
                  创建时间: z.string(),
                }),
              )
              .optional(),
          })
          .parse(返回值)
        let { 结果, 错误信息, 消息列表 } = 已解析返回值
        return {
          status: 结果 === '成功' ? 'success' : 'failure',
          ...(错误信息 !== undefined ? { error: 错误信息 } : {}),
          ...(消息列表 !== undefined
            ? {
                messages: 消息列表.map((消息) => ({
                  message_id: 消息.id,
                  conversation_id: 消息.会话id,
                  role: 消息.角色,
                  content: 消息.内容,
                  created_at: 消息.创建时间,
                })),
              }
            : {}),
        }
      },
    })
  }

  private async 确保当前会话(): Promise<string> {
    if (this.当前会话id值 !== null) return this.当前会话id值
    let 会话 = await 存储创建会话(this.依赖.数据库查询器, {
      id: this.依赖.读取新会话标识(),
      标题: this.待创建会话标题,
    })
    this.当前会话id值 = 会话.id
    this.当前消息id值 = null
    this.已持久化消息数量 = 0
    return 会话.id
  }

  private async 激活会话(会话: 公开会话): Promise<void> {
    let 消息列表 = await 存储读取会话消息(this.依赖.数据库查询器, 会话.id)
    this.依赖.载入内存历史(
      消息列表.map((消息) => 消息.消息),
      会话.id,
    )
    this.当前会话id值 = 会话.id
    this.当前消息id值 = 会话.当前消息id
    this.已持久化消息数量 = 消息列表.length
  }

  private async 搜索谱系消息(
    参数: {
      conversation_id?: string | undefined
      message_id?: string | undefined
      memory_id?: string | undefined
      text?: string | undefined
      regex?: string | undefined
      role?: 'system' | 'user' | 'assistant' | 'tool' | undefined
      started_at?: string | undefined
      ended_before?: string | undefined
      context_count: number
    },
    最大结果数: number,
  ): Promise<{
    结果: '成功' | '失败'
    错误信息?: string
    消息列表?: Array<{ id: string; 会话id: string; 角色: string; 内容: string | null; 创建时间: string }>
  }> {
    await this.依赖.确保已初始化()
    let 会话id = this.当前会话id值
    if (会话id === null) return { 结果: '失败', 错误信息: this.依赖.模型语言包.无当前会话() }
    try {
      let 谱系消息 = await 读取当前会话谱系消息(this.依赖.数据库查询器, 会话id)
      let 允许消息id = new Set(谱系消息.map((消息) => 消息.id))
      let 记忆相关消息id: ReadonlySet<string> | undefined = undefined
      if (参数.memory_id !== undefined) {
        let 关系 = await 查询记忆新增相关消息(this.依赖.数据库查询器, 参数.memory_id, 允许消息id)
        记忆相关消息id = new Set(关系.map((项) => 项.消息id))
      }
      let 正则 = 参数.regex === undefined ? null : new RegExp(参数.regex, 'u')
      let 开始时间 = 参数.started_at === undefined ? null : new Date(参数.started_at)
      let 结束时间 = 参数.ended_before === undefined ? null : new Date(参数.ended_before)
      let 匹配列表 = 谱系消息.filter((消息): boolean => {
        let 内容值 = 'content' in 消息.消息 ? 消息.消息.content : null
        let 内容 = typeof 内容值 === 'string' ? 内容值 : JSON.stringify(消息.消息)
        return (
          (参数.conversation_id === undefined || 消息.会话id === 参数.conversation_id) &&
          (参数.message_id === undefined || 消息.id === 参数.message_id) &&
          (记忆相关消息id === undefined || 记忆相关消息id.has(消息.id)) &&
          (参数.role === undefined || 消息.消息.role === 参数.role) &&
          (参数.text === undefined || 内容.includes(参数.text)) &&
          (正则 === null || 正则.test(内容)) &&
          (开始时间 === null || 消息.创建时间 >= 开始时间) &&
          (结束时间 === null || 消息.创建时间 < 结束时间)
        )
      })
      匹配列表.sort((a, b): number => {
        let 时间差 = b.创建时间.getTime() - a.创建时间.getTime()
        return 时间差 !== 0 ? 时间差 : b.序号 - a.序号
      })
      let 命中列表 = 匹配列表.slice(0, 最大结果数)
      let 返回列表 = 命中列表
      if (参数.context_count > 0) {
        let 命中id = new Set(命中列表.map((消息) => 消息.id))
        let 返回索引 = new Set<number>()
        for (let 索引 = 0; 索引 < 谱系消息.length; 索引++) {
          let 消息 = 谱系消息[索引]
          if (消息 === undefined || 命中id.has(消息.id) === false) continue
          let 起点 = Math.max(0, 索引 - 参数.context_count)
          let 终点 = Math.min(谱系消息.length - 1, 索引 + 参数.context_count)
          for (let 上下文索引 = 起点; 上下文索引 <= 终点; 上下文索引++) 返回索引.add(上下文索引)
        }
        返回列表 = 谱系消息.filter((_消息, 索引) => 返回索引.has(索引))
      }
      return {
        结果: '成功',
        消息列表: 返回列表.map((消息) => {
          let 内容值 = 'content' in 消息.消息 ? 消息.消息.content : null
          return {
            id: 消息.id,
            会话id: 消息.会话id,
            角色: 消息.消息.role,
            内容: typeof 内容值 === 'string' ? 内容值 : null,
            创建时间: 消息.创建时间.toISOString(),
          }
        }),
      }
    } catch (错误) {
      return { 结果: '失败', 错误信息: 错误 instanceof Error ? 错误.message : String(错误) }
    }
  }
}
