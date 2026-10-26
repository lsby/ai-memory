import type { Kysely } from 'kysely'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { 智能体工具, type 智能体执行模式, type 智能体消息类型 } from '../../agent/types'
import {
  创建会话 as 存储创建会话,
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
    return 智能体工具.创建({
      名称: 'read_conversation_history',
      描述: 'Read original messages from the current immutable conversation lineage. Omit the target message ID to read from the compressed predecessor snapshot.',
      参数Schema: z.object({
        目标消息id: z.string().min(1).optional(),
        向上回溯条数: z.number().int().min(1).max(50).default(10),
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
      实现: async ({ 目标消息id, 向上回溯条数 }) => await this.读取谱系历史(目标消息id, 向上回溯条数),
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
    目标消息id: string | undefined,
    向上回溯条数: number,
  ): Promise<{
    结果: '成功' | '失败'
    错误信息?: string
    消息列表?: Array<{ id: string; 会话id: string; 角色: string; 内容: string | null; 创建时间: string }>
  }> {
    await this.依赖.确保已初始化()
    let 会话id = this.当前会话id值
    if (会话id === null) return { 结果: '失败', 错误信息: '当前没有持久化会话' }
    let 当前会话 = await 存储查询会话(this.依赖.数据库查询器, 会话id)
    let 实际目标消息id = 目标消息id ?? 当前会话?.前驱消息id ?? 当前会话?.当前消息id
    if (实际目标消息id === null || 实际目标消息id === undefined)
      return { 结果: '失败', 错误信息: '当前会话没有可读取的历史消息' }
    let 锚点消息id = 当前会话?.当前消息id ?? null
    while (当前会话 !== null) {
      if (锚点消息id !== null) {
        let 谱系消息 = await 存储读取消息历史(this.依赖.数据库查询器, 锚点消息id, 100000)
        let 目标索引 = 谱系消息.findIndex((消息) => 消息.id === 实际目标消息id)
        if (目标索引 >= 0) {
          let 起点 = Math.max(0, 目标索引 - 向上回溯条数 + 1)
          return {
            结果: '成功',
            消息列表: 谱系消息.slice(起点, 目标索引 + 1).map((消息) => {
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
    return { 结果: '失败', 错误信息: '目标消息不在当前会话谱系中' }
  }
}
