import { afterEach, describe, expect, it, vi } from 'vitest'
import { 带记忆的智能体, 记忆等级 } from '../src/index'

let 特征提取管线模拟 = vi.hoisted(() => vi.fn())

vi.mock('@huggingface/transformers', () => ({
  env: {},
  pipeline: 特征提取管线模拟,
}))

describe('带记忆的智能体的本地向量模型', () => {
  let 智能体实例列表: 带记忆的智能体[] = []

  afterEach(async (): Promise<void> => {
    for (let 智能体实例 of 智能体实例列表) {
      await 智能体实例.销毁()
    }
    智能体实例列表 = []
    特征提取管线模拟.mockReset()
  })

  it('按模型配置分别加载并缓存本地向量提取器', async (): Promise<void> => {
    特征提取管线模拟.mockImplementation(async (): Promise<(文本: string) => Promise<{ data: Float32Array }>> => {
      return async (): Promise<{ data: Float32Array }> => ({ data: new Float32Array([1, 0]) })
    })
    let 第一个智能体 = new 带记忆的智能体({ 向量模型: { 类型: '本地', 模型名称: 'test-model-a' } })
    let 第二个智能体 = new 带记忆的智能体({ 向量模型: { 类型: '本地', 模型名称: 'test-model-b' } })
    let 第三个智能体 = new 带记忆的智能体({ 向量模型: { 类型: '本地', 模型名称: 'test-model-a' } })
    智能体实例列表.push(第一个智能体, 第二个智能体, 第三个智能体)

    for (let 智能体实例 of 智能体实例列表) {
      await 智能体实例.批量注入记忆([
        {
          内容: '需要生成向量的记忆',
          关键词: ['向量'],
          标签: [],
          评分: 80,
          等级: 记忆等级.二级,
          创建时间: new Date('2026-01-01T00:00:00.000Z'),
        },
      ])
    }

    expect(特征提取管线模拟).toHaveBeenCalledTimes(2)
    expect(特征提取管线模拟).toHaveBeenNthCalledWith(1, 'feature-extraction', 'test-model-a', { dtype: 'fp32' })
    expect(特征提取管线模拟).toHaveBeenNthCalledWith(2, 'feature-extraction', 'test-model-b', { dtype: 'fp32' })
  }, 10000)
})
