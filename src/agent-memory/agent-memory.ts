import { PGlite, type PGliteOptions } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { Kysely, PGliteDialect } from 'kysely'
import path from 'node:path'
import type OpenAI from 'openai'
import { z } from 'zod'
import { 智能体 } from '../agent/agent'
import { type 智能体事件, type 智能体执行模式, type 智能体消息类型 } from '../agent/types'
import { 创建记忆提交, 回退记忆提交 as 外部回退记忆提交, 尝试清理空提交 } from './agent-memory-commit'
import {
  批量注入记忆 as 外部批量注入记忆,
  检查并清理二级记忆 as 外部检查并清理二级记忆,
  检查并降级一级记忆 as 外部检查并降级一级记忆,
} from './agent-memory-lifecycle'
import {
  更新记忆 as 外部更新记忆,
  查询动态工具 as 外部查询动态工具,
  查询记忆 as 外部查询记忆,
  查询记忆关联 as 外部查询记忆关联,
  查询记忆提交 as 外部查询记忆提交,
} from './agent-memory-management'
import { 定时任务入口 as 外部定时任务入口, 执行记忆重组 as 外部执行记忆重组 } from './agent-memory-reorganization'
import {
  保存快照 as 外部保存快照,
  导入完整状态 as 外部导入完整状态,
  导出完整状态 as 外部导出完整状态,
  载入快照 as 外部载入快照,
} from './agent-memory-snapshot'
import { 解决问题 as 外部解决问题 } from './agent-memory-solve'
import {
  清除共享初始化锁,
  获取共享任务队列锁,
  获取或创建PGlite,
  获取或创建共享初始化锁,
  设置共享任务队列锁,
  释放PGlite,
} from './agent-memory-storage'
import {
  批量注入记忆项Schema,
  type 公开动态工具,
  type 公开记忆,
  type 公开记忆关联,
  type 公开记忆提交,
  type 内部带记忆的智能体配置,
  type 带记忆的对话选项,
  type 带记忆的智能体选项,
  type 带记忆的解决问题选项,
  type 批量注入记忆项,
  type 更新记忆选项,
  type 查询记忆选项,
  type 记忆操作上下文,
  type 记忆数据库,
} from './agent-memory-types'
import { 初始化数据库 } from './tools/db-schema'
import {
  删除动态工具核心,
  更新动态工具核心,
  查看动态工具代码核心,
  注册动态工具核心,
  调用动态工具核心,
  type 动态工具上下文,
} from './tools/dynamic-tool-api'
import { 获取向量 as 外部获取向量 } from './tools/get-vector'
import { 全局排版 as 外部全局排版 } from './tools/layout'

export class 带记忆的智能体 extends 智能体 {
  private 配置: 内部带记忆的智能体配置
  private 内存数据库: PGlite
  private 数据库查询器: Kysely<记忆数据库>
  private 数据库是否已初始化: boolean = false
  private 初始化锁: Promise<void> | null = null
  private 是否使用全局缓存的PGlite: boolean = false
  private 任务队列锁: Promise<void> = Promise.resolve()
  private _已销毁 = false

  public constructor(选项: 带记忆的智能体选项) {
    super(选项)
    let 存储 = 选项.存储 ?? { 模式: '内存' as const }
    if (存储.模式 === '文件') 存储 = { 模式: '文件', 路径: path.resolve(存储.路径) }
    this.配置 = {
      ...选项,
      一级记忆容量: 选项.一级记忆容量 ?? 10,
      二级记忆遗忘分数阈值: 选项.二级记忆遗忘分数阈值 ?? 10.0,
      二级记忆数量上限: 选项.二级记忆数量上限 ?? 5000,
      二级记忆衰减常数k: 选项.二级记忆衰减常数k ?? 0.05,
      二级记忆访问次数上限: 选项.二级记忆访问次数上限 ?? 10000,
      向量模型: 选项.向量模型 ?? { 类型: '无' },
      自动检索二级记忆数量: 选项.自动检索二级记忆数量 ?? 2,
      自动检索二级记忆起点数: 选项.自动检索二级记忆起点数 ?? 5,
      自动检索动态工具数量: 选项.自动检索动态工具数量 ?? 3,
      向量相似度关联阈值: 选项.向量相似度关联阈值 ?? 0.6,
      存储,
    }
    let pglite选项: PGliteOptions = { extensions: { vector } }
    if (this.配置.存储.模式 === '文件') {
      this.内存数据库 = 获取或创建PGlite({ ...pglite选项, dataDir: this.配置.存储.路径 })
      this.是否使用全局缓存的PGlite = true
    } else {
      this.内存数据库 = new PGlite(pglite选项)
      this.是否使用全局缓存的PGlite = false
    }
    this.数据库查询器 = new Kysely<记忆数据库>({ dialect: new PGliteDialect({ pglite: this.内存数据库 }) })
  }

  public async 初始化(): Promise<void> {
    this.确保未销毁()
    if (this.数据库是否已初始化 === true) return

    if (this.初始化锁 === null) {
      let 初始化操作 = async (): Promise<void> => {
        await 初始化数据库(this.数据库查询器)
      }
      if (this.配置.存储.模式 === '文件') {
        let 路径 = this.配置.存储.路径
        this.初始化锁 = 获取或创建共享初始化锁(路径, 初始化操作)
      } else {
        this.初始化锁 = 初始化操作()
      }
    }
    try {
      await this.初始化锁
      this.数据库是否已初始化 = true
    } catch (error) {
      if (this.配置.存储.模式 === '文件') 清除共享初始化锁(this.配置.存储.路径)
      this.初始化锁 = null
      throw error
    }
  }

  private async 确保已初始化(): Promise<void> {
    this.确保未销毁()
    if (this.数据库是否已初始化 === false) {
      await this.初始化()
    }
  }

  private 确保未销毁(): void {
    if (this._已销毁 === true) throw new Error('智能体实例已销毁，不能继续访问记忆数据库')
  }

  private 构建操作上下文(trx: Kysely<记忆数据库>, 回调?: (事件: 智能体事件) => Promise<void>): 记忆操作上下文 {
    return {
      数据库查询器: trx,
      配置: this.配置,
      获取向量: async (内容) => await 外部获取向量(this.配置.向量模型, 内容, 回调),
      检查并降级一级记忆: async () =>
        await 外部检查并降级一级记忆(
          trx,
          this.配置,
          async (cb) => await 外部检查并清理二级记忆(trx, this.配置, cb),
          回调,
        ),
      检查并清理二级记忆: async () => await 外部检查并清理二级记忆(trx, this.配置, 回调),
      保存快照: async () => await 外部保存快照(trx),
      执行记忆变更: async <R>(消息: string, 操作: (上下文: 记忆操作上下文) => Promise<R>): Promise<R> => {
        if (trx.isTransaction === true) return await 操作(this.构建操作上下文(trx, 回调))
        return await this.执行记忆变更任务(消息, async (事务) => await 操作(this.构建操作上下文(事务, 回调)))
      },
      回调,
    }
  }

  private 构建动态操作上下文(trx: Kysely<记忆数据库>, 回调?: (事件: 智能体事件) => Promise<void>): 动态工具上下文 {
    let 上下文 = this.构建操作上下文(trx, 回调)
    return {
      ...上下文,
      获取向量: async (内容: string): Promise<number[] | null> => {
        let 结果 = await 上下文.获取向量(内容)
        return 结果.类型 === '成功' ? 结果.向量 : null
      },
    }
  }

  private 获取当前队列锁(): Promise<void> {
    if (this.配置.存储.模式 === '文件') {
      return 获取共享任务队列锁(this.配置.存储.路径)
    }
    return this.任务队列锁
  }

  private 设置当前队列锁(锁: Promise<void>): void {
    if (this.配置.存储.模式 === '文件') {
      设置共享任务队列锁(this.配置.存储.路径, 锁)
    } else {
      this.任务队列锁 = 锁
    }
  }

  private async 执行记忆变更任务<R>(
    消息: string,
    操作: (trx: Kysely<记忆数据库>, 父提交id: string | null) => Promise<R>,
  ): Promise<R> {
    await this.确保已初始化()

    let 释放锁: () => void = () => {}
    let 等待锁 = new Promise<void>((resolve) => {
      释放锁 = resolve
    })

    let 前置任务 = this.获取当前队列锁()
    this.设置当前队列锁(前置任务.then(() => 等待锁))

    await 前置任务.catch(() => {})

    try {
      return await this.数据库查询器.transaction().execute(async (trx) => {
        let sql = (await import('kysely')).sql
        let { commitId, parentCommitId } = await 创建记忆提交(trx, 消息)

        await sql`UPDATE _agent_session_commit SET commit_id = ${commitId} WHERE id = 1`.execute(trx)

        let result = await 操作(trx, parentCommitId)

        await 尝试清理空提交(trx, commitId, parentCommitId)
        await sql`UPDATE _agent_session_commit SET commit_id = NULL WHERE id = 1`.execute(trx)

        return result
      })
    } finally {
      释放锁()
    }
  }

  public async 批量注入记忆(记忆项列表: 批量注入记忆项[], 回调?: (事件: 智能体事件) => Promise<void>): Promise<void> {
    let 已校验记忆项列表 = 批量注入记忆项Schema.array().parse(记忆项列表)
    await this.执行记忆变更任务('批量注入记忆', async (trx) => {
      let 上下文 = this.构建操作上下文(trx, 回调)
      await 外部批量注入记忆(上下文, 已校验记忆项列表)
    })
  }

  public async 添加记忆(记忆项: 批量注入记忆项, 回调?: (事件: 智能体事件) => Promise<void>): Promise<公开记忆> {
    let 已校验记忆项 = 批量注入记忆项Schema.parse(记忆项)
    let id = await this.执行记忆变更任务('添加记忆', async (trx): Promise<string> => {
      let id列表 = await 外部批量注入记忆(this.构建操作上下文(trx, 回调), [已校验记忆项])
      let 新id = id列表[0]
      if (新id === undefined) throw new Error('添加记忆后未获得记忆 ID')
      return 新id
    })
    let 记忆 = await this.查找记忆(id)
    if (记忆 === null) throw new Error(`添加记忆后无法读取记忆: ${id}`)
    return 记忆
  }

  public async 查询记忆(选项: 查询记忆选项 = {}): Promise<公开记忆[]> {
    await this.确保已初始化()
    return await 外部查询记忆(this.数据库查询器, 选项)
  }

  public async 查找记忆(id: string): Promise<公开记忆 | null> {
    let 记忆列表 = await this.查询记忆()
    return 记忆列表.find((记忆) => 记忆.id === id) ?? null
  }

  public async 删除记忆(id: string): Promise<boolean> {
    let 已校验id = z.string().trim().min(1).parse(id)
    return await this.执行记忆变更任务('删除记忆', async (trx): Promise<boolean> => {
      let 结果 = await trx.deleteFrom('记忆表').where('id', '=', 已校验id).executeTakeFirst()
      return Number(结果.numDeletedRows) > 0
    })
  }

  public async 更新记忆(
    id: string,
    选项: 更新记忆选项,
    回调?: (事件: 智能体事件) => Promise<void>,
  ): Promise<公开记忆 | null> {
    let 已校验id = z.string().trim().min(1).parse(id)
    let 是否存在 = await this.执行记忆变更任务(
      '更新记忆',
      async (trx) => await 外部更新记忆(this.构建操作上下文(trx, 回调), 已校验id, 选项),
    )
    return 是否存在 ? await this.查找记忆(已校验id) : null
  }

  public async 查询记忆关联(id?: string): Promise<公开记忆关联[]> {
    await this.确保已初始化()
    return await 外部查询记忆关联(this.数据库查询器, id)
  }

  public async 查询动态工具(): Promise<公开动态工具[]> {
    await this.确保已初始化()
    return await 外部查询动态工具(this.数据库查询器)
  }

  public async 查询记忆提交(数量: number = 50): Promise<公开记忆提交[]> {
    await this.确保已初始化()
    return await 外部查询记忆提交(this.数据库查询器, 数量)
  }

  /** 将最近一次记忆变更反向应用为一个新提交；不会改写或删除已有提交历史。 */
  public async 回退最近记忆提交(): Promise<boolean> {
    return await this.执行记忆变更任务('回退最近记忆提交', async (trx, 父提交id): Promise<boolean> => {
      if (父提交id === null) return false
      return await 外部回退记忆提交(trx, 父提交id)
    })
  }

  public async 检查并清理二级记忆(回调?: (事件: 智能体事件) => Promise<void>): Promise<void> {
    await this.执行记忆变更任务('检查并清理二级记忆', async (trx) => {
      await 外部检查并清理二级记忆(trx, this.配置, 回调)
    })
  }

  public async 执行记忆重组(选项: {
    openai客户端: OpenAI
    模型名称: string
    当前时间?: Date
    种子关键词?: string[]
    回调?: (事件: 智能体事件) => Promise<void>
  }): Promise<void> {
    await this.确保已初始化()
    await 外部执行记忆重组(
      this.数据库查询器,
      async <T extends z.ZodType>(s: 带记忆的解决问题选项<T>) =>
        await this.执行回合({ ...s, 消息历史: s.消息历史 ?? [] }),
      选项,
    )
  }

  /**
   * 定时任务统一入口
   * 可以被外部定时器（如 cron 或 setTimeout）周期性调用，用于维护记忆网络和触发自主活动。
   * 包含一级记忆降级、二级记忆遗忘曲线清理以及可选的自动记忆重组。
   */
  public async 定时任务入口(选项?: {
    当前时间?: Date
    回调?: (事件: 智能体事件) => Promise<void>
    openai客户端?: OpenAI
    模型名称?: string
  }): Promise<void> {
    await this.确保已初始化()
    let 上下文 = this.构建操作上下文(this.数据库查询器, 选项?.回调)
    await 外部定时任务入口(
      上下文,
      async <T extends z.ZodType>(s: 带记忆的解决问题选项<T>) =>
        await this.执行回合({ ...s, 消息历史: s.消息历史 ?? [] }),
      选项,
    )
  }

  public override async 对话<T extends z.ZodType>(
    选项: 带记忆的对话选项<T>,
  ): Promise<{
    结果: z.infer<T> | null
    消息列表: 智能体消息类型[]
    新增上下文: 智能体消息类型[]
    结束原因?: '中断' | '超出最大轮次' | '提取结构化数据失败' | '校验失败次数超出上限'
  }> {
    return await super.对话(选项)
  }

  public override async 推演<T extends z.ZodType>(
    选项: 带记忆的对话选项<T>,
  ): Promise<{
    结果: z.infer<T> | null
    消息列表: 智能体消息类型[]
    新增上下文: 智能体消息类型[]
    结束原因?: '中断' | '超出最大轮次' | '提取结构化数据失败' | '校验失败次数超出上限'
  }> {
    return await super.推演(选项)
  }

  protected override async 执行解决问题<T extends z.ZodType>(
    选项: 带记忆的解决问题选项<T>,
    执行模式: 智能体执行模式,
    首次请求是否新建对话: boolean = false,
    更新当前会话审计状态: boolean = false,
  ): Promise<{
    结果: z.infer<T> | null
    消息列表: 智能体消息类型[]
    新增上下文: 智能体消息类型[]
    结束原因?: '中断' | '超出最大轮次' | '提取结构化数据失败' | '校验失败次数超出上限'
  }> {
    let 简短命令 = 选项.命令.replace(/\n/g, ' ')
    let 标题 = 选项.标题 ?? `对话: ${简短命令.slice(0, 20)}`
    if (执行模式 === '推演') {
      await this.确保已初始化()
      let 上下文 = this.构建操作上下文(this.数据库查询器, 选项.回调)
      return await 外部解决问题(
        上下文,
        选项,
        async (新选项) => await super.执行解决问题(新选项, 执行模式, 首次请求是否新建对话, 更新当前会话审计状态),
        执行模式,
      )
    }
    await this.确保已初始化()
    let 上下文 = this.构建操作上下文(this.数据库查询器, 选项.回调)
    return await 外部解决问题(
      上下文,
      { ...选项, 标题 },
      async (新选项) => await super.执行解决问题(新选项, 执行模式, 首次请求是否新建对话, 更新当前会话审计状态),
      执行模式,
    )
  }

  public async 私有反思<T extends z.ZodType>(
    选项: 带记忆的对话选项<T>,
  ): Promise<{
    结果: z.infer<T> | null
    消息列表: 智能体消息类型[]
    新增上下文: 智能体消息类型[]
    结束原因?: '中断' | '超出最大轮次' | '提取结构化数据失败' | '校验失败次数超出上限'
  }> {
    let 新选项 = {
      ...选项,
      标题: '私有反思',
      命令: `[系统事件:私有反思] 你刚才经历了以下事件或产生了以下思绪：\n${选项.命令}\n请根据此情况，自主决定是否需要使用工具（如更新记忆等），并在反思结束后返回期望的结果。本轮反思不会写入对话历史。`,
    }
    return await this.执行不追加历史的对话(新选项)
  }

  /** 将反思过程作为一轮正常对话写入会话历史。 */
  public async 会话反思<T extends z.ZodType>(
    选项: 带记忆的对话选项<T>,
  ): Promise<{
    结果: z.infer<T> | null
    消息列表: 智能体消息类型[]
    新增上下文: 智能体消息类型[]
    结束原因?: '中断' | '超出最大轮次' | '提取结构化数据失败' | '校验失败次数超出上限'
  }> {
    let 新选项 = {
      ...选项,
      标题: '会话反思',
      命令: `[系统事件:会话反思] 你刚才经历了以下事件或产生了以下思绪：\n${选项.命令}\n请根据此情况，自主决定是否需要使用工具（如更新记忆等），并在反思结束后返回期望的结果。本轮反思会写入对话历史。`,
    }
    return await this.对话(新选项)
  }

  public async 保存快照(): Promise<string> {
    await this.确保已初始化()
    return await 外部保存快照(this.数据库查询器)
  }

  public async 载入快照(json字符串: string): Promise<void> {
    await this.执行记忆变更任务('载入快照', async (trx) => {
      await 外部载入快照(trx, json字符串)
    })
  }

  public override async 导出完整状态(当前消息历史?: 智能体消息类型[]): Promise<string> {
    await this.确保已初始化()
    return await 外部导出完整状态(this.数据库查询器, 当前消息历史 ?? this.读取对话历史(), this.读取会话标识())
  }

  public override async 导入完整状态(状态数据: string): Promise<智能体消息类型[]> {
    let 状态 = await this.执行记忆变更任务('导入完整状态', async (trx) => await 外部导入完整状态(trx, 状态数据))
    this.载入对话历史(状态.消息历史, 状态.会话标识)
    return this.读取对话历史()
  }

  public async 整理布局(): Promise<void> {
    await this.执行记忆变更任务('整理布局', async (trx) => {
      await 外部全局排版(trx)
    })
  }

  public async 注册动态工具(
    代码: string,
    测试参数_json: string,
    回调?: (事件: 智能体事件) => Promise<void>,
  ): Promise<{ 结果: '成功' | '失败'; id?: string; 工具名称?: string; 测试执行输出?: string; 错误信息?: string }> {
    return await this.执行记忆变更任务('编程接入: 注册动态工具', async (trx) => {
      let 动态上下文 = this.构建动态操作上下文(trx, 回调)
      return await 注册动态工具核心(动态上下文, { 代码, 测试参数_json })
    })
  }

  public async 查看动态工具(
    工具标识: string,
  ): Promise<{ 结果: '成功' | '失败'; id?: string; 名称?: string; 描述?: string; 代码?: string; 错误信息?: string }> {
    await this.确保已初始化()
    let 动态上下文 = this.构建动态操作上下文(this.数据库查询器)
    return await 查看动态工具代码核心(动态上下文, { 工具标识 })
  }

  public async 更新动态工具(
    工具标识: string,
    新代码: string,
    测试参数_json: string,
    回调?: (事件: 智能体事件) => Promise<void>,
  ): Promise<{ 结果: '成功' | '失败'; 测试执行输出?: string; 错误信息?: string }> {
    return await this.执行记忆变更任务('编程接入: 更新动态工具', async (trx) => {
      let 动态上下文 = this.构建动态操作上下文(trx, 回调)
      return await 更新动态工具核心(动态上下文, { 工具标识, 新代码, 测试参数_json })
    })
  }

  public async 删除动态工具(
    工具标识: string,
    回调?: (事件: 智能体事件) => Promise<void>,
  ): Promise<{ 结果: '成功' | '失败'; 错误信息?: string }> {
    return await this.执行记忆变更任务('编程接入: 删除动态工具', async (trx) => {
      let 动态上下文 = this.构建动态操作上下文(trx, 回调)
      return await 删除动态工具核心(动态上下文, { 工具标识 })
    })
  }

  public async 调用动态工具(
    工具名称: string,
    参数json: string,
    回调?: (事件: 智能体事件) => Promise<void>,
  ): Promise<{ 结果: '成功' | '失败'; 执行输出?: string; 错误信息?: string }> {
    await this.确保已初始化()
    let 动态上下文 = this.构建动态操作上下文(this.数据库查询器, 回调)
    return await 调用动态工具核心(动态上下文, { name: 工具名称, arguments: 参数json })
  }

  public async 销毁(): Promise<void> {
    if (this._已销毁) return
    this._已销毁 = true

    try {
      // 只有在非全局缓存模式下才销毁 kysely，因为 kysely.destroy 会关闭底层连接
      if (!this.是否使用全局缓存的PGlite) {
        await this.数据库查询器.destroy()
      }
    } catch (_e) {}

    if (this.是否使用全局缓存的PGlite && this.配置.存储.模式 === '文件') {
      await 释放PGlite(this.配置.存储.路径)
    } else {
      try {
        await this.内存数据库.close()
      } catch (_e) {}
    }
  }
}
