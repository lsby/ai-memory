import { afterEach, describe, expect, it } from 'vitest'
import { 完整状态Schema, 带记忆的智能体, 快照数据Schema, 记忆等级 } from '../src/index'

let 动态工具代码 = `
工具 = {
  名称: 'snapshot_tool',
  描述: '用于验证快照恢复',
  参数Schema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] },
  返回值Schema: { type: 'object', properties: { doubled: { type: 'number' } }, required: ['doubled'] },
  实现: async function(参数) { return { doubled: 参数.value * 2 }; }
}
`

describe('记忆应用管理接口', () => {
  let 智能体实例: 带记忆的智能体 | undefined

  afterEach(async (): Promise<void> => {
    if (智能体实例 !== undefined) {
      await 智能体实例.销毁()
      智能体实例 = undefined
    }
  })

  it('支持增改查、文本过滤、分页和关联图查询', async (): Promise<void> => {
    智能体实例 = new 带记忆的智能体({ 向量模型: { 类型: '无' }, 二级记忆遗忘分数阈值: 0 })
    let 第一条 = await 智能体实例.添加记忆({
      内容: '第一条苹果记忆',
      关键词: ['水果', '苹果'],
      标签: ['原始'],
      评分: 60,
      等级: 记忆等级.一级,
      创建时间: new Date('2026-01-01T00:00:00.000Z'),
    })
    let 第二条 = await 智能体实例.添加记忆({
      内容: '第二条香蕉记忆',
      关键词: ['水果', '香蕉'],
      标签: ['原始'],
      评分: 70,
      等级: 记忆等级.一级,
      创建时间: new Date('2026-01-02T00:00:00.000Z'),
    })

    expect((await 智能体实例.查询记忆({ 搜索文本: '苹果' })).map((记忆) => 记忆.id)).toEqual([第一条.id])
    expect((await 智能体实例.查询记忆({ 偏移: 1, 数量: 1 })).map((记忆) => 记忆.id)).toEqual([第二条.id])
    let [起点id, 终点id] = 第一条.id < 第二条.id ? [第一条.id, 第二条.id] : [第二条.id, 第一条.id]
    expect(await 智能体实例.查询记忆关联(第一条.id)).toEqual([{ 起点id, 终点id, 关联度: 1 }])

    let 更新后 = await 智能体实例.更新记忆(第一条.id, { 内容: '更新后的苹果记忆', 标签: ['已更新'], 评分: 88 })
    expect(更新后).toMatchObject({ 内容: '更新后的苹果记忆', 标签: ['已更新'], 评分: 88 })
    expect(await 智能体实例.删除记忆(第二条.id)).toBe(true)
    expect(await 智能体实例.查找记忆(第二条.id)).toBeNull()
  })

  it('对管理输入执行运行时校验', async (): Promise<void> => {
    智能体实例 = new 带记忆的智能体({ 向量模型: { 类型: '无' } })
    await expect(
      智能体实例.添加记忆({
        内容: '',
        关键词: [],
        标签: [],
        评分: 101,
        等级: 记忆等级.一级,
        创建时间: new Date(),
      }),
    ).rejects.toThrow()
    await expect(智能体实例.查询记忆({ 偏移: -1 })).rejects.toThrow()
    await expect(智能体实例.更新记忆('id', {})).rejects.toThrow('至少提供一个')
  })

  it('v2 快照和完整状态往返恢复动态工具及完整会话', async (): Promise<void> => {
    智能体实例 = new 带记忆的智能体({ 向量模型: { 类型: '无' } })
    await 智能体实例.添加记忆({
      内容: '需要恢复的记忆',
      关键词: ['恢复'],
      标签: [],
      评分: 80,
      等级: 记忆等级.一级,
      创建时间: new Date('2026-01-01T00:00:00.000Z'),
    })
    expect((await 智能体实例.注册动态工具(动态工具代码, '{"value":3}')).结果).toBe('成功')
    智能体实例.载入对话历史([
      { role: 'system', content: '固定系统提示' },
      { role: 'user', content: '完整内部状态', isSystemInjection: true, systemInjectionKind: 'memory-state' },
    ])

    let 快照 = await 智能体实例.保存快照()
    expect(快照数据Schema.parse(JSON.parse(快照))).toMatchObject({
      格式版本: 2,
      动态工具列表: [{ 名称: 'snapshot_tool' }],
    })
    await 智能体实例.删除动态工具('snapshot_tool')
    await 智能体实例.载入快照(快照)
    expect(await 智能体实例.查询动态工具()).toMatchObject([{ 名称: 'snapshot_tool' }])
    expect(await 智能体实例.调用动态工具('snapshot_tool', '{"value":4}')).toMatchObject({ 结果: '成功' })

    let 完整状态文本 = await 智能体实例.导出完整状态()
    let 完整状态 = 完整状态Schema.parse(JSON.parse(完整状态文本))
    expect(完整状态).toMatchObject({ 格式版本: 2, 消息历史: [{ role: 'system' }, { content: '完整内部状态' }] })
    智能体实例.重置对话()
    await 智能体实例.删除动态工具('snapshot_tool')
    await 智能体实例.导入完整状态(完整状态文本)
    expect(智能体实例.读取对话历史()).toEqual(完整状态.消息历史)
    expect(await 智能体实例.查询动态工具()).toMatchObject([{ 名称: 'snapshot_tool' }])
    await expect(智能体实例.导入完整状态('{"消息历史":[]}')).rejects.toThrow()
  })

  it('记录精确 Diff 并通过新提交回退最近一次修改', async (): Promise<void> => {
    智能体实例 = new 带记忆的智能体({ 向量模型: { 类型: '无' }, 二级记忆遗忘分数阈值: 0 })
    let 记忆 = await 智能体实例.添加记忆({
      内容: '回退前内容',
      关键词: ['回退'],
      标签: [],
      评分: 50,
      等级: 记忆等级.一级,
      创建时间: new Date('2026-01-01T00:00:00.000Z'),
    })
    await 智能体实例.更新记忆(记忆.id, { 内容: '回退后内容' })

    let 更新提交 = (await 智能体实例.查询记忆提交()).find((提交) => 提交.消息 === '更新记忆')
    expect(更新提交?.变更列表).toHaveLength(1)
    expect(更新提交?.变更列表[0]).toMatchObject({ 操作类型: 'update', 目标表: 'node', 目标id: 记忆.id })
    expect(更新提交?.变更列表[0]?.旧值).toContain('回退前内容')
    expect(更新提交?.变更列表[0]?.新值).toContain('回退后内容')

    expect(await 智能体实例.回退最近记忆提交()).toBe(true)
    expect(await 智能体实例.查找记忆(记忆.id)).toMatchObject({ 内容: '回退前内容' })
    expect((await 智能体实例.查询记忆提交())[0]).toMatchObject({ 消息: '回退最近记忆提交' })
  })
})
