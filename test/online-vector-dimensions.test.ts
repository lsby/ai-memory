import type OpenAI from 'openai'
import { describe, expect, it } from 'vitest'
import { 获取向量 } from '../src/agent-memory/tools/get-vector'
import { 带记忆的智能体 } from '../src/index'

function 创建假OpenAI(返回长度: number): { 客户端: OpenAI; 请求列表: Record<string, unknown>[] } {
  let 请求列表: Record<string, unknown>[] = []
  let 客户端 = {
    embeddings: {
      create: async (请求: Record<string, unknown>): Promise<{ data: { embedding: number[] }[] }> => {
        请求列表.push(请求)
        return { data: [{ embedding: new Array<number>(返回长度).fill(0.5) }] }
      },
    },
  } as unknown as OpenAI
  return { 客户端, 请求列表 }
}

describe('在线向量模型的维度', () => {
  it('传了维度时请求带 dimensions', async (): Promise<void> => {
    let { 客户端, 请求列表 } = 创建假OpenAI(256)
    let 结果 = await 获取向量({ 类型: '在线', openai客户端: 客户端, 模型名称: 'm', 维度: 256 }, '你好')
    expect(结果.类型).toBe('成功')
    expect(请求列表).toEqual([{ model: 'm', input: '你好', dimensions: 256 }])
  })

  it('不传维度时请求不带 dimensions', async (): Promise<void> => {
    let { 客户端, 请求列表 } = 创建假OpenAI(1024)
    let 结果 = await 获取向量({ 类型: '在线', openai客户端: 客户端, 模型名称: 'm' }, '你好')
    expect(结果.类型).toBe('成功')
    expect(请求列表).toEqual([{ model: 'm', input: '你好' }])
    expect('dimensions' in (请求列表[0] ?? {})).toBe(false)
  })

  it('返回长度和维度不一致时返回失败', async (): Promise<void> => {
    let { 客户端 } = 创建假OpenAI(512)
    let 结果 = await 获取向量({ 类型: '在线', openai客户端: 客户端, 模型名称: 'm', 维度: 256 }, '你好')
    expect(结果.类型).toBe('失败')
    if (结果.类型 === '失败') expect(结果.错误信息).toMatch(/512.*256.*不一致/)
  })

  it('构造时维度非法会报错', (): void => {
    let { 客户端 } = 创建假OpenAI(1)
    for (let 非法 of [0, -1, 1.5, Number.NaN]) {
      expect(
        () => new 带记忆的智能体({ 向量模型: { 类型: '在线', openai客户端: 客户端, 模型名称: 'm', 维度: 非法 } }),
      ).toThrow(/向量模型\.维度 必须是正整数/)
    }
  })
})
