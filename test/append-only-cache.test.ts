import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { 智能体, 记忆等级, type 智能体消息类型 } from '../src/index'
import { 创建假客户端, 创建选项, 加法工具, 报错工具, 提交, 断言前缀稳定 } from './append-only-cache-helper'
import { 使用共享PGlite } from './helpers/shared-pglite-fixture'

let 夹具 = 使用共享PGlite()

afterEach((): void => {
  vi.restoreAllMocks()
})

describe('只追加、前缀不变', () => {
  it('正常提交结果: 连续多轮的请求互为前缀, 且发给模型的 system 不带内部指纹字段', async (): Promise<void> => {
    let 假 = 创建假客户端([
      { 工具调用: [{ id: 'c1', 名称: 'add', 参数: { a: 1, b: 2 } }] },
      提交(3),
      提交(4),
      { 工具调用: [{ id: 'c2', 名称: 'add', 参数: { a: 2, b: 2 } }] },
      提交(5),
    ])
    let 实例 = new 智能体({ 系统提示词: '固定系统提示词', 工具列表: [加法工具] })

    let 第一轮 = await 实例.对话(创建选项(假, '第一轮'))
    await 实例.对话(创建选项(假, '第二轮'))
    await 实例.对话(创建选项(假, '第三轮'))

    expect(第一轮.结果).toEqual({ 答案: 3 })
    expect(假.请求列表).toHaveLength(5)
    断言前缀稳定(假.请求列表)
    let 首条 = 假.请求列表[0]?.messages[0]
    expect(首条?.['role']).toBe('system')
    expect(首条).not.toHaveProperty('prefixFingerprint')
    // 首轮的新增上下文第一条就是带指纹的 system, 调用方原样存下即可
    expect(第一轮.新增上下文[0]).toMatchObject({ role: 'system' })
    expect(第一轮.新增上下文[0]).toHaveProperty('prefixFingerprint')
  })

  it('执行回合: 调用方把新增上下文原样追加到自己的历史, 多轮仍互为前缀', async (): Promise<void> => {
    let 假 = 创建假客户端([提交(1), 提交(2), 提交(3)])
    let 实例 = new 智能体({ 系统提示词: '固定系统提示词', 工具列表: [加法工具] })
    let 历史: 智能体消息类型[] = []
    for (let 命令 of ['一', '二', '三']) {
      let 结果 = await 实例.执行回合({ ...创建选项(假, 命令), 消息历史: 历史 })
      历史 = [...历史, ...结果.新增上下文]
    }
    断言前缀稳定(假.请求列表)
    expect(历史.filter((消息) => 消息.role === 'system')).toHaveLength(1)
  })

  it('纯文本兜底后下一轮仍保持前缀', async (): Promise<void> => {
    let 假 = 创建假客户端([{ 文本: '这是纯文本回答' }, { 文本: '另一个纯文本回答' }])
    let 实例 = new 智能体({ 系统提示词: '固定系统提示词' })
    let 文本结果Schema = z.object({ 内容: z.string() })

    let 第一轮 = await 实例.对话({ ...创建选项(假, '第一轮'), 预期结果Schema: 文本结果Schema })
    await 实例.对话({ ...创建选项(假, '第二轮'), 预期结果Schema: 文本结果Schema })

    expect(第一轮.结果).toEqual({ 内容: '这是纯文本回答' })
    断言前缀稳定(假.请求列表)
  })

  it('从文本中提取工具调用后保持前缀', async (): Promise<void> => {
    let 假 = 创建假客户端([
      { 文本: '```json\n{"function":{"name":"add","arguments":{"a":2,"b":3}}}\n```' },
      提交(5),
      提交(6),
    ])
    let 实例 = new 智能体({ 系统提示词: '固定系统提示词', 工具列表: [加法工具] })

    let 第一轮 = await 实例.对话(创建选项(假, '第一轮'))
    await 实例.对话(创建选项(假, '第二轮'))

    expect(第一轮.结果).toEqual({ 答案: 5 })
    expect(假.请求列表).toHaveLength(3)
    断言前缀稳定(假.请求列表)
  })

  it('校验失败重试后保持前缀', async (): Promise<void> => {
    let 假 = 创建假客户端([
      { 工具调用: [{ id: 'bad', 名称: '__submit_result__', 参数: { 答案: '不是数字' } }] },
      提交(7),
      提交(8),
    ])
    let 实例 = new 智能体({ 系统提示词: '固定系统提示词' })

    let 第一轮 = await 实例.对话(创建选项(假, '第一轮'))
    await 实例.对话(创建选项(假, '第二轮'))

    expect(第一轮.结果).toEqual({ 答案: 7 })
    expect(假.请求列表).toHaveLength(3)
    断言前缀稳定(假.请求列表)
  })

  it('工具报错后保持前缀', async (): Promise<void> => {
    let 假 = 创建假客户端([{ 工具调用: [{ id: 'b1', 名称: 'boom', 参数: {} }] }, 提交(1), 提交(2)])
    let 实例 = new 智能体({ 系统提示词: '固定系统提示词', 工具列表: [报错工具] })

    let 第一轮 = await 实例.对话(创建选项(假, '第一轮'))
    await 实例.对话(创建选项(假, '第二轮'))

    expect(第一轮.结果).toEqual({ 答案: 1 })
    expect(JSON.stringify(第一轮.消息列表)).toContain('工具炸了')
    断言前缀稳定(假.请求列表)
  })

  it('请求过程中被中断后，下一轮仍以上一次请求为前缀', async (): Promise<void> => {
    let 假 = 创建假客户端([提交(1), { 中断: true }, 提交(3)])
    let 实例 = new 智能体({ 系统提示词: '固定系统提示词' })

    await 实例.对话(创建选项(假, '第一轮'))
    let 第二轮 = await 实例.对话({ ...创建选项(假, '第二轮'), 中断信号: new AbortController().signal })
    let 第三轮 = await 实例.对话(创建选项(假, '第三轮'))

    expect(第二轮.结束原因).toBe('中断')
    expect(第三轮.结果).toEqual({ 答案: 3 })
    断言前缀稳定(假.请求列表)
  })

  it('请求前已中断时不发请求，历史也不被改写', async (): Promise<void> => {
    let 假 = 创建假客户端([提交(1), 提交(3)])
    let 实例 = new 智能体({ 系统提示词: '固定系统提示词' })
    let 控制器 = new AbortController()

    await 实例.对话(创建选项(假, '第一轮'))
    控制器.abort()
    let 第二轮 = await 实例.对话({ ...创建选项(假, '第二轮'), 中断信号: 控制器.signal })
    await 实例.对话(创建选项(假, '第三轮'))

    expect(第二轮.结束原因).toBe('中断')
    expect(假.请求列表).toHaveLength(2)
    断言前缀稳定(假.请求列表)
  })

  it('超出最大轮次后保持前缀', async (): Promise<void> => {
    let 假 = 创建假客户端([{ 文本: '' }, { 文本: '' }, 提交(9)])
    let 实例 = new 智能体({ 系统提示词: '固定系统提示词', 最大循环轮次: 2 })

    let 第一轮 = await 实例.对话(创建选项(假, '第一轮'))
    let 第二轮 = await 实例.对话(创建选项(假, '第二轮'))

    expect(第一轮.结束原因).toBe('超出最大轮次')
    expect(第二轮.结果).toEqual({ 答案: 9 })
    断言前缀稳定(假.请求列表)
  })

  it('历史里的未知字段会被保留并发给模型，内部治理字段不会', async (): Promise<void> => {
    let 假 = 创建假客户端([提交(1)])
    let 实例 = new 智能体({ 系统提示词: '固定系统提示词' })
    let 首轮假 = 创建假客户端([提交(1)])
    let 首轮 = await 实例.执行回合({ ...创建选项(首轮假, '首轮'), 消息历史: [] })
    let 历史 = [...首轮.新增上下文]
    let 助手消息 = 历史.find((消息) => 消息.role === 'assistant')
    if (助手消息 === undefined) throw new Error('缺少助手消息')
    助手消息['reasoning_content'] = '思考过程'

    await 实例.执行回合({ ...创建选项(假, '次轮'), 消息历史: 历史 })

    let 发出的助手消息 = 假.请求列表[0]?.messages.find((消息) => 消息['role'] === 'assistant')
    expect(发出的助手消息?.['reasoning_content']).toBe('思考过程')
    expect(JSON.stringify(假.请求列表[0])).not.toContain('prefixFingerprint')
  })
})

describe('前缀指纹', () => {
  async function 跑第一轮(实例: 智能体): Promise<智能体消息类型[]> {
    let 假 = 创建假客户端([提交(1)])
    return (await 实例.执行回合({ ...创建选项(假, '第一轮'), 消息历史: [] })).新增上下文
  }

  it('系统提示词变了: 返回前缀已变且没有发出请求', async (): Promise<void> => {
    let 历史 = await 跑第一轮(new 智能体({ 系统提示词: '旧提示词' }))
    let 假 = 创建假客户端([提交(2)])

    let 结果 = await new 智能体({ 系统提示词: '新提示词' }).执行回合({ ...创建选项(假, '第二轮'), 消息历史: 历史 })

    expect(结果.结束原因).toBe('前缀已变')
    expect(结果.结果).toBeNull()
    expect(结果.新增上下文).toEqual([])
    expect(假.请求列表).toHaveLength(0)
  })

  it('工具列表变了: 返回前缀已变且没有发出请求', async (): Promise<void> => {
    let 历史 = await 跑第一轮(new 智能体({ 系统提示词: '提示词', 工具列表: [加法工具] }))
    let 假 = 创建假客户端([提交(2)])

    let 换实例工具 = await new 智能体({ 系统提示词: '提示词', 工具列表: [报错工具] }).执行回合({
      ...创建选项(假, '第二轮'),
      消息历史: 历史,
    })
    let 换按次工具 = await new 智能体({ 系统提示词: '提示词', 工具列表: [加法工具] }).执行回合({
      ...创建选项(假, '第二轮'),
      消息历史: 历史,
      临时追加工具列表: [报错工具],
    })

    expect(换实例工具.结束原因).toBe('前缀已变')
    expect(换按次工具.结束原因).toBe('前缀已变')
    expect(假.请求列表).toHaveLength(0)
  })

  it('实例对话换了结果结构也属于前缀变化，历史保持原样', async (): Promise<void> => {
    let 假 = 创建假客户端([提交(1), 提交(2)])
    let 实例 = new 智能体({ 系统提示词: '提示词' })
    await 实例.对话(创建选项(假, '第一轮'))
    let 历史快照 = JSON.stringify(实例.读取对话历史())

    let 结果 = await 实例.对话({ ...创建选项(假, '第二轮'), 预期结果描述: '换了一种描述' })

    expect(结果.结束原因).toBe('前缀已变')
    expect(假.请求列表).toHaveLength(1)
    expect(JSON.stringify(实例.读取对话历史())).toBe(历史快照)
  })

  it('历史里的 system 没有指纹(旧数据)或根本没有 system: 按前缀已变处理', async (): Promise<void> => {
    let 假 = 创建假客户端([提交(1)])
    let 实例 = new 智能体({ 系统提示词: '提示词' })

    let 无指纹 = await 实例.执行回合({
      ...创建选项(假, '命令'),
      消息历史: [{ role: 'system', content: '旧版本留下的 system' }],
    })
    let 无system = await 实例.执行回合({ ...创建选项(假, '命令'), 消息历史: [{ role: 'user', content: '旧数据' }] })

    expect(无指纹.结束原因).toBe('前缀已变')
    expect(无system.结束原因).toBe('前缀已变')
    expect(假.请求列表).toHaveLength(0)
  })

  it('推演是支线，不检查前缀也不改动主历史', async (): Promise<void> => {
    let 假 = 创建假客户端([提交(1), 提交(2), 提交(3)])
    let 实例 = new 智能体({ 系统提示词: '提示词' })
    await 实例.对话(创建选项(假, '第一轮'))
    let 历史快照 = JSON.stringify(实例.读取对话历史())

    let 推演 = await 实例.推演({ ...创建选项(假, '推演'), 预期结果描述: '推演用的另一种描述' })

    expect(推演.结束原因).toBeUndefined()
    expect(JSON.stringify(实例.读取对话历史())).toBe(历史快照)
    await 实例.对话(创建选项(假, '第二轮'))
    expect(假.请求列表).toHaveLength(3)
  })
})

describe('前缀已变时零副作用', () => {
  it('带记忆的智能体在自动召回之前就检查前缀: 访问计数、访问序号、提交记录都不变', async (): Promise<void> => {
    let 假 = 创建假客户端([提交(1), 提交(2), 提交(3)])
    let 实例 = 夹具.新建智能体({ 向量模型: { 类型: '无' } })
    let 读取状态 = async (): Promise<string> => {
      let 快照: { 记忆列表: { id: string; 访问次数?: number; 最后访问序号?: number }[] } = JSON.parse(
        await 实例.保存快照(),
      ) as never
      return JSON.stringify({
        记忆: 快照.记忆列表.map((记忆) => [记忆.id, 记忆.访问次数, 记忆.最后访问序号]),
        提交数: (await 实例.查询记忆提交(1000)).length,
      })
    }
    try {
      await 实例.添加记忆({
        内容: '苹果是一种水果',
        关键词: ['苹果', '水果'],
        标签: [],
        评分: 80,
        等级: 记忆等级.二级,
        创建时间: new Date('2026-01-01T00:00:00.000Z'),
      })
      let 首轮 = await 实例.执行回合({ ...创建选项(假, '苹果'), 消息历史: [] })
      let 首轮后状态 = await 读取状态()

      // 对照: 前缀一致时第二轮会触发自动召回, 状态发生变化
      let 对照 = await 实例.执行回合({ ...创建选项(假, '水果苹果'), 消息历史: 首轮.新增上下文 })
      let 对照后状态 = await 读取状态()
      expect(对照.结束原因).toBeUndefined()
      expect(对照后状态).not.toBe(首轮后状态)

      // 换了工具列表 => 前缀已变: 不发请求, 也不召回
      let 请求数 = 假.请求列表.length
      let 结果 = await 实例.执行回合({
        ...创建选项(假, '水果苹果'),
        消息历史: 首轮.新增上下文,
        临时追加工具列表: [加法工具],
      })

      expect(结果.结束原因).toBe('前缀已变')
      expect(结果.新增上下文).toEqual([])
      expect(结果.用量).toEqual([])
      expect(假.请求列表).toHaveLength(请求数)
      expect(await 读取状态()).toBe(对照后状态)
    } finally {
      await 实例.销毁()
    }
  })
})

describe('追加注入消息', () => {
  it('同样的注入连续两轮只追加一次，内容一变才再追加；顺序为调用方注入、当前时间、用户命令', async (): Promise<void> => {
    let 假 = 创建假客户端([提交(1), 提交(2), 提交(3)])
    let 实例 = new 智能体({ 系统提示词: '提示词' })
    let 当前时间 = new Date('2026-01-01T00:00:00.000Z')

    let 第一轮 = await 实例.对话({
      ...创建选项(假, '第一轮'),
      当前时间,
      追加注入消息: [
        { 类型: '业务资料', 内容: '资料 A' },
        { 类型: '另一类', 内容: '其他 A' },
      ],
    })
    let 第二轮 = await 实例.对话({
      ...创建选项(假, '第二轮'),
      追加注入消息: [
        { 类型: '业务资料', 内容: '资料 A' },
        { 类型: '另一类', 内容: '其他 A' },
      ],
    })
    let 第三轮 = await 实例.对话({
      ...创建选项(假, '第三轮'),
      追加注入消息: [
        { 类型: '业务资料', 内容: '资料 B' },
        { 类型: '另一类', 内容: '其他 A' },
      ],
    })

    let 注入内容 = (消息列表: 智能体消息类型[]): string[] =>
      消息列表.flatMap((消息) => (消息.role === 'user' && 消息.isSystemInjection === true ? [消息.content] : []))
    expect(注入内容(第一轮.新增上下文).slice(0, 3)).toEqual(['资料 A', '其他 A', expect.stringContaining('[当前时间')])
    let 第一轮用户 = 第一轮.新增上下文.filter((消息) => 消息.role === 'user').map((消息) => 消息.content)
    expect(第一轮用户[0]).toBe('资料 A')
    expect(第一轮用户[2]).toContain('[当前时间')
    expect(第一轮用户[3]).toBe('第一轮')
    expect(注入内容(第二轮.新增上下文)).toEqual([])
    expect(注入内容(第三轮.新增上下文)).toEqual(['资料 B'])
    expect(第三轮.新增上下文.find((消息) => 消息.role === 'user' && 消息.isSystemInjection === true)).toMatchObject({
      systemInjectionKind: '业务资料',
    })
    断言前缀稳定(假.请求列表)
  })

  it('带记忆的智能体: 记忆状态在前、召回在后，调用方注入再其后', async (): Promise<void> => {
    let 假 = 创建假客户端([提交(1)])
    let 实例 = 夹具.新建智能体({ 向量模型: { 类型: '无' } })
    try {
      await 实例.添加记忆({
        内容: '稳定记忆',
        关键词: ['稳定'],
        标签: [],
        评分: 80,
        等级: 记忆等级.一级,
        创建时间: new Date('2026-01-01T00:00:00.000Z'),
      })
      await 实例.执行回合({
        ...创建选项(假, '命令'),
        消息历史: [],
        追加注入消息: [{ 类型: '业务资料', 内容: '资料 A' }],
      })

      let 用户消息 =
        假.请求列表[0]?.messages.filter((消息) => 消息['role'] === 'user').map((消息) => 消息['content']) ?? []
      expect(String(用户消息[0])).toContain('本轮最新记忆状态')
      expect(用户消息[1]).toBe('资料 A')
      expect(用户消息[2]).toBe('命令')
    } finally {
      await 实例.销毁()
    }
  })
})
