import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { 从文本提取工具调用, 从文本提取结果 } from '../src/agent/text-fallback'
import { 智能体工具 } from '../src/index'

describe('文本回退解析', () => {
  let 加法工具 = 智能体工具.创建({
    名称: 'add',
    描述: '计算两个数字之和',
    参数Schema: z.object({ a: z.number(), b: z.number() }),
    返回值Schema: z.object({ 结果: z.enum(['成功', '失败']), 值: z.number() }),
    实现: async ({ a, b }): Promise<{ 结果: '成功'; 值: number }> => ({ 结果: '成功', 值: a + b }),
  })

  it('从 JSON 代码块提取已注册工具并去重', (): void => {
    let 文本 = `请执行以下调用：
\`\`\`json
{"function":{"name":"add","arguments":{"a":2,"b":3}}}
\`\`\``

    let 调用列表 = 从文本提取工具调用(文本, [加法工具])

    expect(调用列表).toEqual([{ id: 'text_extracted_0', 名称: 'add', 参数片段: '{"a":2,"b":3}' }])
  })

  it('提取工具调用时忽略未注册工具', (): void => {
    let 文本 = '{"name":"unknown","arguments":{"value":1}}'

    expect(从文本提取工具调用(文本, [加法工具])).toBeNull()
  })

  it('从工具调用数组中提取多个调用', (): void => {
    let 文本 = `[
  {"name":"add","parameters":{"a":1,"b":2}},
  {"function":{"name":"add","arguments":{"a":3,"b":4}}}
]`

    expect(从文本提取工具调用(文本, [加法工具])).toEqual([
      { id: 'text_extracted_0', 名称: 'add', 参数片段: '{"a":1,"b":2}' },
      { id: 'text_extracted_1', 名称: 'add', 参数片段: '{"a":3,"b":4}' },
    ])
  })

  it('从代码块或内嵌 JSON 提取符合 Schema 的最终结果', (): void => {
    let 结果Schema = z.object({ 答案: z.number() })

    expect(从文本提取结果('结果如下：\n```json\n{"答案": 42}\n```', 结果Schema)).toEqual({ 答案: 42 })
    expect(从文本提取结果('结果是 {"答案":"错误类型"}', 结果Schema)).toBeNull()
  })
})
