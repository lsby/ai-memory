import { describe, expect, it } from 'vitest'
import { 线索信息权重 } from '../../../src/agent-memory/tools/associative-search'

describe('线索 IDF 权重', () => {
  it('不削弱唯一线索，只逐步降低重复线索的权重', (): void => {
    expect(线索信息权重(12, 1)).toBe(1)
    expect(线索信息权重(12, 2)).toBeLessThan(1)
    expect(线索信息权重(12, 6)).toBeLessThan(线索信息权重(12, 2))
    expect(线索信息权重(12, 12)).toBeCloseTo(0.1)
  })

  it('单条记忆场景不进行无意义降权', (): void => {
    expect(线索信息权重(1, 1)).toBe(1)
  })
})
