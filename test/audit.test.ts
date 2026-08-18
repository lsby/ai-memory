import OpenAI from 'openai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { 智能体, 统计字符数, type 智能体事件 } from '../src/index'

let 流式请求AI模拟 = vi.hoisted(() => vi.fn())

vi.mock('../src/agent/stream-request', async (导入原模块) => {
  let 原模块 = await 导入原模块<typeof import('../src/agent/stream-request')>()
  return { ...原模块, 流式请求AI: 流式请求AI模拟 }
})

function 创建选项(
  命令: string,
  事件列表: 智能体事件[] = [],
): {
  命令: string
  预期结果Schema: z.ZodObject<{ 回答: z.ZodString }>
  预期结果描述: string
  回调: (事件: 智能体事件) => Promise<void>
  openai客户端: OpenAI
  模型名称: string
} {
  return {
    命令,
    预期结果Schema: z.object({ 回答: z.string() }),
    预期结果描述: '回答文本',
    回调: async (事件): Promise<void> => {
      事件列表.push(事件)
    },
    openai客户端: new OpenAI({ apiKey: 'test' }),
    模型名称: 'mock-model',
  }
}

describe('模型字符与缓存审计', () => {
  beforeEach((): void => {
    流式请求AI模拟.mockReset()
    流式请求AI模拟.mockResolvedValue({ 完整文本: '{"回答":"中A"}', 工具调用列表: [], 已中断: false })
  })

  it('按 Unicode 字符计数，中英文和 emoji 都各算一个', (): void => {
    expect(统计字符数('A中🙂')).toBe(3)
    expect(统计字符数('中文')).toBe(2)
    expect(统计字符数('ab')).toBe(2)
  })

  it('记录每次请求的输入输出字符并汇总新建与复用次数', async (): Promise<void> => {
    let 事件列表: 智能体事件[] = []
    let 智能体实例 = new 智能体({ 系统提示词: '固定提示' })
    await 智能体实例.对话(创建选项('第一轮', 事件列表))
    await 智能体实例.对话(创建选项('第二轮', 事件列表))

    let 记录列表 = 智能体实例.读取模型审计记录()
    expect(记录列表).toHaveLength(2)
    expect(记录列表.map((记录) => 记录.缓存判定)).toEqual(['新建对话', '复用已有对话'])
    expect(记录列表[0]?.发出字符数).toBeGreaterThan(统计字符数('第一轮'))
    expect(记录列表[0]?.返回字符数).toBe(统计字符数(JSON.stringify({ content: '{"回答":"中A"}' })))
    expect(事件列表.filter((事件) => 事件.类型 === '模型请求审计')).toHaveLength(2)
    expect(智能体实例.读取模型审计汇总()).toEqual({
      模型请求次数: 2,
      新建对话请求次数: 1,
      缓存复用请求次数: 1,
      发出字符数: 记录列表.reduce((总数, 记录) => 总数 + 记录.发出字符数, 0),
      返回字符数: 记录列表.reduce((总数, 记录) => 总数 + 记录.返回字符数, 0),
    })

    智能体实例.清空模型审计记录()
    expect(智能体实例.读取模型审计汇总()).toEqual({
      模型请求次数: 0,
      新建对话请求次数: 0,
      缓存复用请求次数: 0,
      发出字符数: 0,
      返回字符数: 0,
    })
  })

  it('同一轮工具循环的后续模型请求判定为复用已有对话', async (): Promise<void> => {
    流式请求AI模拟
      .mockResolvedValueOnce({ 完整文本: '无效结构', 工具调用列表: [], 已中断: false })
      .mockResolvedValueOnce({ 完整文本: '{"回答":"完成","序号":2}', 工具调用列表: [], 已中断: false })
    let 智能体实例 = new 智能体({ 最大校验重试次数: 1 })

    await 智能体实例.对话({
      ...创建选项('触发两次模型请求'),
      预期结果Schema: z.object({ 回答: z.string(), 序号: z.number() }),
    })

    expect(智能体实例.读取模型审计记录().map((记录) => 记录.缓存判定)).toEqual(['新建对话', '复用已有对话'])
  })

  it('重置对话重新判定为新建，导入状态则保留会话并判定为复用', async (): Promise<void> => {
    let 原实例 = new 智能体({})
    await 原实例.对话(创建选项('原会话'))
    let 原会话标识 = 原实例.读取会话标识()
    let 状态 = await 原实例.导出完整状态()

    原实例.重置对话()
    await 原实例.对话(创建选项('重置后'))
    expect(原实例.读取模型审计记录().map((记录) => 记录.缓存判定)).toEqual(['新建对话', '新建对话'])

    let 恢复实例 = new 智能体({})
    await 恢复实例.导入完整状态(状态)
    expect(恢复实例.读取会话标识()).toBe(原会话标识)
    await 恢复实例.对话(创建选项('恢复后'))
    expect(恢复实例.读取模型审计记录()).toMatchObject([{ 会话标识: 原会话标识, 缓存判定: '复用已有对话' }])
  })
})
