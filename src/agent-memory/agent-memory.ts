import { PGlite, type PGliteOptions } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { Kysely } from 'kysely'
import type OpenAI from 'openai'
import { z } from 'zod'
import { 持久化会话智能体 } from '../agent/core/persistent-conversation-agent'
import { type 回合结果, type 智能体事件, type 智能体执行模式, type 智能体消息类型 } from '../agent/types'
import { 构建智能体配置 } from './config'
import { 创建向量缓存 as 外部创建向量缓存, 构建操作上下文 as 外部构建操作上下文, type 上下文依赖 } from './context'
import { 批量注入记忆 as 外部批量注入记忆, 检查并清理二级记忆 as 外部检查并清理二级记忆 } from './lifecycle'
import {
  查询交互日志 as 外部查询交互日志,
  记录交互日志 as 外部记录交互日志,
  执行带日志的分支切换,
  执行带日志的推理流程,
  执行带日志的记忆变更,
  转为JSON值,
} from './logger'
import {
  切换记忆提交 as 外部切换记忆提交,
  回退到父记忆提交 as 外部回退到父记忆提交,
  获取当前提交ID,
} from './operations/commit'
import { 会话控制器 } from './operations/conversation-controller'
import * as 动态工具管理 from './operations/dynamic-management'
import {
  更新记忆 as 外部更新记忆,
  查询动态工具 as 外部查询动态工具,
  查询记忆 as 外部查询记忆,
  查询记忆关联 as 外部查询记忆关联,
  查询记忆提交 as 外部查询记忆提交,
} from './operations/management'
import { 定时任务入口 as 外部定时任务入口, 执行记忆重组 as 外部执行记忆重组 } from './operations/reorganization'
import { 解决问题 as 外部解决问题 } from './operations/solve'
import { 带互斥的PGlite方言, 默认schema } from './storage/connection'
import { 清除共享初始化锁, 获取或创建PGlite, 获取或创建共享初始化锁, 销毁存储 } from './storage/memory-storage'
import {
  保存快照 as 外部保存快照,
  导入完整状态 as 外部导入完整状态,
  导出完整状态 as 外部导出完整状态,
  载入快照 as 外部载入快照,
} from './storage/snapshot'
import { 新向量缓存, type 向量缓存 } from './storage/vector-cache'
import { 初始化数据库 } from './tools/db-schema'
import { 全局排版 as 外部全局排版 } from './tools/layout'
import {
  批量注入记忆项Schema,
  type 交互日志事件,
  type 公开交互日志,
  type 公开前缀快照,
  type 公开动态工具,
  type 公开记忆,
  type 公开记忆关联,
  type 公开记忆提交,
  type 内部带记忆的智能体配置,
  type 内部带记忆的解决问题选项,
  type 带记忆的对话选项,
  type 带记忆的智能体选项,
  type 带记忆的解决问题选项,
  type 批量注入记忆项,
  type 更新记忆选项,
  type 查询交互日志选项,
  type 查询记忆选项,
  type 记忆数据库,
} from './types'

export class 带记忆的智能体 extends 持久化会话智能体 {
  private 配置: 内部带记忆的智能体配置
  private PGlite就绪: Promise<PGlite>
  private 数据库查询器: Kysely<记忆数据库>
  private schema名: string
  private readonly 上下文依赖: 上下文依赖
  private readonly 记忆提示词文本: string
  private 数据库是否已初始化: boolean = false
  private 初始化锁: Promise<void> | null = null
  private _已销毁 = false

  public constructor(选项: 带记忆的智能体选项) {
    super(选项)
    let { 配置, 记忆提示词文本 } = 构建智能体配置(选项)
    this.配置 = 配置
    this.记忆提示词文本 = 记忆提示词文本
    let 存储 = 配置.存储
    this.schema名 = 存储.schema ?? 默认schema
    this.上下文依赖 = { 配置: this.配置, 执行记忆变更任务: this.执行记忆变更任务.bind(this) }
    let pglite选项: PGliteOptions = { extensions: { vector } }
    switch (存储.模式) {
      case '内存':
        this.PGlite就绪 = Promise.resolve(new PGlite(pglite选项))
        break
      case '文件':
        this.PGlite就绪 = 获取或创建PGlite({ ...pglite选项, dataDir: 存储.路径 })
        break
      case '外部':
        this.PGlite就绪 = Promise.resolve(存储.pglite)
        break
    }
    // 打开失败（如目录被占用）时错误在 初始化() 里抛出；这里先挂一个空处理，避免实例没被使用时出现未处理的拒绝
    this.PGlite就绪.catch((): void => {})
    this.数据库查询器 = new Kysely<记忆数据库>({
      dialect: new 带互斥的PGlite方言(async (): Promise<PGlite> => await this.PGlite就绪, this.schema名),
    })
    this.初始化会话控制器(
      new 会话控制器({
        数据库查询器: this.数据库查询器,
        确保已初始化: async (): Promise<void> => await this.确保已初始化(),
        读取新会话标识: (): string => this.读取会话标识(),
        载入内存历史: (消息列表, 会话id): void => super.载入对话历史(消息列表, 会话id),
      }),
    )
  }

  /** 记忆操作指南是前缀的一部分, 固定拼在系统提示词里 */
  protected override 提供附加系统提示词(): string | undefined {
    return this.记忆提示词文本
  }

  public async 初始化(): Promise<void> {
    this.确保未销毁()
    if (this.数据库是否已初始化 === true) return

    if (this.初始化锁 === null) {
      let 初始化操作 = async (): Promise<void> => {
        await 初始化数据库(this.数据库查询器, this.schema名)
      }
      if (this.配置.存储.模式 === '文件') {
        let 路径 = this.配置.存储.路径
        this.初始化锁 = 获取或创建共享初始化锁(路径, this.schema名, 初始化操作)
      } else {
        this.初始化锁 = 初始化操作()
      }
    }
    try {
      await this.初始化锁
      this.数据库是否已初始化 = true
    } catch (error) {
      if (this.配置.存储.模式 === '文件') 清除共享初始化锁(this.配置.存储.路径, this.schema名)
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

  /**
   * 在一个事务里执行记忆变更。连接互斥锁由底层 driver 负责（事务从 BEGIN 到 COMMIT 一直占着锁）。
   * 事务内取向量只读缓存；如果操作里有人要了没预取的文本，整个事务回滚，
   * 在事务外补算向量后重试，事务内绝不发网络请求。
   */
  private async 执行记忆变更任务<R>(
    消息: string,
    操作: (trx: Kysely<记忆数据库>, 父提交id: string | null) => Promise<R>,
    缓存: 向量缓存 = 新向量缓存(),
    回调?: (事件: 智能体事件) => Promise<void>,
    事件组id?: string,
  ): Promise<R> {
    await this.确保已初始化()
    return await 执行带日志的记忆变更(this.数据库查询器, this.配置, 消息, 操作, 缓存, 回调, 事件组id)
  }

  private async 执行无向量记忆变更任务<R>(
    消息: string,
    操作: (trx: Kysely<记忆数据库>, 父提交id: string | null) => Promise<R>,
    事件组id?: string,
    回调?: (事件: 智能体事件) => Promise<void>,
  ): Promise<R> {
    return await this.执行记忆变更任务(消息, 操作, undefined, 回调, 事件组id)
  }

  private 获取动态工具管理依赖(): 动态工具管理.动态工具管理依赖 {
    return {
      配置: this.配置,
      上下文依赖: this.上下文依赖,
      数据库查询器: this.数据库查询器,
      确保已初始化: this.确保已初始化.bind(this),
      执行记忆变更任务: this.执行记忆变更任务.bind(this),
    }
  }

  public async 批量注入记忆(
    记忆项列表: 批量注入记忆项[],
    回调?: (事件: 智能体事件) => Promise<void>,
    事件组id?: string,
  ): Promise<void> {
    let 已校验记忆项列表 = 批量注入记忆项Schema.array().parse(记忆项列表)
    let 缓存 = await 外部创建向量缓存(
      this.配置,
      已校验记忆项列表.map((项) => 项.内容),
      回调,
    )
    await this.执行记忆变更任务(
      '批量注入记忆',
      async (trx) => {
        let 上下文 = 外部构建操作上下文(this.上下文依赖, trx, 回调, 缓存)
        await 外部批量注入记忆(上下文, 已校验记忆项列表)
      },
      缓存,
      回调,
      事件组id,
    )
  }

  public async 添加记忆(
    记忆项: 批量注入记忆项,
    回调?: (事件: 智能体事件) => Promise<void>,
    事件组id?: string,
  ): Promise<公开记忆> {
    let 已校验记忆项 = 批量注入记忆项Schema.parse(记忆项)
    let 缓存 = await 外部创建向量缓存(this.配置, [已校验记忆项.内容], 回调)
    let id = await this.执行记忆变更任务(
      '添加记忆',
      async (trx): Promise<string> => {
        let id列表 = await 外部批量注入记忆(外部构建操作上下文(this.上下文依赖, trx, 回调, 缓存), [已校验记忆项])
        let 新id = id列表[0]
        if (新id === undefined) throw new Error('添加记忆后未获得记忆 ID')
        return 新id
      },
      缓存,
      回调,
      事件组id,
    )
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

  public async 移除记忆(id: string, 事件组id?: string): Promise<boolean> {
    let 已校验id = z.string().trim().min(1).parse(id)
    return await this.执行无向量记忆变更任务(
      '从当前状态移除记忆',
      async (trx): Promise<boolean> => {
        await trx
          .deleteFrom('记忆关联表')
          .where((eb) => eb.or([eb('起点id', '=', 已校验id), eb('终点id', '=', 已校验id)]))
          .execute()
        let 结果 = await trx.deleteFrom('记忆表').where('id', '=', 已校验id).executeTakeFirst()
        return Number(结果.numDeletedRows) > 0
      },
      事件组id,
    )
  }

  public async 更新记忆(
    id: string,
    选项: 更新记忆选项,
    回调?: (事件: 智能体事件) => Promise<void>,
    事件组id?: string,
  ): Promise<公开记忆 | null> {
    let 已校验id = z.string().trim().min(1).parse(id)
    let 缓存 = await 外部创建向量缓存(this.配置, typeof 选项.内容 === 'string' ? [选项.内容.trim()] : [], 回调)
    let 是否存在 = await this.执行记忆变更任务(
      '更新记忆',
      async (trx) => await 外部更新记忆(外部构建操作上下文(this.上下文依赖, trx, 回调, 缓存), 已校验id, 选项),
      缓存,
      回调,
      事件组id,
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

  /** 追加一条强类型交互事件；事件组 ID 不传时自动生成并通过返回值带回。 */
  public async 记录交互日志(事件: 交互日志事件, 事件组id?: string): Promise<公开交互日志> {
    await this.确保已初始化()
    return await 外部记录交互日志(this.数据库查询器, 事件, 事件组id)
  }

  /** 按物理序号读取交互事件；可按事件组或事件类型筛选。 */
  public async 查询交互日志(选项: 查询交互日志选项 = {}): Promise<公开交互日志[]> {
    await this.确保已初始化()
    return await 外部查询交互日志(this.数据库查询器, 选项)
  }

  public async 查询前缀快照(id: string): Promise<公开前缀快照 | null> {
    await this.确保已初始化()
    let 已校验id = z.string().trim().min(1).parse(id)
    let 快照 = await this.数据库查询器
      .selectFrom('前缀快照表')
      .selectAll()
      .where('id', '=', 已校验id)
      .executeTakeFirst()
    return 快照 ?? null
  }

  /** 返回当前记忆分支的 HEAD；尚无提交时返回 null。 */
  public async 查询当前记忆提交id(): Promise<string | null> {
    await this.确保已初始化()
    return await 获取当前提交ID(this.数据库查询器)
  }

  /** 切换到指定提交的完整状态；已有提交不会被删除，之后的新提交将从该提交产生分支。 */
  public async 切换记忆提交(提交id: string, 事件组id?: string): Promise<boolean> {
    let 已校验提交id = z.string().trim().min(1).parse(提交id)
    await this.确保已初始化()
    return await 执行带日志的分支切换(
      this.数据库查询器,
      '切换记忆提交',
      { 目标提交id: 已校验提交id },
      async (trx) => await 外部切换记忆提交(trx, 已校验提交id),
      事件组id,
    )
  }

  /** 将 HEAD 切换到当前提交的父提交；不会生成反向提交，也不会删除原分支。 */
  public async 回退最近记忆提交(事件组id?: string): Promise<boolean> {
    await this.确保已初始化()
    return await 执行带日志的分支切换(
      this.数据库查询器,
      '回退最近记忆提交',
      {},
      async (trx) => await 外部回退到父记忆提交(trx),
      事件组id,
    )
  }

  public async 检查并清理二级记忆(回调?: (事件: 智能体事件) => Promise<void>, 事件组id?: string): Promise<void> {
    await this.执行无向量记忆变更任务(
      '检查并清理二级记忆',
      async (trx) => {
        await 外部检查并清理二级记忆(trx, this.配置, 回调)
      },
      事件组id,
      回调,
    )
  }

  public async 执行记忆重组(选项: {
    openai客户端: OpenAI
    模型名称: string
    当前时间?: Date
    种子关键词?: string[]
    回调?: (事件: 智能体事件) => Promise<void>
    事件组id?: string
  }): Promise<void> {
    await this.确保已初始化()
    await 外部执行记忆重组(
      this.数据库查询器,
      async <T extends z.ZodType>(s: 带记忆的解决问题选项<T>) =>
        await this.执行回合({ ...s, 消息历史: s.消息历史 ?? [], 事件组id: 选项.事件组id ?? s.事件组id }),
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
    事件组id?: string
  }): Promise<void> {
    await this.确保已初始化()
    let 上下文 = 外部构建操作上下文(this.上下文依赖, this.数据库查询器, 选项?.回调, undefined, 选项?.事件组id)
    await 外部定时任务入口(
      上下文,
      async <T extends z.ZodType>(s: 带记忆的解决问题选项<T>) =>
        await this.执行回合({ ...s, 消息历史: s.消息历史 ?? [], 事件组id: 选项?.事件组id ?? s.事件组id }),
      选项,
    )
  }

  public override async 对话<T extends z.ZodType>(选项: 带记忆的对话选项<T>): Promise<回合结果<T>> {
    return await super.对话(选项)
  }

  public override async 推演<T extends z.ZodType>(选项: 带记忆的对话选项<T>): Promise<回合结果<T>> {
    return await super.推演(选项)
  }

  public override async 执行回合<T extends z.ZodType>(选项: 带记忆的解决问题选项<T>): Promise<回合结果<T>> {
    return await super.执行回合(选项)
  }

  protected override async 执行解决问题<T extends z.ZodType>(
    选项: 内部带记忆的解决问题选项<T>,
    执行模式: 智能体执行模式,
    首次请求是否新建对话: boolean = false,
    更新当前会话审计状态: boolean = false,
  ): Promise<回合结果<T>> {
    await this.确保已初始化()
    let 简短命令 = 选项.命令.replace(/\n/g, ' ')
    let 标题 = 选项.标题 ?? `对话: ${简短命令.slice(0, 20)}`
    if (更新当前会话审计状态 === true) this.会话控制器().设置待创建会话标题(标题)
    let 原回调 = 选项.回调
    return await 执行带日志的推理流程(
      this.数据库查询器,
      转为JSON值({ 执行模式 }),
      原回调,
      async (日志回调, 事件组id): Promise<回合结果<T>> => {
        let 带日志选项 = { ...选项, 标题, 回调: 日志回调, 事件组id }
        let 上下文 = 外部构建操作上下文(this.上下文依赖, this.数据库查询器, 原回调, undefined, 事件组id)
        return await 外部解决问题(
          上下文,
          执行模式 === '推演' ? { ...带日志选项, 标题: 选项.标题 } : 带日志选项,
          async (新选项) => await super.执行解决问题(新选项, 执行模式, 首次请求是否新建对话, 更新当前会话审计状态),
          执行模式,
          (新选项) => this.检查前缀(新选项, 执行模式),
        )
      },
      选项.事件组id,
      (): string | null => this.会话控制器().当前消息id(),
    )
  }

  protected override async 同步前缀快照(前缀id: string, 系统提示词: string, 工具定义: object[]): Promise<void> {
    await this.确保已初始化()
    await this.数据库查询器
      .insertInto('前缀快照表')
      .values({ id: 前缀id, 系统提示词, 工具定义: JSON.stringify(工具定义), 创建时间: new Date() })
      .onConflict((冲突) => 冲突.column('id').doNothing())
      .execute()
  }

  public async 私有反思<T extends z.ZodType>(选项: 带记忆的对话选项<T>): Promise<回合结果<T>> {
    let 新选项 = {
      ...选项,
      标题: '私有反思',
      命令: `[系统事件:私有反思] 你刚才经历了以下事件或产生了以下思绪：\n${选项.命令}\n请根据此情况，自主决定是否需要使用工具（如更新记忆等），并在反思结束后返回期望的结果。本轮反思不会写入对话历史。`,
    }
    return await this.执行不追加历史的对话(新选项)
  }

  /** 将反思过程作为一轮正常对话写入会话历史。 */
  public async 会话反思<T extends z.ZodType>(选项: 带记忆的对话选项<T>): Promise<回合结果<T>> {
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

  public async 载入快照(json字符串: string, 事件组id?: string): Promise<void> {
    await this.执行无向量记忆变更任务(
      '载入快照',
      async (trx) => {
        await 外部载入快照(trx, json字符串)
      },
      事件组id,
    )
  }

  public override async 导出完整状态(当前消息历史?: 智能体消息类型[]): Promise<string> {
    await this.确保已初始化()
    if (当前消息历史 !== undefined) throw new Error('持久化会话启用后，导出完整状态不再接受临时消息历史')
    return await 外部导出完整状态(this.数据库查询器, this.会话控制器().当前会话id())
  }

  public override async 导入完整状态(状态数据: string, 事件组id?: string): Promise<智能体消息类型[]> {
    let 状态 = await this.执行无向量记忆变更任务(
      '导入完整状态',
      async (trx) => await 外部导入完整状态(trx, 状态数据),
      事件组id,
    )
    if (状态.当前会话id === null) this.重置对话()
    else await this.会话控制器().恢复导入会话(状态.当前会话id)
    return this.读取对话历史()
  }

  public async 整理布局(事件组id?: string): Promise<void> {
    await this.执行无向量记忆变更任务(
      '整理布局',
      async (trx) => {
        await 外部全局排版(trx)
      },
      事件组id,
    )
  }

  public async 注册动态工具(
    代码: string,
    测试参数_json: string,
    回调?: (事件: 智能体事件) => Promise<void>,
    事件组id?: string,
  ): Promise<动态工具管理.注册动态工具结果> {
    return await 动态工具管理.注册动态工具(this.获取动态工具管理依赖(), 代码, 测试参数_json, 回调, 事件组id)
  }

  public async 查看动态工具(工具标识: string): Promise<动态工具管理.查看动态工具结果> {
    return await 动态工具管理.查看动态工具(this.获取动态工具管理依赖(), 工具标识)
  }

  public async 更新动态工具(
    工具标识: string,
    新代码: string,
    测试参数_json: string,
    回调?: (事件: 智能体事件) => Promise<void>,
    事件组id?: string,
  ): Promise<动态工具管理.更新动态工具结果> {
    return await 动态工具管理.更新动态工具(this.获取动态工具管理依赖(), 工具标识, 新代码, 测试参数_json, 回调, 事件组id)
  }

  public async 移除动态工具(
    工具标识: string,
    回调?: (事件: 智能体事件) => Promise<void>,
    事件组id?: string,
  ): Promise<动态工具管理.移除动态工具结果> {
    return await 动态工具管理.移除动态工具(this.获取动态工具管理依赖(), 工具标识, 回调, 事件组id)
  }

  public async 调用动态工具(
    工具名称: string,
    参数json: string,
    回调?: (事件: 智能体事件) => Promise<void>,
    事件组id?: string,
  ): Promise<动态工具管理.调用动态工具结果> {
    return await 动态工具管理.调用动态工具(this.获取动态工具管理依赖(), 工具名称, 参数json, 回调, 事件组id)
  }

  public async 销毁(): Promise<void> {
    if (this._已销毁) return
    this._已销毁 = true

    await 销毁存储(this.配置.存储, this.PGlite就绪, this.数据库查询器)
  }
}
