import OpenAI from 'openai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { 带记忆的智能体, 记忆等级 } from '../src/index'

let 流式请求AI模拟 = vi.hoisted(() => vi.fn())

vi.mock('../src/agent/stream-request', () => ({ 流式请求AI: 流式请求AI模拟 }))

describe('带记忆的智能体对话', () => {
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
    智能体实例 = new 带记忆的智能体({ 向量模型: { 类型: '无' }, 二级记忆遗忘分数阈值: 0 })
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
    })

    let 已更新记忆 = await 智能体实例.查找记忆(记忆.id)
    expect(结果.结果).toEqual({ 答案: '已完成' })
    expect(已更新记忆?.标签).toEqual(['旧标签', '新标签'])
    expect(流式请求AI模拟).toHaveBeenCalledTimes(2)
  })
})
