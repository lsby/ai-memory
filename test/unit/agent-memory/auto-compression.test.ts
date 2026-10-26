import OpenAI from 'openai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { 带记忆的智能体, type 公开交互日志, type 带记忆的对话选项, type 带记忆的智能体选项 } from '../../../src/index'
import { 使用共享PGlite } from '../../helpers/shared-pglite-fixture'
import { 创建带向量的PGlite, 等待 } from '../../helpers/shared-storage-helper'

let 流式请求AI模拟 = vi.hoisted(() => vi.fn())

vi.mock('../../../src/agent/core/stream-request', () => ({ 流式请求AI: 流式请求AI模拟 }))

type 摘要请求 = (请求体: Record<string, unknown>, 选项?: { signal?: AbortSignal }) => Promise<unknown>

let 自动压缩基础配置 = { 触发字符数: 200, 目标字符数: 100 }

function 创建摘要客户端(实现: 摘要请求): { 客户端: OpenAI; 创建: ReturnType<typeof vi.fn<摘要请求>> } {
  let 创建 = vi.fn<摘要请求>(实现)
  return { 客户端: { chat: { completions: { create: 创建 } } } as unknown as OpenAI, 创建 }
}

/** 一直不返回, 直到 signal 中止才失败 */
async function 等待中止(_请求体: Record<string, unknown>, 选项?: { signal?: AbortSignal }): Promise<never> {
  return await new Promise<never>((_解决, 拒绝): void => {
    let 信号 = 选项?.signal
    if (信号 === undefined) return
    信号.addEventListener('abort', (): void => 拒绝(信号.reason), { once: true })
  })
}

async function 摘要成功(): Promise<unknown> {
  return { choices: [{ message: { content: '摘要' } }] }
}

function 日志内容(日志: 公开交互日志 | undefined): Record<string, unknown> {
  if (日志 === undefined) throw new Error('缺少预期的交互日志')
  return z.record(z.unknown()).parse(日志.内容)
}

describe('自动压缩遥测、超时与冷却', () => {
  let 夹具 = 使用共享PGlite()
  let 实例: 带记忆的智能体 | undefined

  beforeEach((): void => {
    流式请求AI模拟.mockReset()
    流式请求AI模拟.mockImplementation(async (): Promise<{ 完整文本: string; 工具调用列表: []; 已中断: false }> => {
      return { 完整文本: `{"轮次":${String(流式请求AI模拟.mock.calls.length)}}`, 工具调用列表: [], 已中断: false }
    })
  })

  afterEach(async (): Promise<void> => {
    if (实例 !== undefined) {
      await 实例.销毁()
      实例 = undefined
    }
  })

  function 新建(选项: 带记忆的智能体选项 = {}): 带记忆的智能体 {
    实例 = 夹具.新建智能体({ 系统提示词: '固定系统提示词', 自动压缩: 自动压缩基础配置, ...选项 })
    return 实例
  }

  function 对话选项(
    命令: string,
    客户端: OpenAI,
    额外: { 事件组id?: string; 中断信号?: AbortSignal } = {},
  ): 带记忆的对话选项<z.ZodObject<{ 轮次: z.ZodNumber }>> {
    return {
      命令,
      预期结果Schema: z.object({ 轮次: z.number() }),
      预期结果描述: '当前轮次',
      回调: async (): Promise<void> => {},
      openai客户端: 客户端,
      模型名称: 'mock-model',
      是否自动召回: false,
      ...额外,
    }
  }

  async function 读取事件组(智能体: 带记忆的智能体, 事件组id: string): Promise<公开交互日志[]> {
    return await 智能体.查询交互日志({ 事件组id, 数量: 1000 })
  }

  it('自动压缩成功时在同一事件组记录开始、模型请求审计和结束，且与正式那轮共用传入的事件组id', async (): Promise<void> => {
    let 智能体 = 新建()
    let { 客户端, 创建 } = 创建摘要客户端(async () => ({
      choices: [{ message: { content: '摘要' } }],
      usage: { prompt_tokens: 120, completion_tokens: 7 },
    }))
    await 智能体.对话(对话选项('第一轮', 客户端))
    let 压缩前会话 = await 智能体.读取当前会话()

    await 智能体.对话(对话选项('第二轮', 客户端, { 事件组id: '事件组-压缩成功' }))

    expect(创建).toHaveBeenCalledTimes(1)
    let 派生会话 = await 智能体.读取当前会话()
    expect(派生会话.前驱会话id).toBe(压缩前会话.id)
    let 日志列表 = await 读取事件组(智能体, '事件组-压缩成功')
    let 开始 = 日志列表.find((日志) => 日志.类型 === '流程开始' && 日志内容(日志)['入口'] === '自动压缩')
    expect(开始).toBeDefined()
    expect(开始?.上下文消息id).toBe(压缩前会话.当前消息id)
    expect(日志内容(开始)).toMatchObject({ 会话id: 压缩前会话.id })
    expect(typeof 日志内容(开始)['历史字符数']).toBe('number')
    let 审计 = 日志列表.find((日志) => 日志.类型 === '模型请求审计' && 日志内容(日志)['用途'] === '会话压缩')
    expect(审计?.耗时ms).toBeGreaterThanOrEqual(0)
    expect(日志内容(审计)['记录']).toMatchObject({
      发出字符数: 120,
      返回字符数: 7,
      计量单位: 'token',
    })
    let 结束 = 日志列表.find((日志) => 日志.类型 === '流程结束' && 日志内容(日志)['结果'] === '已压缩')
    expect(日志内容(结束)).toMatchObject({
      前驱会话id: 压缩前会话.id,
      派生会话id: 派生会话.id,
      摘要字符数: 2,
    })
    expect(日志列表.some((日志) => 日志.类型 === '流程开始' && 日志内容(日志)['执行模式'] === '对话')).toBe(true)
    expect(日志列表.some((日志) => 日志.类型 === '流程异常')).toBe(false)
  })

  it('没传事件组id时压缩和正式那轮自动共用同一个事件组；没有 usage 时按字符计量', async (): Promise<void> => {
    let 智能体 = 新建()
    let { 客户端 } = 创建摘要客户端(摘要成功)
    await 智能体.对话(对话选项('第一轮', 客户端))
    await 智能体.对话(对话选项('第二轮', 客户端))

    let 结束列表 = await 智能体.查询交互日志({ 类型: '流程结束', 数量: 1000 })
    let 压缩结束 = 结束列表.find((日志) => 日志内容(日志)['结果'] === '已压缩')
    if (压缩结束 === undefined) throw new Error('缺少压缩结束日志')
    let 日志列表 = await 读取事件组(智能体, 压缩结束.事件组id)
    expect(日志列表.some((日志) => 日志.类型 === '流程开始' && 日志内容(日志)['执行模式'] === '对话')).toBe(true)
    let 审计 = 日志列表.find((日志) => 日志.类型 === '模型请求审计' && 日志内容(日志)['用途'] === '会话压缩')
    expect(日志内容(审计)['记录']).toMatchObject({ 计量单位: '字符', 返回字符数: 2 })
  })

  it('压缩超时：记流程异常（原因超时），保留原会话，正式那轮照常成功', async (): Promise<void> => {
    let 智能体 = 新建({ 自动压缩: { ...自动压缩基础配置, 超时毫秒: 50 } })
    let 正常 = 创建摘要客户端(摘要成功)
    await 智能体.对话(对话选项('第一轮', 正常.客户端))
    let 原会话 = await 智能体.读取当前会话()
    let 挂起 = 创建摘要客户端(等待中止)

    let 结果 = await 智能体.对话(对话选项('第二轮', 挂起.客户端, { 事件组id: '事件组-超时' }))

    expect(挂起.创建).toHaveBeenCalledTimes(1)
    expect(结果.结果).toEqual({ 轮次: 2 })
    expect(结果.结束原因).toBeUndefined()
    expect((await 智能体.读取当前会话()).id).toBe(原会话.id)
    let 日志列表 = await 读取事件组(智能体, '事件组-超时')
    let 异常 = 日志列表.find((日志) => 日志.类型 === '流程异常' && 日志内容(日志)['入口'] === '自动压缩')
    expect(日志内容(异常)).toMatchObject({ 原因: '超时', 会话id: 原会话.id })
    expect(typeof 日志内容(异常)['错误消息']).toBe('string')
    expect(日志列表.some((日志) => 日志.类型 === '流程结束' && 日志内容(日志)['结束原因'] === undefined)).toBe(true)
  })

  it('调用方中断信号先到：压缩停止，正式那轮返回中断', async (): Promise<void> => {
    let 智能体 = 新建({ 自动压缩: { ...自动压缩基础配置, 超时毫秒: 60_000 } })
    let 正常 = 创建摘要客户端(摘要成功)
    await 智能体.对话(对话选项('第一轮', 正常.客户端))
    let 挂起 = 创建摘要客户端(等待中止)
    let 控制器 = new AbortController()
    setTimeout((): void => 控制器.abort(), 30)

    let 结果 = await 智能体.对话(对话选项('第二轮', 挂起.客户端, { 事件组id: '事件组-中断', 中断信号: 控制器.signal }))

    expect(结果.结束原因).toBe('中断')
    expect(流式请求AI模拟).toHaveBeenCalledTimes(1)
    let 日志列表 = await 读取事件组(智能体, '事件组-中断')
    let 异常 = 日志列表.find((日志) => 日志.类型 === '流程异常' && 日志内容(日志)['入口'] === '自动压缩')
    expect(日志内容(异常)).toMatchObject({ 原因: '中断' })
  })

  it('失败后冷却：历史增量不够时不再请求摘要并记流程信息，增量够了再试', async (): Promise<void> => {
    let 智能体 = 新建({ 自动压缩: { ...自动压缩基础配置, 失败后冷却字符数: 1_000_000 } })
    let 正常 = 创建摘要客户端(摘要成功)
    await 智能体.对话(对话选项('第一轮', 正常.客户端))
    let 失败 = 创建摘要客户端(async () => {
      throw new Error('摘要服务故障')
    })

    await 智能体.对话(对话选项('第二轮', 失败.客户端))
    expect(失败.创建).toHaveBeenCalledTimes(1)
    await 智能体.对话(对话选项('第三轮', 失败.客户端, { 事件组id: '事件组-冷却' }))

    expect(失败.创建).toHaveBeenCalledTimes(1)
    let 日志列表 = await 读取事件组(智能体, '事件组-冷却')
    expect(日志列表.some((日志) => 日志.类型 === '流程信息' && JSON.stringify(日志.内容).includes('冷却'))).toBe(true)
    expect(日志列表.some((日志) => 日志.类型 === '流程开始' && 日志内容(日志)['入口'] === '自动压缩')).toBe(false)
  })

  it('调用方中断造成的压缩失败不触发冷却，下一轮仍会请求摘要', async (): Promise<void> => {
    let 智能体 = 新建({ 自动压缩: { ...自动压缩基础配置, 失败后冷却字符数: 1_000_000 } })
    let 正常 = 创建摘要客户端(摘要成功)
    await 智能体.对话(对话选项('第一轮', 正常.客户端))
    let 挂起 = 创建摘要客户端(等待中止)
    let 控制器 = new AbortController()
    setTimeout((): void => 控制器.abort(), 30)
    let 被中断 = await 智能体.对话(对话选项('第二轮', 挂起.客户端, { 中断信号: 控制器.signal }))
    expect(被中断.结束原因).toBe('中断')
    expect(挂起.创建).toHaveBeenCalledTimes(1)

    let 再试 = 创建摘要客户端(摘要成功)
    await 智能体.对话(对话选项('第三轮', 再试.客户端))

    expect(再试.创建).toHaveBeenCalledTimes(1)
  })

  it('外部存储模式下两个 schema 的冷却互不影响，派生会话查询也互相隔离', async (): Promise<void> => {
    let pglite = 创建带向量的PGlite()
    let 新建外部 = (schema: string): 带记忆的智能体 =>
      new 带记忆的智能体({
        向量模型: { 类型: '无' },
        系统提示词: '固定系统提示词',
        自动压缩: { ...自动压缩基础配置, 失败后冷却字符数: 1_000_000 },
        存储: { 模式: '外部', pglite, schema },
      })
    let A = 新建外部('tenant_a')
    let B = 新建外部('tenant_b')
    try {
      let 正常 = 创建摘要客户端(摘要成功)
      await A.对话(对话选项('A第一轮', 正常.客户端))
      await B.对话(对话选项('B第一轮', 正常.客户端))
      let A失败 = 创建摘要客户端(async () => {
        throw new Error('摘要服务故障')
      })
      await A.对话(对话选项('A第二轮', A失败.客户端))
      await A.对话(对话选项('A第三轮', A失败.客户端))
      expect(A失败.创建).toHaveBeenCalledTimes(1)

      let B摘要 = 创建摘要客户端(摘要成功)
      await B.对话(对话选项('B第二轮', B摘要.客户端))
      expect(B摘要.创建).toHaveBeenCalledTimes(1)

      let A会话 = await A.读取当前会话()
      let B会话 = await B.读取当前会话()
      expect(await A.查询派生会话(A会话.id)).toEqual([])
      expect(await A.查询派生会话(B会话.前驱会话id ?? 'none')).toEqual([])
      expect((await B.查询派生会话(B会话.前驱会话id ?? 'none')).map((会话) => 会话.id)).toEqual([B会话.id])
    } finally {
      await A.销毁()
      await B.销毁()
      await pglite.close()
    }
  })

  it('失败后冷却字符数很小时，历史增长超过它就会再次尝试', async (): Promise<void> => {
    let 智能体 = 新建({ 自动压缩: { ...自动压缩基础配置, 失败后冷却字符数: 1 } })
    let 正常 = 创建摘要客户端(摘要成功)
    await 智能体.对话(对话选项('第一轮', 正常.客户端))
    let 失败 = 创建摘要客户端(async () => {
      throw new Error('摘要服务故障')
    })

    await 智能体.对话(对话选项('第二轮', 失败.客户端))
    await 智能体.对话(对话选项('第三轮', 失败.客户端))

    expect(失败.创建).toHaveBeenCalledTimes(2)
  })

  it('自动压缩的摘要请求合并实例的额外请求参数，且不能覆盖库管理的字段', async (): Promise<void> => {
    let 智能体 = 新建({ 额外请求参数: { thinking: { type: 'disabled' } } })
    let { 客户端, 创建 } = 创建摘要客户端(摘要成功)
    await 智能体.对话(对话选项('第一轮', 客户端))
    await 智能体.对话(对话选项('第二轮', 客户端))

    expect(创建).toHaveBeenCalledTimes(1)
    expect(创建.mock.calls[0]?.[0]).toMatchObject({
      thinking: { type: 'disabled' },
      model: 'mock-model',
      stream: false,
    })
  })

  it('手动压缩的额外请求参数、中断信号和事件组id生效', async (): Promise<void> => {
    let 智能体 = 夹具.新建智能体({ 系统提示词: '固定系统提示词' })
    实例 = 智能体
    let { 客户端 } = 创建摘要客户端(摘要成功)
    await 智能体.对话(对话选项('第一轮', 客户端))
    let 原会话 = await 智能体.读取当前会话()

    let 成功 = 创建摘要客户端(摘要成功)
    let 派生会话 = await 智能体.压缩当前会话({
      openai客户端: 成功.客户端,
      模型名称: 'summary-model',
      目标字符数: 100,
      额外请求参数: { thinking: { type: 'disabled' } },
      事件组id: '事件组-手动成功',
    })
    expect(成功.创建.mock.calls[0]?.[0]).toMatchObject({ thinking: { type: 'disabled' }, model: 'summary-model' })
    let 成功日志 = await 读取事件组(智能体, '事件组-手动成功')
    expect(成功日志.map((日志) => 日志.类型)).toEqual(['流程开始', '模型请求审计', '流程结束'])
    expect(日志内容(成功日志[2])).toMatchObject({ 前驱会话id: 原会话.id, 派生会话id: 派生会话.id })

    let 已中断 = new AbortController()
    已中断.abort()
    let 不会调用 = 创建摘要客户端(摘要成功)
    await expect(
      智能体.压缩当前会话({
        openai客户端: 不会调用.客户端,
        模型名称: 'summary-model',
        目标字符数: 100,
        中断信号: 已中断.signal,
        事件组id: '事件组-手动中断',
      }),
    ).rejects.toThrow()
    expect(不会调用.创建).not.toHaveBeenCalled()
    let 失败日志 = await 读取事件组(智能体, '事件组-手动中断')
    expect(失败日志.map((日志) => 日志.类型)).toEqual(['流程开始', '流程异常'])
    expect(日志内容(失败日志[1])).toMatchObject({ 入口: '手动压缩', 原因: '中断' })
  })

  it('自动压缩的新字段必须是正整数', (): void => {
    expect(() => 夹具.新建智能体({ 自动压缩: { ...自动压缩基础配置, 超时毫秒: 0 } })).toThrow('自动压缩.超时毫秒')
    expect(() => 夹具.新建智能体({ 自动压缩: { ...自动压缩基础配置, 失败后冷却字符数: 1.5 } })).toThrow(
      '自动压缩.失败后冷却字符数',
    )
  })

  it('查询派生会话按更新时间倒序返回，没有派生时返回空数组', async (): Promise<void> => {
    let 智能体 = 夹具.新建智能体({ 系统提示词: '固定系统提示词' })
    实例 = 智能体
    let { 客户端 } = 创建摘要客户端(摘要成功)
    await 智能体.对话(对话选项('第一轮', 客户端))
    let 原会话 = await 智能体.读取当前会话()
    if (原会话.当前消息id === null) throw new Error('缺少当前消息')
    expect(await 智能体.查询派生会话(原会话.id)).toEqual([])

    let 第一个 = await 智能体.创建派生会话({ 前驱会话id: 原会话.id, 前驱消息id: 原会话.当前消息id, 摘要: 'A' })
    await 等待(5)
    let 第二个 = await 智能体.创建派生会话({ 前驱会话id: 原会话.id, 前驱消息id: 原会话.当前消息id, 摘要: 'B' })
    expect((await 智能体.查询派生会话(原会话.id)).map((会话) => 会话.id)).toEqual([第二个.id, 第一个.id])
    await 等待(5)
    await 智能体.更新会话标题(第一个.id, '最近更新')
    expect((await 智能体.查询派生会话(原会话.id)).map((会话) => 会话.id)).toEqual([第一个.id, 第二个.id])
    expect(await 智能体.查询派生会话(第二个.id)).toEqual([])
  })

  it('会话表的前驱会话索引存在，旧数据目录缺索引时重新打开会补上', async (): Promise<void> => {
    let pglite = 创建带向量的PGlite()
    let schema = 'idx_case'
    let 打开 = (): 带记忆的智能体 =>
      new 带记忆的智能体({ 向量模型: { 类型: '无' }, 存储: { 模式: '外部', pglite, schema } })
    let 查索引 = async (): Promise<string[]> =>
      (
        await pglite.query<{ indexname: string }>(
          `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = '会话表'`,
          [schema],
        )
      ).rows.map((行) => 行.indexname)
    try {
      let 第一个实例 = 打开()
      await 第一个实例.初始化()
      expect(await 查索引()).toContain('会话表_前驱会话_idx')
      await pglite.exec(`DROP INDEX "${schema}"."会话表_前驱会话_idx"`)
      expect(await 查索引()).not.toContain('会话表_前驱会话_idx')
      let 第二个实例 = 打开()
      await 第二个实例.初始化()
      expect(await 查索引()).toContain('会话表_前驱会话_idx')
    } finally {
      await pglite.close()
    }
  })
})
