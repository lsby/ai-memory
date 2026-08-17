import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import OpenAI from 'openai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { 带记忆的智能体, 记忆等级 } from '../src/index'

let 流式请求AI模拟 = vi.hoisted(() => vi.fn())

vi.mock('../src/agent/stream-request', () => ({ 流式请求AI: 流式请求AI模拟 }))

async function 在期限内<T>(任务: Promise<T>, 毫秒: number = 5000): Promise<T> {
  let 定时器: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      任务,
      new Promise<T>((_resolve, reject) => {
        定时器 = setTimeout(() => reject(new Error(`操作未在 ${String(毫秒)}ms 内完成`)), 毫秒)
      }),
    ])
  } finally {
    if (定时器 !== undefined) clearTimeout(定时器)
  }
}

function 创建对话选项(命令: string): {
  命令: string
  预期结果Schema: z.ZodObject<{ 完成: z.ZodBoolean }>
  预期结果描述: string
  回调: () => Promise<void>
  openai客户端: OpenAI
  模型名称: string
  是否自动召回: false
} {
  return {
    命令,
    预期结果Schema: z.object({ 完成: z.boolean() }),
    预期结果描述: '完成状态',
    回调: async (): Promise<void> => {},
    openai客户端: new OpenAI({ apiKey: 'test' }),
    模型名称: 'mock-model',
    是否自动召回: false,
  }
}

describe('记忆事务边界与隔离', () => {
  let 智能体列表: 带记忆的智能体[] = []
  let 临时目录列表: string[] = []

  beforeEach((): void => {
    流式请求AI模拟.mockReset()
  })

  afterEach(async (): Promise<void> => {
    for (let 智能体实例 of 智能体列表.reverse()) await 智能体实例.销毁()
    智能体列表 = []
    for (let 临时目录 of 临时目录列表) await rm(临时目录, { recursive: true, force: true })
    临时目录列表 = []
  })

  async function 创建带基础记忆的智能体(存储?: { 模式: '文件'; 路径: string }): Promise<带记忆的智能体> {
    let 智能体实例 = new 带记忆的智能体({
      向量模型: { 类型: '无' },
      二级记忆遗忘分数阈值: 0,
      ...(存储 !== undefined ? { 存储 } : {}),
    })
    智能体列表.push(智能体实例)
    await 智能体实例.添加记忆({
      内容: '基础记忆',
      关键词: ['基础', '重组'],
      标签: [],
      评分: 80,
      等级: 记忆等级.一级,
      创建时间: new Date('2026-01-01T00:00:00.000Z'),
    })
    return 智能体实例
  }

  it('记忆重组调用模型时不会重新进入同一写队列造成死锁', async (): Promise<void> => {
    let 智能体实例 = await 创建带基础记忆的智能体()
    流式请求AI模拟.mockResolvedValue({ 完整文本: '{"重组完成":true}', 工具调用列表: [], 已中断: false })

    await 在期限内(
      智能体实例.执行记忆重组({
        openai客户端: new OpenAI({ apiKey: 'test' }),
        模型名称: 'mock-model',
        种子关键词: ['重组'],
      }),
    )

    expect(流式请求AI模拟).toHaveBeenCalledTimes(1)
  })

  it('带模型的定时任务可以完成维护与记忆重组而不死锁', async (): Promise<void> => {
    let 智能体实例 = await 创建带基础记忆的智能体()
    流式请求AI模拟.mockResolvedValue({ 完整文本: '{"重组完成":true}', 工具调用列表: [], 已中断: false })

    await 在期限内(
      智能体实例.定时任务入口({
        openai客户端: new OpenAI({ apiKey: 'test' }),
        模型名称: 'mock-model',
        当前时间: new Date('2026-01-02T00:00:00.000Z'),
      }),
    )

    expect(流式请求AI模拟).toHaveBeenCalledTimes(1)
  })

  it('模型请求悬停期间数据库写入仍能在独立短事务中完成', async (): Promise<void> => {
    let 智能体实例 = await 创建带基础记忆的智能体()
    let 释放模型: () => void = () => {}
    let 模型闸门 = new Promise<void>((resolve) => {
      释放模型 = resolve
    })
    流式请求AI模拟.mockImplementation(async () => {
      await 模型闸门
      return { 完整文本: '{"完成":true}', 工具调用列表: [], 已中断: false }
    })

    let 对话任务 = 智能体实例.对话(创建对话选项('等待模型'))
    await vi.waitFor(() => expect(流式请求AI模拟).toHaveBeenCalledTimes(1))
    await 在期限内(
      智能体实例.添加记忆({
        内容: '模型等待期间写入',
        关键词: ['并发写入'],
        标签: [],
        评分: 70,
        等级: 记忆等级.一级,
        创建时间: new Date('2026-01-02T00:00:00.000Z'),
      }),
    )
    释放模型()
    await 对话任务

    expect(await 智能体实例.查询记忆({ 搜索文本: '模型等待期间写入' })).toHaveLength(1)
  })

  it('文件存储父智能体的深度推演使用隔离数据库且不污染父记忆', async (): Promise<void> => {
    let 临时目录 = await mkdtemp(path.join(os.tmpdir(), 'ai-memory-deduction-'))
    临时目录列表.push(临时目录)
    let 智能体实例 = await 创建带基础记忆的智能体({ 模式: '文件', 路径: path.join(临时目录, 'parent') })
    流式请求AI模拟
      .mockResolvedValueOnce({
        完整文本: '',
        工具调用列表: [
          {
            id: 'deduction_call',
            名称: 'deep_deduction',
            参数片段: JSON.stringify({
              专家设定: '测试专家',
              推演任务: '验证隔离',
              先验知识: ['仅属于子智能体'],
              纯净模式: false,
            }),
          },
        ],
        已中断: false,
      })
      .mockResolvedValueOnce({ 完整文本: '{"结论":"隔离正常","置信度":90}', 工具调用列表: [], 已中断: false })
      .mockResolvedValueOnce({ 完整文本: '{"完成":true}', 工具调用列表: [], 已中断: false })

    let 结果 = await 在期限内(智能体实例.对话(创建对话选项('执行深度推演')), 10000)

    expect(结果.结果).toEqual({ 完成: true })
    expect((await 智能体实例.查询记忆()).map((记忆) => 记忆.内容)).toEqual(['基础记忆'])
  })
})
