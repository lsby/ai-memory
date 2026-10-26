import type { Kysely } from 'kysely'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { 智能体工具, type 智能体执行模式, type 智能体消息类型 } from '../../agent/types'
import {
  创建会话 as 存储创建会话,
  原子创建压缩派生会话 as 存储原子创建压缩派生会话,
  更新会话标题 as 存储更新会话标题,
  查询会话 as 存储查询会话,
  查询会话列表 as 存储查询会话列表,
  查询消息分支 as 存储查询消息分支,
  检出消息 as 存储检出消息,
  读取会话消息 as 存储读取会话消息,
  读取消息历史 as 存储读取消息历史,
  追加消息列表 as 存储追加消息列表,
} from '../storage/conversation-storage'
import type { 公开会话, 公开消息, 创建派生会话选项, 查询会话列表选项, 记忆数据库 } from '../types'

type 会话控制器依赖 = {
  数据库查询器: Kysely<记忆数据库>
  确保已初始化: () => Promise<void>
  读取新会话标识: () => string
  载入内存历史: (消息列表: 智能体消息类型[], 会话id: string) => void
  模型语言: 'zh-CN' | 'en-US'
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
    if (前驱末尾 === undefined || 前驱末尾.会话id !== 选项.前驱会话id) {
      throw new Error('前驱消息不属于指定的前驱会话')
    }
    let 系统消息 = 前驱链[0]?.消息
    if (系统消息 === undefined || 系统消息.role !== 'system') throw new Error('前驱会话缺少可复用的系统前缀')
    let 会话 = await 存储创建会话(this.依赖.数据库查询器, {
      标题: 选项.标题 ?? '压缩会话',
      前驱会话id: 选项.前驱会话id,
      前驱消息id: 选项.前驱消息id,
    })
    let { 持久化消息id: _原消息id, ...派生系统消息 } = 系统消息
    await 存储追加消息列表(this.依赖.数据库查询器, 会话.id, null, [
      派生系统消息,
      {
        role: 'system',
        content: 选项.摘要,
        compressionSourceSessionId: 选项.前驱会话id,
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
      标题: 标题 ?? (this.依赖.模型语言 === 'en-US' ? 'Compressed conversation' : '压缩会话'),
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

  public 创建历史阅读工具(): 智能体工具 {
    let 工具 = 智能体工具.创建({
      名称: 'read_conversation_history',
      描述:
        this.依赖.模型语言 === 'en-US'
          ? 'Read exact original messages from the current conversation lineage. Use previous_conversation after a summary has replaced earlier context.'
          : '读取当前会话谱系中的原始消息。摘要代替早期上下文后，使用 previous_conversation 查看准确原文。',
      参数Schema: z.object({
        source: z.enum(['previous_conversation', 'current_conversation']).default('previous_conversation'),
        history_ref: z.string().min(1).optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(50).default(20),
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
      实现: async ({ source, history_ref, offset, limit }) =>
        await this.读取谱系历史(source, history_ref, offset, limit),
    })
    return 智能体工具.创建模型适配(工具, {
      描述: 工具.描述,
      参数JSONSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['previous_conversation', 'current_conversation'] },
          history_ref: { type: 'string' },
          offset: { type: 'integer', minimum: 0, default: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
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

  private async 读取谱系历史(
    source: 'previous_conversation' | 'current_conversation',
    history_ref: string | undefined,
    offset: number,
    limit: number,
  ): Promise<{
    结果: '成功' | '失败'
    错误信息?: string
    消息列表?: Array<{ id: string; 会话id: string; 角色: string; 内容: string | null; 创建时间: string }>
  }> {
    await this.依赖.确保已初始化()
    let 会话id = this.当前会话id值
    if (会话id === null)
      return {
        结果: '失败',
        错误信息: this.依赖.模型语言 === 'en-US' ? 'There is no current persisted conversation.' : '当前没有持久化会话',
      }
    let 当前会话 = await 存储查询会话(this.依赖.数据库查询器, 会话id)
    let 实际目标消息id =
      history_ref ?? (source === 'previous_conversation' ? 当前会话?.前驱消息id : 当前会话?.当前消息id)
    if (实际目标消息id === null || 实际目标消息id === undefined)
      return {
        结果: '失败',
        错误信息:
          this.依赖.模型语言 === 'en-US'
            ? 'The current conversation has no readable history for this source.'
            : '当前会话没有可读取的历史消息',
      }
    let 锚点消息id = 当前会话?.当前消息id ?? null
    while (当前会话 !== null) {
      if (锚点消息id !== null) {
        let 谱系消息 = await 存储读取消息历史(this.依赖.数据库查询器, 锚点消息id, 100000)
        let 目标索引 = 谱系消息.findIndex((消息) => 消息.id === 实际目标消息id)
        if (目标索引 >= 0) {
          let 结束 = Math.max(0, 目标索引 + 1 - offset)
          let 起点 = Math.max(0, 结束 - limit)
          return {
            结果: '成功',
            消息列表: 谱系消息.slice(起点, 结束).map((消息) => {
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
        }
      }
      if (当前会话.前驱会话id === null || 当前会话.前驱消息id === null) break
      锚点消息id = 当前会话.前驱消息id
      当前会话 = await 存储查询会话(this.依赖.数据库查询器, 当前会话.前驱会话id)
    }
    return {
      结果: '失败',
      错误信息:
        this.依赖.模型语言 === 'en-US'
          ? 'The requested message is outside the current conversation lineage.'
          : '目标消息不在当前会话谱系中',
    }
  }
}
