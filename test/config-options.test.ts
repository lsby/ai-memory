import { afterEach, describe, expect, it } from 'vitest'
import {
  全部记忆工具名,
  带记忆的智能体,
  智能体,
  生成默认记忆提示词,
  记忆工具名,
  记忆等级,
  type 回合结果,
  type 批量注入记忆项,
} from '../src/index'
import { 创建假客户端, 创建选项, 提交, 结果Schema, type 假客户端, type 请求记录 } from './append-only-cache-helper'
import { 旧版记忆提示词 } from './fixtures/legacy-memory-prompt'
import { 使用共享PGlite } from './helpers/shared-pglite-fixture'

let 夹具 = 使用共享PGlite()
let 实例列表: 带记忆的智能体[] = []

function 创建记忆实例(额外选项: Partial<ConstructorParameters<typeof 带记忆的智能体>[0]> = {}): 带记忆的智能体 {
  let 实例 = 夹具.新建智能体({ 向量模型: { 类型: '无' }, ...额外选项 })
  实例列表.push(实例)
  return 实例
}

afterEach(async (): Promise<void> => {
  for (let 实例 of 实例列表) await 实例.销毁()
  实例列表 = []
})

function 取工具名列表(请求: 请求记录 | undefined): string[] {
  return ((请求?.tools ?? []) as { function: { name: string } }[]).map((工具) => 工具.function.name)
}

function 取系统提示词(请求: 请求记录 | undefined): string {
  let 内容 = 请求?.messages[0]?.['content']
  if (typeof 内容 !== 'string') throw new Error('第一条不是 system 文本')
  return 内容
}

function 取注入文本(请求: 请求记录 | undefined, 前缀: string): string {
  let 消息 = 请求?.messages.find((项) => typeof 项['content'] === 'string' && 项['content'].startsWith(前缀))
  if (typeof 消息?.['content'] !== 'string') throw new Error(`没有以 ${前缀} 开头的消息`)
  return 消息['content']
}

async function 跑一轮(
  实例: 带记忆的智能体 | 智能体,
  额外: { 当前时间?: Date; 时区?: string } = {},
): Promise<{ 假: 假客户端; 结果: 回合结果<typeof 结果Schema> }> {
  let 假 = 创建假客户端([提交(1)])
  let 选项 = { ...创建选项(假, '你好'), ...额外 }
  let 结果 = 实例 instanceof 带记忆的智能体 ? await 实例.对话({ ...选项, 是否自动召回: false }) : await 实例.对话(选项)
  return { 假, 结果 }
}

describe('P1 记忆工具筛选', () => {
  it('不传筛选时全部记忆工具都挂上', async (): Promise<void> => {
    let { 假 } = await 跑一轮(创建记忆实例())
    let 工具名 = 取工具名列表(假.请求列表[0])
    expect([...工具名].sort()).toEqual([...全部记忆工具名, '__submit_result__'].sort())
  })

  it('常量导出了全部记忆工具名且没有重复', () => {
    expect(new Set(全部记忆工具名).size).toBe(全部记忆工具名.length)
    expect(全部记忆工具名).toContain(记忆工具名.回忆延伸)
    expect(记忆工具名.添加零级记忆).toBe('add_level_0_memory')
  })

  it('被筛掉的工具不出现在工具定义里, 提示词也不再提动态工具', async (): Promise<void> => {
    let 动态工具名 = new Set<string>([
      记忆工具名.创建动态工具,
      记忆工具名.查看动态工具代码,
      记忆工具名.更新动态工具,
      记忆工具名.删除动态工具,
      记忆工具名.调用动态工具,
    ])
    let { 假 } = await 跑一轮(创建记忆实例({ 记忆工具筛选: (名称) => 动态工具名.has(名称) === false }))
    let 请求 = 假.请求列表[0]
    let 工具名 = 取工具名列表(请求)
    for (let 名称 of 动态工具名) expect(工具名).not.toContain(名称)
    expect(工具名).toContain(记忆工具名.添加零级记忆)
    let 系统提示词 = 取系统提示词(请求)
    expect(系统提示词).not.toContain('动态工具系统')
    expect(系统提示词).not.toContain('create_dynamic_tool')
    expect(系统提示词).toContain('记忆系统操作指南')
    expect(系统提示词).toContain('认知进化范式')
  })

  it('筛掉回忆延伸后, 提示词不再让模型用回忆延伸深挖', async (): Promise<void> => {
    let { 假 } = await 跑一轮(创建记忆实例({ 记忆工具筛选: (名称) => 名称 !== 记忆工具名.回忆延伸 }))
    let 请求 = 假.请求列表[0]
    expect(取工具名列表(请求)).not.toContain('extend_memory')
    let 系统提示词 = 取系统提示词(请求)
    expect(系统提示词).not.toContain('回忆延伸')
    expect(系统提示词).toContain('3. [二级记忆 (部分唤起 + 主动深挖)]')
  })

  it('只保留回忆延伸时, 不写需要修改记忆的几段, 也不写动态工具', async (): Promise<void> => {
    let { 假 } = await 跑一轮(创建记忆实例({ 记忆工具筛选: (名称) => 名称 === 记忆工具名.回忆延伸 }))
    let 请求 = 假.请求列表[0]
    expect(取工具名列表(请求).sort()).toEqual(['__submit_result__', 'extend_memory'])
    let 系统提示词 = 取系统提示词(请求)
    expect(系统提示词).not.toContain('认知进化范式')
    expect(系统提示词).not.toContain('经验沉淀')
    expect(系统提示词).not.toContain('关键词与标签')
    expect(系统提示词).not.toContain('动态工具系统')
    expect(系统提示词).toContain('「回忆延伸」')
  })

  it('动态工具只留一部分时, 维护管理那一条只列出还在的工具', () => {
    let 文本 = 生成默认记忆提示词([记忆工具名.创建动态工具, 记忆工具名.删除动态工具, 记忆工具名.添加零级记忆])
    expect(文本).toContain('- **维护管理**: 使用 `delete_dynamic_tool` 删除工具。')
    expect(文本).not.toContain('view_dynamic_tool_code')
    expect(文本).not.toContain('call_dynamic_tool')
    expect(文本).toContain('- **安全沙盒**')
  })

  it('禁用深度推演仍然生效, 并且从启用的工具名里去掉', async (): Promise<void> => {
    let 收到: string[] = []
    let { 假 } = await 跑一轮(
      创建记忆实例({
        禁用深度推演: true,
        记忆提示词: (启用的工具名) => {
          收到 = 启用的工具名
          return '自定义'
        },
      }),
    )
    expect(取工具名列表(假.请求列表[0])).not.toContain('deep_deduction')
    expect(收到).not.toContain('deep_deduction')
    expect(收到).toContain('execute_code')
  })

  it('换了筛选以后, 旧历史得到 前缀已变 且不发请求', async (): Promise<void> => {
    let 甲 = 创建记忆实例()
    let { 假, 结果 } = await 跑一轮(甲)
    let 乙 = 创建记忆实例({ 记忆工具筛选: (名称) => 名称 !== 记忆工具名.执行代码 })
    let 请求数 = 假.请求列表.length
    let 第二轮 = await 乙.执行回合({ ...创建选项(假, '第二轮'), 消息历史: 结果.消息列表 })
    expect(第二轮.结束原因).toBe('前缀已变')
    expect(假.请求列表).toHaveLength(请求数)
    // 同样的筛选则前缀一致
    let 丙 = 创建记忆实例()
    let 假2 = 创建假客户端([提交(2)])
    let 第三轮 = await 丙.执行回合({ ...创建选项(假2, '第二轮'), 消息历史: 结果.消息列表 })
    expect(第三轮.结束原因).toBeUndefined()
  })
})

describe('P2 记忆提示词', () => {
  it('默认提示词只包含记忆操作指南, 不暴露历史不可变的实现机制', () => {
    let 提示词 = 生成默认记忆提示词(全部记忆工具名)
    expect(提示词).not.toContain('记忆历史不可改写')
    expect(提示词).not.toContain('对话上下文不可改写')
    expect(提示词).toBe(旧版记忆提示词)
  })

  it('默认实例发给模型的系统提示词里只有旧版操作指南', async (): Promise<void> => {
    let { 假 } = await 跑一轮(创建记忆实例())
    let 系统提示词 = 取系统提示词(假.请求列表[0])
    expect(系统提示词).not.toContain('记忆历史不可改写')
    expect(系统提示词).not.toContain('对话上下文不可改写')
    expect(系统提示词.endsWith(旧版记忆提示词)).toBe(true)
  })

  it('传字符串时完整替换操作指南且不附加机制提示', async (): Promise<void> => {
    let 英文提示词 = '## Memory rules\nStore verified facts only.'
    let { 假 } = await 跑一轮(创建记忆实例({ 记忆提示词: 英文提示词 }))
    let 系统提示词 = 取系统提示词(假.请求列表[0])
    expect(系统提示词).not.toContain('记忆历史不可改写')
    expect(系统提示词).not.toContain('对话上下文不可改写')
    expect(系统提示词.endsWith(英文提示词)).toBe(true)
    expect(系统提示词).not.toContain('记忆系统操作指南')
  })

  it('传函数时收到启用的工具名, 返回值作为提示词, 构造时只调用一次', async (): Promise<void> => {
    let 调用次数 = 0
    let 收到: string[] = []
    let 实例 = 创建记忆实例({
      记忆工具筛选: (名称) => 名称.startsWith('add_'),
      记忆提示词: (启用的工具名) => {
        调用次数++
        收到 = 启用的工具名
        return `只有这些工具: ${启用的工具名.join(',')}`
      },
    })
    expect(调用次数).toBe(1)
    let { 假 } = await 跑一轮(实例)
    await 实例.对话({ ...创建选项(创建假客户端([提交(2)]), '第二'), 是否自动召回: false })
    expect(调用次数).toBe(1)
    expect(收到).toEqual(['add_level_0_memory', 'add_level_1_memory', 'add_level_2_memory'])
    expect(
      取系统提示词(假.请求列表[0]).endsWith('只有这些工具: add_level_0_memory,add_level_1_memory,add_level_2_memory'),
    ).toBe(true)
  })

  it('换了记忆提示词也会让旧历史 前缀已变', async (): Promise<void> => {
    let { 假, 结果 } = await 跑一轮(创建记忆实例())
    let 乙 = 创建记忆实例({ 记忆提示词: '换了' })
    let 第二轮 = await 乙.执行回合({ ...创建选项(假, '第二轮'), 消息历史: 结果.消息列表 })
    expect(第二轮.结束原因).toBe('前缀已变')
  })
})

describe('P3 时区', () => {
  let 时刻 = new Date('2026-01-01T00:30:15.123Z')

  async function 当前时间文本(
    实例: 带记忆的智能体 | 智能体,
    额外: { 当前时间?: Date; 时区?: string } = {},
  ): Promise<string> {
    let { 假 } = await 跑一轮(实例, { 当前时间: 时刻, ...额外 })
    return 取注入文本(假.请求列表[0], '[当前时间: ')
  }

  it('实例上设置的时区用于当前时间注入', async (): Promise<void> => {
    expect(await 当前时间文本(new 智能体({ 时区: 'Asia/Shanghai' }))).toBe('[当前时间: 2026-01-01T08:30:15.123+08:00]')
    expect(await 当前时间文本(new 智能体({ 时区: 'America/New_York' }))).toBe(
      '[当前时间: 2025-12-31T19:30:15.123-05:00]',
    )
    expect(await 当前时间文本(new 智能体({ 时区: 'UTC' }))).toBe('[当前时间: 2026-01-01T00:30:15.123+00:00]')
    expect(await 当前时间文本(new 智能体({ 时区: 'Asia/Kolkata' }))).toBe('[当前时间: 2026-01-01T06:00:15.123+05:30]')
  })

  it('夏令时按当时的偏移计算', async (): Promise<void> => {
    let 夏天 = new Date('2026-07-01T12:00:00.000Z')
    expect(await 当前时间文本(new 智能体({ 时区: 'America/New_York' }), { 当前时间: 夏天 })).toBe(
      '[当前时间: 2026-07-01T08:00:00.000-04:00]',
    )
  })

  it('按次传的时区优先于实例', async (): Promise<void> => {
    expect(await 当前时间文本(new 智能体({ 时区: 'Asia/Shanghai' }), { 时区: 'Asia/Tokyo' })).toBe(
      '[当前时间: 2026-01-01T09:30:15.123+09:00]',
    )
  })

  it('不传时区时照旧用服务器时区', async (): Promise<void> => {
    let 服务器时区 = Intl.DateTimeFormat().resolvedOptions().timeZone
    let 不传 = await 当前时间文本(new 智能体({}))
    expect(不传).toMatch(/^\[当前时间: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.123[+-]\d{2}:\d{2}\]$/)
    expect(不传).toBe(await 当前时间文本(new 智能体({ 时区: 服务器时区 })))
  })

  it('时区只影响按次追加的当前时间, 不影响前缀指纹', async (): Promise<void> => {
    let 甲 = await 跑一轮(new 智能体({ 系统提示词: '固定', 时区: 'Asia/Shanghai' }))
    let 乙 = await 跑一轮(new 智能体({ 系统提示词: '固定', 时区: 'America/New_York' }))
    expect(甲.结果.消息列表[0]).toEqual(乙.结果.消息列表[0])
  })

  it('非法时区名在构造时报清楚的错误', () => {
    expect(() => new 智能体({ 时区: 'Mars/Olympus' })).toThrow(/时区 "Mars\/Olympus" 不是有效的 IANA 时区名/)
    expect(() => new 带记忆的智能体({ 时区: '乱写', 向量模型: { 类型: '无' } })).toThrow(/不是有效的 IANA 时区名/)
  })

  it('非法的按次时区在调用时报错, 并且不发请求', async (): Promise<void> => {
    let 实例 = new 智能体({})
    let 假 = 创建假客户端([提交(1)])
    await expect(实例.对话({ ...创建选项(假, '你好'), 时区: '乱写' })).rejects.toThrow(/不是有效的 IANA 时区名/)
    expect(假.请求列表).toHaveLength(0)
    let 记忆实例 = 创建记忆实例()
    await expect(记忆实例.对话({ ...创建选项(假, '你好'), 时区: '乱写' })).rejects.toThrow(/不是有效的 IANA 时区名/)
    expect(假.请求列表).toHaveLength(0)
  })

  it('记忆状态里的"记录于"按时区显示, 按次优先于实例', async (): Promise<void> => {
    let 注入 = async (实例时区: string | undefined, 按次时区: string | undefined): Promise<string> => {
      let 实例 = 创建记忆实例(实例时区 === undefined ? {} : { 时区: 实例时区 })
      await 实例.添加记忆({
        内容: '一级记忆',
        关键词: ['一级'],
        标签: [],
        评分: 80,
        等级: 记忆等级.一级,
        创建时间: new Date('2026-01-01T00:00:00.000Z'),
      })
      let { 假 } = await 跑一轮(实例, 按次时区 === undefined ? {} : { 时区: 按次时区 })
      return 取注入文本(假.请求列表[0], '### 本轮最新记忆状态')
    }
    expect(await 注入('Asia/Shanghai', undefined)).toContain('记录于2026-01-01T08:00:00.000+08:00')
    expect(await 注入('Asia/Shanghai', 'America/New_York')).toContain('记录于2025-12-31T19:00:00.000-05:00')
    expect(await 注入(undefined, undefined)).toMatch(/记录于\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000[+-]\d{2}:\d{2}/)
  })

  it('换时区后记忆状态会重新追加一条, 不换则不重复', async (): Promise<void> => {
    let 实例 = 创建记忆实例({ 时区: 'Asia/Shanghai' })
    await 实例.添加记忆({
      内容: '一级记忆',
      关键词: ['一级'],
      标签: [],
      评分: 80,
      等级: 记忆等级.一级,
      创建时间: new Date('2026-01-01T00:00:00.000Z'),
    })
    let 假 = 创建假客户端([提交(1), 提交(2), 提交(3)])
    let 选项 = { 是否自动召回: false }
    await 实例.对话({ ...创建选项(假, '一'), ...选项 })
    await 实例.对话({ ...创建选项(假, '二'), ...选项 })
    await 实例.对话({ ...创建选项(假, '三'), ...选项, 时区: 'UTC' })
    let 状态条数 = (请求: 请求记录 | undefined): number =>
      (请求?.messages ?? []).filter(
        (项) => typeof 项['content'] === 'string' && 项['content'].startsWith('### 本轮最新记忆状态'),
      ).length
    expect(状态条数(假.请求列表[0])).toBe(1)
    expect(状态条数(假.请求列表[1])).toBe(1)
    expect(状态条数(假.请求列表[2])).toBe(2)
  })
})

describe('P4 额外请求参数', () => {
  it('合并进每次请求体, 且不覆盖库自己管理的字段', async (): Promise<void> => {
    let 实例 = new 智能体({ 额外请求参数: { thinking: { type: 'disabled' }, seed: 7 } })
    let 假 = 创建假客户端([提交(1)])
    await 实例.对话(创建选项(假, '你好'))
    let 请求 = 假.请求列表[0] as Record<string, unknown> | undefined
    expect(请求?.['thinking']).toEqual({ type: 'disabled' })
    expect(请求?.['seed']).toBe(7)
    expect(请求?.['model']).toBe('mock-model')
    expect(请求?.['stream']).toBe(true)
    expect(Array.isArray(请求?.['messages'])).toBe(true)
    expect(Array.isArray(请求?.['tools'])).toBe(true)
  })

  it('带记忆的智能体同样生效', async (): Promise<void> => {
    let { 假 } = await 跑一轮(创建记忆实例({ 额外请求参数: { thinking: { type: 'disabled' } } }))
    expect((假.请求列表[0] as Record<string, unknown> | undefined)?.['thinking']).toEqual({ type: 'disabled' })
  })

  it('包含 model、messages、tools、stream、stream_options 时构造报错', () => {
    for (let 字段 of ['model', 'messages', 'tools', 'stream', 'stream_options']) {
      expect(() => new 智能体({ 额外请求参数: { [字段]: 1 } })).toThrow(/不能包含库自己管理的字段/)
    }
    expect(() => new 带记忆的智能体({ 额外请求参数: { model: 'x' }, 向量模型: { 类型: '无' } })).toThrow(/model/)
  })

  it('构造后改动传入的对象不影响实例', async (): Promise<void> => {
    let 参数: Record<string, unknown> = { a: 1 }
    let 实例 = new 智能体({ 额外请求参数: 参数 })
    参数['a'] = 2
    let 假 = 创建假客户端([提交(1)])
    await 实例.对话(创建选项(假, '你好'))
    expect((假.请求列表[0] as Record<string, unknown> | undefined)?.['a']).toBe(1)
  })

  it('不算进前缀指纹: 额外参数不同的实例接着同一份历史继续', async (): Promise<void> => {
    let 甲 = await 跑一轮(new 智能体({ 系统提示词: '固定', 额外请求参数: { a: 1 } }))
    let 乙 = new 智能体({ 系统提示词: '固定', 额外请求参数: { a: 2 } })
    let 假 = 创建假客户端([提交(2)])
    let 第二轮 = await 乙.执行回合({ ...创建选项(假, '第二轮'), 消息历史: 甲.结果.消息列表 })
    expect(第二轮.结束原因).toBeUndefined()
    expect(假.请求列表).toHaveLength(1)
    let 无参 = new 智能体({ 系统提示词: '固定' })
    let 第三轮 = await 无参.执行回合({ ...创建选项(创建假客户端([提交(3)]), '第三轮'), 消息历史: 甲.结果.消息列表 })
    expect(第三轮.结束原因).toBeUndefined()
  })
})

describe('P5 遗忘豁免', () => {
  let 创建时间 = new Date('2026-01-01T00:00:00.000Z')

  function 二级记忆(内容: string, 评分: number, 标签: string[] = []): 批量注入记忆项 {
    return { 内容, 关键词: [内容], 标签, 评分, 等级: 记忆等级.二级, 创建时间 }
  }

  function 一批记忆(数量: number, 评分: number): 批量注入记忆项[] {
    return Array.from({ length: 数量 }, (_, i) => 二级记忆(`普通记忆${String(i)}`, 评分))
  }

  it('末位淘汰: 豁免的低分旧记忆在大量写入冲刷后仍在, 不豁免的被淘汰', async (): Promise<void> => {
    let 选项 = { 二级记忆数量上限: 5, 二级记忆遗忘分数阈值: 0 }
    let 带豁免 = 创建记忆实例({ ...选项, 遗忘豁免: (记忆) => 记忆.标签.includes('关键事实') })
    let 不豁免 = 创建记忆实例(选项)
    for (let 实例 of [带豁免, 不豁免]) {
      await 实例.批量注入记忆([二级记忆('老板的生日是三月三日', 1, ['关键事实']), ...一批记忆(20, 50)])
    }
    let 带豁免内容 = (await 带豁免.查询记忆()).map((记忆) => 记忆.内容)
    let 不豁免内容 = (await 不豁免.查询记忆()).map((记忆) => 记忆.内容)
    expect(带豁免内容).toHaveLength(5)
    expect(带豁免内容).toContain('老板的生日是三月三日')
    expect(不豁免内容).toHaveLength(5)
    expect(不豁免内容).not.toContain('老板的生日是三月三日')
  })

  it('自然遗忘: 低于阈值的记忆被忘掉, 豁免的留下, 且关联边一起被清理', async (): Promise<void> => {
    let 选项 = { 二级记忆遗忘分数阈值: 10 }
    let 带豁免 = 创建记忆实例({ ...选项, 遗忘豁免: (记忆) => 记忆.标签.includes('关键事实') })
    let 不豁免 = 创建记忆实例(选项)
    for (let 实例 of [带豁免, 不豁免]) {
      await 实例.批量注入记忆([二级记忆('必须记住的事', 5, ['关键事实']), ...一批记忆(8, 5)])
    }
    expect((await 带豁免.查询记忆()).map((记忆) => 记忆.内容)).toEqual(['必须记住的事'])
    expect(await 不豁免.查询记忆()).toHaveLength(0)
    expect((await 带豁免.查询记忆关联()).every((边) => 边.起点id !== 边.终点id)).toBe(true)
  })

  it('豁免回调拿到的是公开记忆, 并且豁免的记忆仍计入数量上限', async (): Promise<void> => {
    let 看到: string[] = []
    let 实例 = 创建记忆实例({
      二级记忆数量上限: 3,
      二级记忆遗忘分数阈值: 0,
      遗忘豁免: (记忆) => {
        看到.push(`${记忆.等级}:${记忆.内容}`)
        return 记忆.内容.startsWith('留')
      },
    })
    await 实例.批量注入记忆([...Array.from({ length: 4 }, (_, i) => 二级记忆(`留${String(i)}`, 1)), ...一批记忆(3, 90)])
    let 剩余 = (await 实例.查询记忆()).map((记忆) => 记忆.内容)
    // 4 条豁免已经超过上限 3, 普通记忆全被淘汰, 豁免的一条不少
    expect(剩余.sort()).toEqual(['留0', '留1', '留2', '留3'])
    expect(看到.length).toBeGreaterThan(0)
    expect(看到.every((项) => 项.startsWith('二级:'))).toBe(true)
  })

  it('默认不豁免任何记忆: 和没传回调时的行为一致', async (): Promise<void> => {
    let 选项 = { 二级记忆数量上限: 5, 二级记忆遗忘分数阈值: 0 }
    let 默认 = 创建记忆实例(选项)
    let 全不豁免 = 创建记忆实例({ ...选项, 遗忘豁免: () => false })
    for (let 实例 of [默认, 全不豁免]) await 实例.批量注入记忆([二级记忆('最老的', 1), ...一批记忆(10, 50)])
    let 内容 = async (实例: 带记忆的智能体): Promise<string[]> =>
      (await 实例.查询记忆()).map((记忆) => 记忆.内容).sort()
    expect(await 内容(默认)).toEqual(await 内容(全不豁免))
    expect(await 内容(默认)).toHaveLength(5)
    expect(await 内容(默认)).not.toContain('最老的')
  })
})
