import type { 智能体事件 } from '@lsby/ai-agent'
import type { Kysely } from 'kysely'
import { 创建向量缓存, 构建技能操作上下文, type 上下文依赖 } from '../context'
import { 创建事件组id, 记录交互日志, 转为JSON值 } from '../logger'
import type { 向量缓存 } from '../storage/vector-cache'
import {
  创建技能核心,
  执行技能核心,
  提取技能向量文本,
  更新技能核心,
  查看技能代码核心,
  移除技能核心,
} from '../tools/skill-api'
import type { 内部带记忆的智能体配置, 记忆数据库 } from '../types'

export type 技能管理依赖 = {
  配置: 内部带记忆的智能体配置
  上下文依赖: 上下文依赖
  数据库查询器: Kysely<记忆数据库>
  确保已初始化: () => Promise<void>
  执行记忆变更任务: <R>(
    消息: string,
    操作: (trx: Kysely<记忆数据库>, 父记忆提交id: string | null) => Promise<R>,
    缓存?: 向量缓存,
    回调?: (事件: 智能体事件) => Promise<void>,
    事件组id?: string,
  ) => Promise<R>
}

export type 创建技能结果 = {
  结果: '成功' | '失败'
  id?: string
  技能名称?: string
  测试执行输出?: string
  错误信息?: string
}
export type 查看技能结果 = {
  结果: '成功' | '失败'
  id?: string
  名称?: string
  描述?: string
  代码?: string
  线索?: string[]
  错误信息?: string
}
export type 更新技能结果 = { 结果: '成功' | '失败'; 测试执行输出?: string; 错误信息?: string }
export type 移除技能结果 = { 结果: '成功' | '失败'; 错误信息?: string }
export type 执行技能结果 = { 结果: '成功' | '失败'; 执行输出?: string; 错误信息?: string }

export async function 创建技能(
  依赖: 技能管理依赖,
  代码: string,
  测试参数_json: string,
  线索: string[],
  回调?: (事件: 智能体事件) => Promise<void>,
  事件组id?: string,
): Promise<创建技能结果> {
  let 缓存 = await 创建向量缓存(依赖.配置, await 提取技能向量文本(代码, 线索), 回调)
  return await 依赖.执行记忆变更任务(
    '技能管理: 创建技能',
    async (trx) =>
      await 创建技能核心(构建技能操作上下文(依赖.上下文依赖, trx, 回调, 缓存), { 代码, 测试参数_json, 线索 }),
    缓存,
    回调,
    事件组id,
  )
}

export async function 查看技能(依赖: 技能管理依赖, 技能标识: string): Promise<查看技能结果> {
  await 依赖.确保已初始化()
  return await 查看技能代码核心(构建技能操作上下文(依赖.上下文依赖, 依赖.数据库查询器), { 技能标识 })
}

export async function 更新技能(
  依赖: 技能管理依赖,
  技能标识: string,
  新代码: string,
  测试参数_json: string,
  线索: string[],
  回调?: (事件: 智能体事件) => Promise<void>,
  事件组id?: string,
): Promise<更新技能结果> {
  let 缓存 = await 创建向量缓存(依赖.配置, await 提取技能向量文本(新代码, 线索), 回调)
  return await 依赖.执行记忆变更任务(
    '技能管理: 更新技能',
    async (trx) =>
      await 更新技能核心(构建技能操作上下文(依赖.上下文依赖, trx, 回调, 缓存), {
        技能标识,
        新代码,
        测试参数_json,
        线索,
      }),
    缓存,
    回调,
    事件组id,
  )
}

export async function 移除技能(
  依赖: 技能管理依赖,
  技能标识: string,
  回调?: (事件: 智能体事件) => Promise<void>,
  事件组id?: string,
): Promise<移除技能结果> {
  return await 依赖.执行记忆变更任务(
    '技能管理: 从当前状态移除技能',
    async (trx) => await 移除技能核心(构建技能操作上下文(依赖.上下文依赖, trx, 回调), { 技能标识 }),
    undefined,
    回调,
    事件组id,
  )
}

export async function 执行技能(
  依赖: 技能管理依赖,
  技能名称: string,
  参数json: string,
  回调?: (事件: 智能体事件) => Promise<void>,
  事件组id?: string,
): Promise<执行技能结果> {
  await 依赖.确保已初始化()
  let 已校验事件组id = 创建事件组id(事件组id)
  let 开始时间 = new Date()
  await 记录交互日志(
    依赖.数据库查询器,
    { 类型: '工具调用开始', 开始时间, 内容: 转为JSON值({ 技能名称 }) },
    已校验事件组id,
  )
  try {
    let 结果 = await 执行技能核心(构建技能操作上下文(依赖.上下文依赖, 依赖.数据库查询器, 回调), {
      name: 技能名称,
      arguments: 参数json,
    })
    await 记录交互日志(
      依赖.数据库查询器,
      {
        类型: '工具调用结果',
        开始时间,
        耗时ms: Date.now() - 开始时间.getTime(),
        内容: 转为JSON值({ 技能名称, 状态: 结果.结果 }),
      },
      已校验事件组id,
    )
    return 结果
  } catch (错误) {
    await 记录交互日志(
      依赖.数据库查询器,
      {
        类型: '工具调用失败',
        开始时间,
        耗时ms: Date.now() - 开始时间.getTime(),
        内容: 转为JSON值({ 技能名称, 错误: 错误 instanceof Error ? 错误.message : String(错误) }),
      },
      已校验事件组id,
    )
    throw 错误
  }
}
