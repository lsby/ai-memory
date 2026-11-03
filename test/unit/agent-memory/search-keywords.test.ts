import { describe, expect, it } from 'vitest'
import { 构建检索关键词 } from '../../../src/agent-memory/tools/search-keywords'

describe('构建检索关键词', (): void => {
  it('为英文查询保留空格短语且不生成无意义的紧凑短语', (): void => {
    let 关键词 = 构建检索关键词('LGBTQ support group')

    expect(关键词).toContain('support group')
    expect(关键词).toContain('LGBTQ support group')
    expect(关键词).not.toContain('supportgroup')
  })

  it('为中文查询生成无空格短语', (): void => {
    let 关键词 = 构建检索关键词('参加支持小组')

    expect(关键词).toContain('支持小组')
  })

  it('为中英混合查询生成自然短语和紧凑短语', (): void => {
    let 关键词 = 构建检索关键词('LGBTQ 支持小组')

    expect(关键词).toContain('LGBTQ 支持小组')
    expect(关键词).toContain('LGBTQ支持小组')
  })

  it('忽略空内容并去重显式目标关键词', (): void => {
    expect(构建检索关键词('，！？', [' 核心 ', '', '核心'])).toEqual(['核心'])
  })

  it('限制长查询的关键词总数并优先保留显式目标关键词', (): void => {
    let 长查询 = Array.from({ length: 100 }, (_, i): string => `word${String(i)}`).join(' ')
    let 关键词 = 构建检索关键词(长查询, ['必须保留'])

    expect(关键词.length).toBeLessThanOrEqual(256)
    expect(关键词[0]).toBe('必须保留')
    expect(关键词).not.toContain('word99')

    let 大量目标关键词 = Array.from({ length: 300 }, (_, i): string => `target${String(i)}`)
    expect(构建检索关键词('', 大量目标关键词)).toHaveLength(256)
  })
})
