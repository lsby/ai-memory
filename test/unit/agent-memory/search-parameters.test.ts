import { describe, expect, it, vi } from 'vitest'
import { 对话搜索参数Schema } from '../../../src/agent-memory/operations/conversation-search'
import {
  时间范围Schema,
  符合过滤内容模式,
  解析时间范围,
  过滤内容模式Schema,
} from '../../../src/agent-memory/operations/search-parameters'

describe('搜索工具公共参数', () => {
  it('过滤内容模式默认为与，并支持显式或', (): void => {
    expect(过滤内容模式Schema.parse(undefined)).toBe('与')
    expect(过滤内容模式Schema.parse('或')).toBe('或')
    expect(符合过滤内容模式([true, false], '与')).toBe(false)
    expect(符合过滤内容模式([true, false], '或')).toBe(true)
    expect(对话搜索参数Schema.parse({ 查询内容: '测试' })).toMatchObject({ 过滤内容模式: '与', 上下文消息数: 5 })
  })

  it('相对时间以指定基准计算，未指定基准时使用当前时间', (): void => {
    let 指定基准 = 解析时间范围(
      时间范围Schema.parse({ 基准: '2000-01-01T00:00:00.000Z', 开始相对天数: 10, 结束相对天数: 2 }),
    )
    expect(指定基准.开始时间?.toISOString()).toBe('1999-12-22T00:00:00.000Z')
    expect(指定基准.结束时间?.toISOString()).toBe('1999-12-30T00:00:00.000Z')

    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-11-04T00:00:00.000Z'))
      let 当前基准 = 解析时间范围(时间范围Schema.parse({ 开始相对天数: 1, 结束相对天数: 0 }))
      expect(当前基准.开始时间?.toISOString()).toBe('2026-11-03T00:00:00.000Z')
      expect(当前基准.结束时间?.toISOString()).toBe('2026-11-04T00:00:00.000Z')
    } finally {
      vi.useRealTimers()
    }
  })

  it('拒绝开始时间不早于结束时间的范围', (): void => {
    expect(() => 解析时间范围(时间范围Schema.parse({ 开始相对天数: 0, 结束相对天数: 10 }))).toThrow(
      '开始时间必须早于结束时间',
    )
  })
})
