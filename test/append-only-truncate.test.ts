import { afterEach, describe, expect, it, vi } from 'vitest'
import { 从头截断, 带记忆的智能体, 智能体, 记忆等级, type 智能体消息类型 } from '../src/index'
import { 创建假客户端, 创建选项, 加法工具, 提交 } from './append-only-cache-helper'

afterEach((): void => {
  vi.restoreAllMocks()
})

describe('从头截断', () => {
  function 构造历史(轮数: number): 智能体消息类型[] {
    let 历史: 智能体消息类型[] = [{ role: 'system', content: '系统提示词' }]
    for (let i = 0; i < 轮数; i++) {
      历史.push({
        role: 'user',
        content: `[记忆状态 ${String(i)}]`,
        isSystemInjection: true,
        systemInjectionKind: 'memory-state',
      })
      历史.push({ role: 'user', content: `用户消息${String(i)}`.padEnd(50, '字') })
      历史.push({
        role: 'assistant',
        content: null,
        tool_calls: [{ id: `call_${String(i)}`, type: 'function', function: { name: 'add', arguments: '{}' } }],
      })
      历史.push({ role: 'tool', tool_call_id: `call_${String(i)}`, content: '工具结果'.padEnd(50, '果') })
      历史.push({ role: 'assistant', content: `回答${String(i)}`.padEnd(50, '答') })
    }
    return 历史
  }

  function 断言没有落单的工具结果(历史: 智能体消息类型[]): void {
    let 已声明 = new Set<string>()
    for (let 消息 of 历史) {
      if (消息.role === 'assistant') for (let 调用 of 消息.tool_calls ?? []) 已声明.add(调用.id)
      if (消息.role === 'tool') expect(已声明.has(消息.tool_call_id)).toBe(true)
    }
  }

  it('保留第一条 system，只在真实用户消息边界切，工具调用和工具结果不拆开', (): void => {
    let 历史 = 构造历史(10)

    let 结果 = 从头截断(历史, { 保留字符数: 1500 })

    expect(结果[0]).toEqual(历史[0])
    expect(结果.length).toBeLessThan(历史.length)
    expect(JSON.stringify(结果[1])).toContain('用户消息')
    expect(结果[1]).toMatchObject({ role: 'user' })
    expect(结果[1]).not.toHaveProperty('isSystemInjection')
    断言没有落单的工具结果(结果)
    // 保留的是最近的若干轮, 且和原历史末尾逐条相同
    expect(结果.slice(1)).toEqual(历史.slice(历史.length - (结果.length - 1)))
    expect(历史).toEqual(构造历史(10))
  })

  it('保留额度很小时至少保留最后一轮；历史本来够短时不截断', (): void => {
    let 历史 = 构造历史(4)

    let 极小 = 从头截断(历史, { 保留字符数: 1 })
    let 够短 = 从头截断(历史, { 保留字符数: 1_000_000 })

    expect(极小).toHaveLength(1 + 4)
    expect(JSON.stringify(极小[1])).toContain('用户消息3')
    断言没有落单的工具结果(极小)
    expect(够短).toEqual(历史)
  })

  it('自动截断: 回差生效，不会每轮都截；截断后记忆状态下一轮自动补回', async (): Promise<void> => {
    let 假 = 创建假客户端(Array.from({ length: 20 }, (_, i) => 提交(i)))
    let 实例 = new 带记忆的智能体({
      向量模型: { 类型: '无' },
      自动截断: { 触发字符数: 30000, 保留字符数: 15000 },
    })
    try {
      await 实例.添加记忆({
        内容: '稳定记忆',
        关键词: ['稳定'],
        标签: [],
        评分: 80,
        等级: 记忆等级.一级,
        创建时间: new Date('2026-01-01T00:00:00.000Z'),
      })
      let 历史: 智能体消息类型[] = []
      let 截断轮次: number[] = []
      for (let i = 0; i < 20; i++) {
        let 结果 = await 实例.执行回合({
          ...创建选项(假, `第${String(i)}轮 ${'长'.repeat(1500)}`),
          消息历史: 历史,
        })
        if (结果.历史已截断 === true) {
          截断轮次.push(i)
          历史 = [...(结果.截断后历史 ?? []), ...结果.新增上下文]
          // 截断后的下一次请求里能找回记忆状态: 新增上下文里重新带上
          expect(
            结果.新增上下文.some((消息) => 消息.role === 'user' && 消息.systemInjectionKind === 'memory-state'),
          ).toBe(true)
          断言没有落单的工具结果(结果.消息列表)
        } else {
          历史 = [...历史, ...结果.新增上下文]
        }
      }

      // 回差: 触发值是保留值的两倍, 20 轮里只会截少数几次, 而不是每轮都截
      expect(截断轮次.length).toBeGreaterThan(0)
      expect(截断轮次.length).toBeLessThan(5)
      // 两次截断之间至少隔了好几轮
      for (let i = 1; i < 截断轮次.length; i++) {
        expect((截断轮次[i] ?? 0) - (截断轮次[i - 1] ?? 0)).toBeGreaterThanOrEqual(2)
      }
      expect(历史[0]).toMatchObject({ role: 'system' })
    } finally {
      await 实例.销毁()
    }
  })

  it('自动截断: 对话模式用返回的消息列表整体替换实例历史，且系统前缀不变', async (): Promise<void> => {
    let 假 = 创建假客户端(Array.from({ length: 8 }, (_, i) => 提交(i)))
    let 实例 = new 智能体({ 系统提示词: '提示词', 自动截断: { 触发字符数: 4000, 保留字符数: 1500 } })
    let 是否截断过 = false

    for (let i = 0; i < 8; i++) {
      let 结果 = await 实例.对话(创建选项(假, `第${String(i)}轮 ${'长'.repeat(300)}`))
      if (结果.历史已截断 === true) {
        是否截断过 = true
        expect(实例.读取对话历史()).toEqual(结果.消息列表)
      }
    }

    expect(是否截断过).toBe(true)
    expect(假.请求列表.every((请求) => 请求.messages[0]?.['role'] === 'system')).toBe(true)
    expect(new Set(假.请求列表.map((请求) => JSON.stringify(请求.messages[0]))).size).toBe(1)
  })

  it('自动截断: 配置了触发token数且传入上次输入token数时按 token 数判断', async (): Promise<void> => {
    let 假 = 创建假客户端([提交(1), 提交(2), 提交(3), 提交(4)])
    let 实例 = new 智能体({
      系统提示词: '提示词',
      自动截断: { 触发字符数: 1_000_000, 保留字符数: 200, 触发token数: 1000 },
    })
    let 历史: 智能体消息类型[] = []
    for (let i = 0; i < 2; i++) {
      let 结果 = await 实例.执行回合({ ...创建选项(假, `第${String(i)}轮 ${'长'.repeat(200)}`), 消息历史: 历史 })
      历史 = [...历史, ...结果.新增上下文]
    }

    let 未超 = await 实例.执行回合({ ...创建选项(假, '第三轮'), 消息历史: 历史, 上次输入token数: 500 })
    let 已超 = await 实例.执行回合({ ...创建选项(假, '第四轮'), 消息历史: 历史, 上次输入token数: 2000 })

    expect(未超.历史已截断).toBe(false)
    expect(已超.历史已截断).toBe(true)
    expect(已超.截断后历史?.length).toBeLessThan(历史.length)
  })
})

describe('返回用量', () => {
  it('每次模型请求一项，读不到的字段留空', async (): Promise<void> => {
    let 假 = 创建假客户端([
      {
        工具调用: [{ id: 'c1', 名称: 'add', 参数: { a: 1, b: 2 } }],
        用量: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 64 } },
      },
      { ...提交(3), 用量: { prompt_tokens: 130, completion_tokens: 12 } },
      提交(4),
    ])
    let 实例 = new 智能体({ 系统提示词: '提示词', 工具列表: [加法工具] })

    let 第一轮 = await 实例.对话(创建选项(假, '第一轮'))
    let 第二轮 = await 实例.对话(创建选项(假, '第二轮'))

    expect(第一轮.用量).toEqual([
      { 输入token数: 100, 缓存命中token数: 64, 输出token数: 10 },
      { 输入token数: 130, 输出token数: 12 },
    ])
    expect(第二轮.用量).toEqual([{}])
  })
})
