import { 执行压缩当前会话 } from '../../agent-memory/operations/conversation-compression'
import { 会话控制器 } from '../../agent-memory/operations/conversation-controller'
import type { 公开会话, 公开消息, 创建派生会话选项, 压缩当前会话选项, 查询会话列表选项 } from '../../agent-memory/types'
import type { 智能体执行模式, 智能体消息类型, 智能体选项 } from '../types'
import { 智能体 } from './agent'

/** 为拥有 PGlite 存储的智能体提供公共会话 API，具体存储生命周期由子类负责。 */
export abstract class 持久化会话智能体 extends 智能体 {
  private 会话控制器值: 会话控制器 | undefined

  public constructor(选项: 智能体选项) {
    super(选项)
  }

  protected 初始化会话控制器(控制器: 会话控制器): void {
    if (this.工具列表.some((工具) => 工具.名称 === 'read_conversation_history')) {
      throw new Error('工具名称 read_conversation_history 是持久化会话的保留名称')
    }
    this.会话控制器值 = 控制器
    this.工具列表.push(控制器.创建历史阅读工具())
  }

  protected 会话控制器(): 会话控制器 {
    if (this.会话控制器值 === undefined) throw new Error('持久化会话控制器尚未初始化')
    return this.会话控制器值
  }

  protected override async 同步对话消息(消息列表: 智能体消息类型[], 执行模式: 智能体执行模式): Promise<void> {
    await this.会话控制器().同步消息(消息列表, 执行模式)
  }

  protected override async 恢复持久化对话(): Promise<void> {
    await this.会话控制器().恢复当前会话()
  }

  public override 重置对话(): void {
    super.重置对话()
    this.会话控制器().重置()
  }

  public override 载入对话历史(消息历史: 智能体消息类型[], 会话标识?: string): void {
    super.载入对话历史(消息历史, 会话标识)
    this.会话控制器().重置()
  }

  /** 新建并切换到一个空会话。 */
  public async 创建会话(选项: { 标题?: string | undefined } = {}): Promise<公开会话> {
    return await this.执行会话任务(async (): Promise<公开会话> => await this.会话控制器().创建会话(选项))
  }

  public async 查询会话(id: string): Promise<公开会话 | null> {
    return await this.会话控制器().查询会话(id)
  }

  public async 查询会话列表(选项: 查询会话列表选项 = {}): Promise<公开会话[]> {
    return await this.会话控制器().查询会话列表(选项)
  }

  public async 读取当前会话(): Promise<公开会话> {
    return await this.会话控制器().读取当前会话()
  }

  public async 切换会话(id: string): Promise<void> {
    await this.执行会话任务(async (): Promise<void> => await this.会话控制器().切换会话(id))
  }

  public async 读取会话消息(会话id: string): Promise<公开消息[]> {
    return await this.会话控制器().读取会话消息(会话id)
  }

  public async 读取消息历史(消息id: string, 向上回溯条数?: number): Promise<公开消息[]> {
    return await this.会话控制器().读取消息历史(消息id, 向上回溯条数)
  }

  public async 查询消息分支(消息id: string): Promise<公开消息[]> {
    return await this.会话控制器().查询消息分支(消息id)
  }

  public async 检出消息(会话id: string, 消息id: string | null): Promise<void> {
    await this.执行会话任务(async (): Promise<void> => await this.会话控制器().检出消息(会话id, 消息id))
  }

  public async 更新会话标题(会话id: string, 标题: string): Promise<公开会话> {
    return await this.会话控制器().更新会话标题(会话id, 标题)
  }

  public async 追加会话消息(选项: {
    会话id: string
    预期父消息id: string | null
    消息: 智能体消息类型
  }): Promise<公开消息> {
    return await this.执行会话任务(async (): Promise<公开消息> => await this.会话控制器().追加会话消息(选项))
  }

  /** 从前驱消息快照创建摘要会话，并立即切换到新会话。 */
  public async 创建派生会话(选项: 创建派生会话选项): Promise<公开会话> {
    return await this.执行会话任务(async (): Promise<公开会话> => await this.会话控制器().创建派生会话(选项))
  }

  public async 压缩当前会话(选项: 压缩当前会话选项): Promise<公开会话> {
    return await this.执行会话任务(async () => await 执行压缩当前会话(this.会话控制器(), this.模型语言包, 选项))
  }
}
