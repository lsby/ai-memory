import { afterEach, describe, expect, it } from 'vitest'
import { 完整状态Schema, 带记忆的智能体, 快照数据Schema, 记忆等级 } from '../../../src/index'
import { 使用共享PGlite } from '../../helpers/shared-pglite-fixture'

let 技能代码 = `
skill = {
  name: 'snapshot_tool',
  description: '用于验证快照恢复',
  parametersSchema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] },
  returnSchema: { type: 'object', properties: { doubled: { type: 'number' } }, required: ['doubled'] },
  execute: async function(args) { return { doubled: args.value * 2 }; }
}
`

describe('记忆应用管理接口', () => {
  let 夹具 = 使用共享PGlite()
  let 智能体实例: 带记忆的智能体 | undefined

  afterEach(async (): Promise<void> => {
    if (智能体实例 !== undefined) {
      await 智能体实例.销毁()
      智能体实例 = undefined
    }
  })

  it('支持增改查、文本过滤、分页和线索关联查询', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体({ 向量模型: { 类型: '无' }, 二级记忆遗忘分数阈值: 0 })
    let 第一条 = await 智能体实例.添加记忆({
      内容: '第一条苹果记忆',
      线索: ['水果', '苹果'],
      评分: 60,
      等级: 记忆等级.一级,
      创建时间: new Date('2026-01-01T00:00:00.000Z'),
    })
    let 第二条 = await 智能体实例.添加记忆({
      内容: '第二条香蕉记忆',
      线索: ['水果', '香蕉'],
      评分: 70,
      等级: 记忆等级.一级,
      创建时间: new Date('2026-01-02T00:00:00.000Z'),
    })

    expect((await 智能体实例.查询记忆({ 搜索文本: '苹果' })).map((记忆) => 记忆.id)).toEqual([第一条.id])
    expect((await 智能体实例.查询记忆({ 偏移: 1, 数量: 1 })).map((记忆) => 记忆.id)).toEqual([第二条.id])
    let 水果线索 = (await 智能体实例.查询线索()).find((线索) => 线索.内容 === '水果')
    expect(水果线索).toBeDefined()
    expect(await 智能体实例.查询记忆线索关联(第一条.id)).toHaveLength(2)
    let 关联变更 = (await 智能体实例.查询记忆提交())
      .flatMap((提交) => 提交.变更列表)
      .find((变更) => 变更.目标表 === 'memory_clue_relation' && 变更.主键['记忆id'] === 第一条.id)
    expect(关联变更).toMatchObject({
      操作类型: 'insert',
      主键: { 记忆id: 第一条.id },
    })

    let 更新后 = await 智能体实例.更新记忆(第一条.id, { 内容: '更新后的苹果记忆', 线索: ['已更新'], 评分: 88 })
    expect(更新后).toMatchObject({ 内容: '更新后的苹果记忆', 线索: ['已更新'], 评分: 88 })
    expect(await 智能体实例.移除记忆(第二条.id)).toBe(true)
    expect(await 智能体实例.查找记忆(第二条.id)).toBeNull()
  })

  it('对管理输入执行运行时校验', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体({ 向量模型: { 类型: '无' } })
    await expect(
      智能体实例.添加记忆({
        内容: '',
        线索: [],
        评分: 101,
        等级: 记忆等级.一级,
        创建时间: new Date(),
      }),
    ).rejects.toThrow()
    await expect(智能体实例.查询记忆({ 偏移: -1 })).rejects.toThrow()
    await expect(智能体实例.更新记忆('id', {})).rejects.toThrow('至少提供一个')
  })

  it('记忆快照和完整状态往返恢复技能、前缀及完整会话', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体({ 向量模型: { 类型: '无' } })
    await 智能体实例.添加记忆({
      内容: '需要恢复的记忆',
      线索: ['恢复'],
      评分: 80,
      等级: 记忆等级.一级,
      创建时间: new Date('2026-01-01T00:00:00.000Z'),
    })
    expect((await 智能体实例.创建技能(技能代码, '{"value":3}', ['测试技能'])).结果).toBe('成功')
    let 会话 = await 智能体实例.创建会话({ 标题: '完整状态会话' })
    let 系统消息 = await 智能体实例.追加会话消息({
      会话id: 会话.id,
      预期父消息id: null,
      消息: { role: 'system', content: '固定系统提示' },
    })
    await 智能体实例.追加会话消息({
      会话id: 会话.id,
      预期父消息id: 系统消息.id,
      消息: { role: 'user', content: '完整内部状态', isSystemInjection: true, systemInjectionKind: 'memory-state' },
    })

    let 快照 = await 智能体实例.保存快照()
    let 快照数据 = 快照数据Schema.parse(JSON.parse(快照))
    expect(快照数据).toMatchObject({
      格式版本: 4,
      技能列表: [{ 名称: 'snapshot_tool' }],
    })
    expect(快照数据.线索列表.map((线索) => 线索.内容)).toContain('测试技能')
    expect(快照数据.技能线索关联列表).toHaveLength(1)
    await 智能体实例.移除技能('snapshot_tool')
    await 智能体实例.载入快照(快照)
    expect(await 智能体实例.查询技能()).toMatchObject([{ 名称: 'snapshot_tool', 线索: ['测试技能'] }])
    expect(await 智能体实例.执行技能('snapshot_tool', '{"value":4}')).toMatchObject({ 结果: '成功' })

    let 完整状态文本 = await 智能体实例.导出完整状态()
    let 完整状态 = 完整状态Schema.parse(JSON.parse(完整状态文本))
    expect(完整状态).not.toHaveProperty('格式版本')
    expect(() => 完整状态Schema.parse({ ...JSON.parse(完整状态文本), 未定义字段: true })).toThrow()
    expect(完整状态).toMatchObject({
      当前会话id: 会话.id,
      会话列表: [{ id: 会话.id }],
      消息列表: [{ 消息: { role: 'system' } }, { 消息: { content: '完整内部状态' } }],
    })
    await 智能体实例.销毁()
    智能体实例 = 夹具.新建智能体({ 向量模型: { 类型: '无' } })
    await 智能体实例.导入完整状态(完整状态文本)
    expect(智能体实例.读取对话历史()).toEqual(完整状态.消息列表.map((消息) => 消息.消息))
    expect(await 智能体实例.查询技能()).toMatchObject([{ 名称: 'snapshot_tool', 线索: ['测试技能'] }])
    await expect(智能体实例.导入完整状态('{"消息历史":[]}')).rejects.toThrow()
  })

  it('记录精确 Diff 并把 HEAD 回退到父提交而不改写历史', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体({ 向量模型: { 类型: '无' }, 二级记忆遗忘分数阈值: 0 })
    let 记忆 = await 智能体实例.添加记忆({
      内容: '回退前内容',
      线索: ['回退'],
      评分: 50,
      等级: 记忆等级.一级,
      创建时间: new Date('2026-01-01T00:00:00.000Z'),
    })
    await 智能体实例.更新记忆(记忆.id, { 内容: '回退后内容' })

    let 更新提交 = (await 智能体实例.查询记忆提交()).find((提交) => 提交.提交说明 === '更新记忆')
    let 记忆变更 = 更新提交?.变更列表.find((变更) => 变更.目标表 === 'memory')
    expect(记忆变更).toMatchObject({ 操作类型: 'update', 目标表: 'memory', 主键: { id: 记忆.id } })
    expect(记忆变更?.行数据).toMatchObject({ 内容: '回退后内容' })
    let 回退前提交数 = (await 智能体实例.查询记忆提交()).length

    expect(await 智能体实例.回退最近记忆提交()).toBe(true)
    expect(await 智能体实例.查找记忆(记忆.id)).toMatchObject({ 内容: '回退前内容' })
    expect(await 智能体实例.查询当前记忆提交id()).toBe(更新提交?.父记忆提交id)
    expect(await 智能体实例.查询记忆提交()).toHaveLength(回退前提交数)
  })

  it('技能变更进入提交历史并且可以回退', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体({ 向量模型: { 类型: '无' } })
    await 智能体实例.添加记忆({
      内容: '技能分支基线',
      线索: ['基线'],
      评分: 50,
      等级: 记忆等级.一级,
      创建时间: new Date('2026-01-01T00:00:00.000Z'),
    })
    expect((await 智能体实例.创建技能(技能代码, '{"value":3}', ['测试技能'])).结果).toBe('成功')

    let 注册提交 = (await 智能体实例.查询记忆提交()).find((提交) => 提交.提交说明 === '技能管理: 创建技能')
    expect(注册提交?.变更列表).toHaveLength(3)
    expect(注册提交?.变更列表).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ 操作类型: 'insert', 目标表: 'skill' }),
        expect.objectContaining({ 操作类型: 'insert', 目标表: 'clue' }),
        expect.objectContaining({ 操作类型: 'insert', 目标表: 'skill_clue_relation' }),
      ]),
    )

    expect(await 智能体实例.回退最近记忆提交()).toBe(true)
    expect(await 智能体实例.查询技能()).toEqual([])
    if (注册提交 === undefined) throw new Error('技能提交未生成')
    expect(await 智能体实例.切换记忆提交(注册提交.id)).toBe(true)
    expect(await 智能体实例.查询技能()).toMatchObject([{ 名称: 'snapshot_tool' }])
  })

  it('允许给提交设置一次唯一状态名称', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体({ 向量模型: { 类型: '无' } })
    await 智能体实例.添加记忆({
      内容: '可命名状态',
      线索: ['命名'],
      评分: 50,
      等级: 记忆等级.一级,
      创建时间: new Date('2026-01-01T00:00:00.000Z'),
    })
    let 提交id = await 智能体实例.查询当前记忆提交id()
    if (提交id === null) throw new Error('测试提交未生成')
    expect(await 智能体实例.命名记忆提交(提交id, '初始状态')).toBe(true)
    expect((await 智能体实例.查询记忆提交()).find((提交) => 提交.id === 提交id)?.状态名称).toBe('初始状态')
    expect(await 智能体实例.命名记忆提交(提交id, '再次命名')).toBe(false)
  })

  it('从旧提交继续写入会产生分支并且可以在分支间切换', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体({ 向量模型: { 类型: '无' }, 二级记忆遗忘分数阈值: 0 })
    let 记忆 = await 智能体实例.添加记忆({
      内容: '共同祖先',
      线索: ['分支'],
      评分: 50,
      等级: 记忆等级.一级,
      创建时间: new Date('2026-01-01T00:00:00.000Z'),
    })
    let 祖先提交id = await 智能体实例.查询当前记忆提交id()
    await 智能体实例.更新记忆(记忆.id, { 内容: '原分支' })
    let 原分支提交id = await 智能体实例.查询当前记忆提交id()

    expect(await 智能体实例.回退最近记忆提交()).toBe(true)
    await 智能体实例.更新记忆(记忆.id, { 内容: '新分支' })
    let 新分支提交id = await 智能体实例.查询当前记忆提交id()
    let 提交列表 = await 智能体实例.查询记忆提交()
    expect(提交列表.find((提交) => 提交.id === 原分支提交id)?.父记忆提交id).toBe(祖先提交id)
    expect(提交列表.find((提交) => 提交.id === 新分支提交id)?.父记忆提交id).toBe(祖先提交id)

    if (原分支提交id === null || 新分支提交id === null) throw new Error('测试提交未生成')
    expect(await 智能体实例.切换记忆提交(原分支提交id)).toBe(true)
    expect(await 智能体实例.查找记忆(记忆.id)).toMatchObject({ 内容: '原分支' })
    expect(await 智能体实例.切换记忆提交(新分支提交id)).toBe(true)
    expect(await 智能体实例.查找记忆(记忆.id)).toMatchObject({ 内容: '新分支' })
    expect(await 智能体实例.切换记忆提交('不存在的提交')).toBe(false)
    expect(await 智能体实例.查询当前记忆提交id()).toBe(新分支提交id)
  })
})
