import { 英文模型语言包 } from '@lsby/ai-agent'
import { describe, expect, it } from 'vitest'

describe('英文模型语言包', () => {
  it('完整保留纯净模式的行为差异', (): void => {
    let 中文说明 =
      '如果为 true（建议），子智能体将是一个完全空白的纯净环境（无记忆），并且底层系统人设会被彻底替换为专家设定，从而获得最高级别的推演纯净度。如果为 false，子智能体会获得你当前所有记忆的快照副本，并完全继承你的基础人设，"专家设定"只会作为一条强制记忆注入，适合需要大量历史上下文的推演。'
    let 英文说明 = 英文模型语言包.模型字段描述(中文说明)
    expect(英文说明).toContain('fully replaced by the expert role')
    expect(英文说明).toContain('maximum reasoning purity')
    expect(英文说明).toContain('injected only as a mandatory memory')
    expect(英文说明).toContain('substantial historical context')
  })
})
