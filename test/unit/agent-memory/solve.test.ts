import OpenAI from 'openai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { 带记忆的智能体, 记忆等级 } from '../../../src/index'
import { 使用共享PGlite } from '../../helpers/shared-pglite-fixture'

let 流式请求AI模拟 = vi.hoisted(() => vi.fn())

vi.mock('../../../src/agent/core/stream-request', () => ({ 流式请求AI: 流式请求AI模拟 }))

describe('带记忆的智能体对话', () => {
  let 夹具 = 使用共享PGlite()
  let 智能体实例: 带记忆的智能体 | undefined

  beforeEach((): void => {
    流式请求AI模拟.mockReset()
  })

  afterEach(async (): Promise<void> => {
    if (智能体实例 !== undefined) {
      await 智能体实例.销毁()
      智能体实例 = undefined
    }
  })

  it('允许模型通过内置工具修改已有记忆', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体({ 向量模型: { 类型: '无' }, 二级记忆遗忘分数阈值: 0 })
    await 智能体实例.批量注入记忆([
      {
        内容: '待标记的记忆',
        关键词: ['测试'],
        标签: ['旧标签'],
        评分: 80,
        等级: 记忆等级.一级,
        创建时间: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])
    let 记忆 = (await 智能体实例.查询记忆())[0]
    if (记忆 === undefined) throw new Error('未找到已注入的记忆')

    流式请求AI模拟
      .mockResolvedValueOnce({
        完整文本: '',
        工具调用列表: [
          {
            id: 'append_tag',
            名称: 'append_memory_tags',
            参数片段: JSON.stringify({ id: 记忆.id, 标签列表: ['新标签'] }),
          },
        ],
        已中断: false,
      })
      .mockResolvedValueOnce({ 完整文本: '{"答案":"已完成"}', 工具调用列表: [], 已中断: false })

    let 结果 = await 智能体实例.对话({
      命令: '为记忆补充标签',
      预期结果Schema: z.object({ 答案: z.string() }),
      预期结果描述: '操作结果',
      回调: async (): Promise<void> => {},
      openai客户端: new OpenAI({ apiKey: 'test' }),
      模型名称: 'mock-model',
      是否自动召回: false,
      事件组id: 'conversation-group',
    })

    let 已更新记忆 = await 智能体实例.查找记忆(记忆.id)
    expect(结果.结果).toEqual({ 答案: '已完成' })
    expect(已更新记忆?.标签).toEqual(['旧标签', '新标签'])
    expect(流式请求AI模拟).toHaveBeenCalledTimes(2)
    let 日志列表 = await 智能体实例.查询交互日志({ 事件组id: 'conversation-group' })
    let 日志类型 = 日志列表.map((日志) => 日志.类型)
    expect(日志类型).toEqual(
      expect.arrayContaining(['流程开始', '工具调用开始', '记忆提交', '工具调用结果', '模型响应完成', '流程结束']),
    )
    expect(日志类型).not.toEqual(expect.arrayContaining(['AI文本片段', '原始AI返回', '最终结果']))
    let 模型响应列表 = 日志列表.filter((日志) => 日志.类型 === '模型响应完成')
    expect(模型响应列表).toHaveLength(2)
    expect(模型响应列表.every((日志) => 日志.模型请求id !== undefined && 日志.前缀id !== undefined)).toBe(true)
    expect(模型响应列表.every((日志) => 日志.消息id !== undefined)).toBe(true)
    let 前缀id = 模型响应列表[0]?.前缀id
    if (前缀id === undefined) throw new Error('模型响应日志缺少前缀引用')
    expect(await 智能体实例.查询前缀快照(前缀id)).toMatchObject({ id: 前缀id })
    let 模型工具事件 = 日志列表.filter((日志) => 日志.类型 === '工具调用开始' || 日志.类型 === '工具调用结果')
    expect(模型工具事件.every((日志) => 日志.模型请求id !== undefined && 日志.前缀id !== undefined)).toBe(true)
    let 记忆工具事件 = 模型工具事件.filter(
      (日志) =>
        typeof 日志.内容 === 'object' &&
        日志.内容 !== null &&
        Array.isArray(日志.内容) === false &&
        日志.内容['id'] === 'append_tag',
    )
    expect(记忆工具事件.every((日志) => 日志.消息id !== undefined)).toBe(true)
    let 工具消息id = 记忆工具事件[0]?.消息id
    if (工具消息id === undefined) throw new Error('工具日志缺少消息引用')
    expect((await 智能体实例.读取消息历史(工具消息id)).at(-1)?.消息.role).toBe('tool')
    expect(日志列表.at(-1)?.内容).not.toHaveProperty('结果')
  })
})
