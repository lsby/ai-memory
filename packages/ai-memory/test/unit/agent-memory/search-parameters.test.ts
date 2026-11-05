import { describe, expect, it } from 'vitest'
import { 对话搜索参数Schema } from '../../../src/operations/conversation-search'
import {
  时间范围Schema,
  符合过滤内容模式,
  解析时间范围,
  过滤内容模式Schema,
} from '../../../src/operations/search-parameters'

describe('搜索工具公共参数', () => {
  it('过滤内容模式默认为 and，并支持显式 or', (): void => {
    expect(过滤内容模式Schema.parse(undefined)).toBe('and')
    expect(过滤内容模式Schema.parse('or')).toBe('or')
    expect(符合过滤内容模式([true, false], 'and')).toBe(false)
    expect(符合过滤内容模式([true, false], 'or')).toBe(true)
    expect(对话搜索参数Schema.parse({ 查询内容: '测试' })).toMatchObject({ 过滤内容模式: 'and', 上下文消息数: 5 })
  })

  it('直接解析绝对时间范围', (): void => {
    let 范围 = 解析时间范围(
      时间范围Schema.parse({ 开始时间: '2000-01-01T00:00:00.000Z', 结束时间: '2000-01-02T00:00:00.000Z' }),
    )
    expect(范围.开始时间?.toISOString()).toBe('2000-01-01T00:00:00.000Z')
    expect(范围.结束时间?.toISOString()).toBe('2000-01-02T00:00:00.000Z')
  })

  it('拒绝开始时间不早于结束时间的范围', (): void => {
    expect(() =>
      解析时间范围(
        时间范围Schema.parse({ 开始时间: '2000-01-02T00:00:00.000Z', 结束时间: '2000-01-01T00:00:00.000Z' }),
      ),
    ).toThrow('开始时间必须早于结束时间')
  })
})
