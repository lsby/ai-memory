import { PGlite, type PGliteOptions } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { Kysely } from 'kysely'
import path from 'node:path'
import type OpenAI from 'openai'
import { z } from 'zod'
import { 智能体 } from '../agent/agent'
import { type 回合结果, type 智能体事件, type 智能体执行模式, type 智能体消息类型 } from '../agent/types'
import { 回收表空间, 在提交中执行, 回退记忆提交 as 外部回退记忆提交, 抹除记忆变更记录 } from './agent-memory-commit'
import { 带互斥的PGlite方言, 校验schema名, 默认schema } from './agent-memory-connection'
import {
  创建向量缓存 as 外部创建向量缓存,
  构建动态操作上下文 as 外部构建动态操作上下文,
  构建操作上下文 as 外部构建操作上下文,
  type 上下文依赖,
} from './agent-memory-context'
import {
  批量注入记忆 as 外部批量注入记忆,
  检查并清理二级记忆 as 外部检查并清理二级记忆,
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
import { 清除共享初始化锁, 获取或创建PGlite, 获取或创建共享初始化锁, 销毁存储 } from './agent-memory-storage'
import {
  批量注入记忆项Schema,
  type 公开动态工具,
  type 公开记忆,
  type 公开记忆关联,
  type 公开记忆提交,
  type 内部带记忆的智能体配置,
  type 内部带记忆的解决问题选项,
  type 存储配置,
  type 带记忆的对话选项,
  type 带记忆的智能体选项,
  type 带记忆的解决问题选项,
  type 批量注入记忆项,
  type 更新记忆选项,
  type 查询记忆选项,
  type 记忆数据库,
} from './agent-memory-types'
import { 向量未预取错误, 新向量缓存, 预取向量, type 向量缓存 } from './agent-memory-vector-cache'
import { 生成默认记忆提示词 } from './memory-prompt'
import { 全部记忆工具名, 记忆工具名 } from './memory-tool-names'
import { 初始化数据库 } from './tools/db-schema'
import {
  删除动态工具核心,
  提取动态工具向量文本,
  更新动态工具核心,
  查看动态工具代码核心,
  注册动态工具核心,
  调用动态工具核心,
} from './tools/dynamic-tool-api'
import { 全局排版 as 外部全局排版 } from './tools/layout'

export class 带记忆的智能体 extends 智能体 {
  private 配置: 内部带记忆的智能体配置
  private PGlite就绪: Promise<PGlite>
  private 数据库查询器: Kysely<记忆数据库>
  private schema名: string
  private readonly 上下文依赖: 上下文依赖
  private readonly 记忆提示词文本: string
  private 数据库是否已初始化: boolean = false
  private 距上次回收空间的提交数 = 0
  private 初始化锁: Promise<void> | null = null
  private _已销毁 = false

  public constructor(选项: 带记忆的智能体选项) {
    super(选项)
    let 存储: 存储配置 = 选项.存储 ?? { 模式: '内存' }
    if (存储.模式 === '文件') 存储 = { ...存储, 路径: path.resolve(存储.路径) }
    if (存储.schema !== undefined) 校验schema名(存储.schema)
    let 变更记录 = 选项.变更记录 ?? { 保留提交数: Number.POSITIVE_INFINITY }
    if (变更记录 !== false && 变更记录.保留提交数 !== Number.POSITIVE_INFINITY) {
      if (Number.isInteger(变更记录.保留提交数) === false || 变更记录.保留提交数 < 1)
        throw new Error('变更记录.保留提交数 必须是不小于 1 的整数')
    }
    let 禁用深度推演 = 选项.禁用深度推演 ?? false
    let 筛选 = 选项.记忆工具筛选
    let 启用的记忆工具名 = 全部记忆工具名.filter(
      (名称): boolean =>
        (名称 !== 记忆工具名.深度推演 || 禁用深度推演 === false) && (筛选 === undefined || 筛选(名称) === true),
    )
    this.配置 = {
      ...选项,
      启用的记忆工具名,
      遗忘豁免: 选项.遗忘豁免 ?? ((): boolean => false),
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
      变更记录,
      禁用深度推演,
    }
    let 自定义提示词 = 选项.记忆提示词
    // 记忆提示词是前缀的一部分: 构造时算一次固定下来, 调用方的函数不会被反复调用
    this.记忆提示词文本 =
      自定义提示词 === undefined
        ? 生成默认记忆提示词(启用的记忆工具名)
        : typeof 自定义提示词 === 'string'
          ? 自定义提示词
          : 自定义提示词([...启用的记忆工具名])
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
  ): Promise<R> {
    await this.确保已初始化()
    for (let 尝试次数 = 1; ; 尝试次数++) {
      try {
        let 结果 = await this.数据库查询器.transaction().execute(async (trx) => {
          let 事务结果 = await 在提交中执行(trx, this.配置.变更记录, 消息, 操作)
          if (缓存.缺失.size > 0) throw new 向量未预取错误([...缓存.缺失][0] ?? '')
          return 事务结果
        })
        await this.按提交数回收空间()
        return 结果
      } catch (错误) {
        if (错误 instanceof 向量未预取错误 === false || 尝试次数 >= 3) throw 错误
        await 预取向量(缓存, [...缓存.缺失], this.配置.向量模型, 回调)
        缓存.缺失.clear()
      }
    }
  }

  /** 配置了保留提交数时，裁掉的旧提交只是被标记删除；每过一轮保留窗口，在事务外回收一次它们占的空间。 */
  private async 按提交数回收空间(): Promise<void> {
    let 变更记录 = this.配置.变更记录
    if (变更记录 === false || Number.isFinite(变更记录.保留提交数) === false) return
    this.距上次回收空间的提交数++
    if (this.距上次回收空间的提交数 < Math.max(变更记录.保留提交数, 5)) return
    this.距上次回收空间的提交数 = 0
    await this.回收空间()
  }

  /** 回收空间失败（比如实例刚好被销毁）不影响已经提交的业务结果。 */
  private async 回收空间(): Promise<void> {
    try {
      await 回收表空间(this.数据库查询器, this.schema名)
    } catch (_错误) {}
  }

  public async 批量注入记忆(记忆项列表: 批量注入记忆项[], 回调?: (事件: 智能体事件) => Promise<void>): Promise<void> {
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
    )
  }

  public async 添加记忆(记忆项: 批量注入记忆项, 回调?: (事件: 智能体事件) => Promise<void>): Promise<公开记忆> {
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

  public async 删除记忆(id: string): Promise<boolean> {
    let 已校验id = z.string().trim().min(1).parse(id)
    return await this.执行记忆变更任务('删除记忆', async (trx): Promise<boolean> => {
      let 结果 = await trx.deleteFrom('记忆表').where('id', '=', 已校验id).executeTakeFirst()
      return Number(结果.numDeletedRows) > 0
    })
  }

  /**
   * 彻底删除一条记忆：删掉记忆本身，并抹掉变更表里这条记忆相关的全部旧值、新值，
   * 之后无法再通过回退找回。用户主动删除、注销时用。已经被 删除记忆 删掉的记忆也可以用它清除残留的变更记录。
   * 返回是否删掉了记忆或抹掉了变更记录。
   */
  public async 彻底删除记忆(id: string): Promise<boolean> {
    let 已校验id = z.string().trim().min(1).parse(id)
    let 已抹除 = await this.执行记忆变更任务('彻底删除记忆', async (trx): Promise<boolean> => {
      let 结果 = await trx.deleteFrom('记忆表').where('id', '=', 已校验id).executeTakeFirst()
      let 抹除条数 = await 抹除记忆变更记录(trx, 已校验id)
      return Number(结果.numDeletedRows) > 0 || 抹除条数 > 0
    })
    // 被删的行在磁盘页里还留着原文，回收一次空间让它们可以被覆盖
    if (已抹除) await this.回收空间()
    return 已抹除
  }

  public async 更新记忆(
    id: string,
    选项: 更新记忆选项,
    回调?: (事件: 智能体事件) => Promise<void>,
  ): Promise<公开记忆 | null> {
    let 已校验id = z.string().trim().min(1).parse(id)
    let 缓存 = await 外部创建向量缓存(this.配置, typeof 选项.内容 === 'string' ? [选项.内容.trim()] : [], 回调)
    let 是否存在 = await this.执行记忆变更任务(
      '更新记忆',
      async (trx) => await 外部更新记忆(外部构建操作上下文(this.上下文依赖, trx, 回调, 缓存), 已校验id, 选项),
      缓存,
      回调,
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
    // 变更记录关闭时没有可回退的内容
    if (this.配置.变更记录 === false) return false
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
    let 上下文 = 外部构建操作上下文(this.上下文依赖, this.数据库查询器, 选项?.回调)
    await 外部定时任务入口(
      上下文,
      async <T extends z.ZodType>(s: 带记忆的解决问题选项<T>) =>
        await this.执行回合({ ...s, 消息历史: s.消息历史 ?? [] }),
      选项,
    )
  }

  public override async 对话<T extends z.ZodType>(选项: 带记忆的对话选项<T>): Promise<回合结果<T>> {
    return await super.对话(选项)
  }

  public override async 推演<T extends z.ZodType>(选项: 带记忆的对话选项<T>): Promise<回合结果<T>> {
    return await super.推演(选项)
  }

  protected override async 执行解决问题<T extends z.ZodType>(
    选项: 内部带记忆的解决问题选项<T>,
    执行模式: 智能体执行模式,
    首次请求是否新建对话: boolean = false,
    更新当前会话审计状态: boolean = false,
  ): Promise<回合结果<T>> {
    let 简短命令 = 选项.命令.replace(/\n/g, ' ')
    let 标题 = 选项.标题 ?? `对话: ${简短命令.slice(0, 20)}`
    if (执行模式 === '推演') {
      await this.确保已初始化()
      let 上下文 = 外部构建操作上下文(this.上下文依赖, this.数据库查询器, 选项.回调)
      return await 外部解决问题(
        上下文,
        选项,
        async (新选项) => await super.执行解决问题(新选项, 执行模式, 首次请求是否新建对话, 更新当前会话审计状态),
        执行模式,
        (新选项) => this.检查前缀(新选项, 执行模式),
      )
    }
    await this.确保已初始化()
    let 上下文 = 外部构建操作上下文(this.上下文依赖, this.数据库查询器, 选项.回调)
    return await 外部解决问题(
      上下文,
      { ...选项, 标题 },
      async (新选项) => await super.执行解决问题(新选项, 执行模式, 首次请求是否新建对话, 更新当前会话审计状态),
      执行模式,
      (新选项) => this.检查前缀(新选项, 执行模式),
    )
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
    let 缓存 = await 外部创建向量缓存(this.配置, await this.动态工具向量文本(代码), 回调)
    return await this.执行记忆变更任务(
      '编程接入: 注册动态工具',
      async (trx) => {
        let 动态上下文 = 外部构建动态操作上下文(this.上下文依赖, trx, 回调, 缓存)
        return await 注册动态工具核心(动态上下文, { 代码, 测试参数_json })
      },
      缓存,
      回调,
    )
  }

  private async 动态工具向量文本(代码: string): Promise<string[]> {
    let 文本 = await 提取动态工具向量文本(代码)
    return 文本 === null ? [] : [文本]
  }

  public async 查看动态工具(
    工具标识: string,
  ): Promise<{ 结果: '成功' | '失败'; id?: string; 名称?: string; 描述?: string; 代码?: string; 错误信息?: string }> {
    await this.确保已初始化()
    let 动态上下文 = 外部构建动态操作上下文(this.上下文依赖, this.数据库查询器)
    return await 查看动态工具代码核心(动态上下文, { 工具标识 })
  }

  public async 更新动态工具(
    工具标识: string,
    新代码: string,
    测试参数_json: string,
    回调?: (事件: 智能体事件) => Promise<void>,
  ): Promise<{ 结果: '成功' | '失败'; 测试执行输出?: string; 错误信息?: string }> {
    let 缓存 = await 外部创建向量缓存(this.配置, await this.动态工具向量文本(新代码), 回调)
    return await this.执行记忆变更任务(
      '编程接入: 更新动态工具',
      async (trx) => {
        let 动态上下文 = 外部构建动态操作上下文(this.上下文依赖, trx, 回调, 缓存)
        return await 更新动态工具核心(动态上下文, { 工具标识, 新代码, 测试参数_json })
      },
      缓存,
      回调,
    )
  }

  public async 删除动态工具(
    工具标识: string,
    回调?: (事件: 智能体事件) => Promise<void>,
  ): Promise<{ 结果: '成功' | '失败'; 错误信息?: string }> {
    return await this.执行记忆变更任务(
      '编程接入: 删除动态工具',
      async (trx) => {
        let 动态上下文 = 外部构建动态操作上下文(this.上下文依赖, trx, 回调)
        return await 删除动态工具核心(动态上下文, { 工具标识 })
      },
      undefined,
      回调,
    )
  }

  public async 调用动态工具(
    工具名称: string,
    参数json: string,
    回调?: (事件: 智能体事件) => Promise<void>,
  ): Promise<{ 结果: '成功' | '失败'; 执行输出?: string; 错误信息?: string }> {
    await this.确保已初始化()
    let 动态上下文 = 外部构建动态操作上下文(this.上下文依赖, this.数据库查询器, 回调)
    return await 调用动态工具核心(动态上下文, { name: 工具名称, arguments: 参数json })
  }

  public async 销毁(): Promise<void> {
    if (this._已销毁) return
    this._已销毁 = true

    await 销毁存储(this.配置.存储, this.PGlite就绪, this.数据库查询器)
  }
}
