import { afterEach, describe, expect, it } from 'vitest'
import { type 智能体消息类型, 带记忆的智能体, 记忆等级 } from '../src/index'

describe('带记忆的智能体的本地记忆', () => {
  let 智能体实例: 带记忆的智能体 | undefined

  afterEach(async (): Promise<void> => {
    if (智能体实例 !== undefined) {
      await 智能体实例.销毁()
      智能体实例 = undefined
    }
  })

  it('可以并发写入、保存快照并恢复原有记忆', async (): Promise<void> => {
    智能体实例 = new 带记忆的智能体({
      向量模型: { 类型: '无' },
      一级记忆容量: 10,
      二级记忆遗忘分数阈值: 0,
    })

    await Promise.all([
      智能体实例.批量注入记忆([
        {
          内容: '第一条本地记忆',
          关键词: ['本地', '第一条'],
          标签: ['测试'],
          评分: 80,
          等级: 记忆等级.一级,
          创建时间: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]),
      智能体实例.批量注入记忆([
        {
          内容: '第二条本地记忆',
          关键词: ['本地', '第二条'],
          标签: ['测试'],
          评分: 90,
          等级: 记忆等级.一级,
          创建时间: new Date('2026-01-02T00:00:00.000Z'),
        },
      ]),
    ])

    let 快照 = await 智能体实例.保存快照()
    let 快照数据: unknown = JSON.parse(快照)
    expect(快照数据).toMatchObject({
      记忆列表: [
        { 内容: '第一条本地记忆', 标签: ['测试'] },
        { 内容: '第二条本地记忆', 标签: ['测试'] },
      ],
    })
    let 消息历史: 智能体消息类型[] = [{ role: 'user', content: '请记住这些内容' }]
    let 完整状态 = await 智能体实例.导出完整状态(消息历史)

    await 智能体实例.批量注入记忆([
      {
        内容: '临时记忆',
        关键词: ['临时'],
        标签: [],
        评分: 70,
        等级: 记忆等级.一级,
        创建时间: new Date('2026-01-03T00:00:00.000Z'),
      },
    ])
    await 智能体实例.载入快照(快照)

    let 记忆列表 = await 智能体实例.查询记忆()
    expect(记忆列表.map((记忆) => 记忆.内容).sort()).toEqual(['第一条本地记忆', '第二条本地记忆'])

    await 智能体实例.批量注入记忆([
      {
        内容: '另一条临时记忆',
        关键词: ['临时'],
        标签: [],
        评分: 70,
        等级: 记忆等级.一级,
        创建时间: new Date('2026-01-04T00:00:00.000Z'),
      },
    ])
    let 已恢复的消息历史 = await 智能体实例.导入完整状态(完整状态)
    expect(已恢复的消息历史).toEqual(消息历史)

    let 恢复后的记忆列表 = await 智能体实例.查询记忆()
    expect(恢复后的记忆列表.map((记忆) => 记忆.内容).sort()).toEqual(['第一条本地记忆', '第二条本地记忆'])
  })

  it('可以在隔离环境中注册并调用动态工具', async (): Promise<void> => {
    智能体实例 = new 带记忆的智能体({ 向量模型: { 类型: '无' } })

    let 注册结果 = await 智能体实例.注册动态工具(
      `
工具 = {
  名称: 'multiply',
  描述: '计算两个数字的乘积',
  参数Schema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
  返回值Schema: { type: 'object', properties: { 结果: { type: 'number' } }, required: ['结果'] },
  实现: async function(参数) { return { 结果: 参数.a * 参数.b }; }
}
      `,
      '{"a": 6, "b": 7}',
    )

    expect(注册结果.结果).toBe('成功')

    let 调用结果 = await 智能体实例.调用动态工具('multiply', '{"a": 6, "b": 7}')
    expect(调用结果).toMatchObject({ 结果: '成功' })
    expect(调用结果.执行输出).toContain('42')

    let 非法调用结果 = await 智能体实例.调用动态工具('multiply', '{"a": "bad", "b": 7}')
    expect(非法调用结果.结果).toBe('失败')
    expect(非法调用结果.错误信息).toContain('输入参数')

    let 查看结果 = await 智能体实例.查看动态工具('multiply')
    expect(查看结果).toMatchObject({ 结果: '成功', 名称: 'multiply' })

    let 更新结果 = await 智能体实例.更新动态工具(
      'multiply',
      `
工具 = {
  名称: 'multiply',
  描述: '计算两个数字的和',
  参数Schema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
  返回值Schema: { type: 'object', properties: { 结果: { type: 'number' } }, required: ['结果'] },
  实现: async function(参数) { return { 结果: 参数.a + 参数.b }; }
}
      `,
      '{"a": 6, "b": 7}',
    )
    expect(更新结果.结果).toBe('成功')

    let 更新后的调用结果 = await 智能体实例.调用动态工具('multiply', '{"a": 6, "b": 7}')
    expect(更新后的调用结果.执行输出).toContain('13')

    let 删除结果 = await 智能体实例.删除动态工具('multiply')
    expect(删除结果.结果).toBe('成功')

    let 删除后的调用结果 = await 智能体实例.调用动态工具('multiply', '{"a": 6, "b": 7}')
    expect(删除后的调用结果.结果).toBe('失败')
  })

  it('在一级记忆容量满时降级低分记忆', async (): Promise<void> => {
    智能体实例 = new 带记忆的智能体({
      向量模型: { 类型: '无' },
      一级记忆容量: 1,
      二级记忆遗忘分数阈值: 0,
    })

    await 智能体实例.批量注入记忆([
      {
        内容: '低分记忆',
        关键词: ['低分'],
        标签: [],
        评分: 10,
        等级: 记忆等级.一级,
        创建时间: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        内容: '高分记忆',
        关键词: ['高分'],
        标签: [],
        评分: 90,
        等级: 记忆等级.一级,
        创建时间: new Date('2026-01-02T00:00:00.000Z'),
      },
    ])

    let 记忆列表 = await 智能体实例.查询记忆()
    expect(
      记忆列表.map((记忆) => ({ 内容: 记忆.内容, 等级: 记忆.等级 })).sort((a, b) => a.内容.localeCompare(b.内容)),
    ).toEqual([
      { 内容: '低分记忆', 等级: 记忆等级.二级 },
      { 内容: '高分记忆', 等级: 记忆等级.一级 },
    ])
  })

  it('拒绝非法快照时保留已有数据', async (): Promise<void> => {
    智能体实例 = new 带记忆的智能体({ 向量模型: { 类型: '无' }, 二级记忆遗忘分数阈值: 0 })
    await 智能体实例.批量注入记忆([
      {
        内容: '不应丢失的记忆',
        关键词: ['回滚'],
        标签: [],
        评分: 80,
        等级: 记忆等级.一级,
        创建时间: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])

    await expect(智能体实例.载入快照('{')).rejects.toThrow()

    let 记忆列表 = await 智能体实例.查询记忆()
    expect(记忆列表.map((记忆) => 记忆.内容)).toEqual(['不应丢失的记忆'])
  })

  it('快照写入在关联数据不合法时回滚已删除的记忆', async (): Promise<void> => {
    智能体实例 = new 带记忆的智能体({ 向量模型: { 类型: '无' }, 二级记忆遗忘分数阈值: 0 })
    await 智能体实例.批量注入记忆([
      {
        内容: '必须被事务保护的记忆',
        关键词: ['事务'],
        标签: [],
        评分: 80,
        等级: 记忆等级.一级,
        创建时间: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])
    let 快照数据: unknown = JSON.parse(await 智能体实例.保存快照())
    if (typeof 快照数据 !== 'object' || 快照数据 === null || !('记忆关联列表' in 快照数据)) {
      throw new Error('保存的快照格式不符合预期')
    }
    let 损坏快照数据 = {
      ...快照数据,
      记忆关联列表: [{ 起点id: '不存在的记忆', 终点id: '不存在的记忆', 关联度: 1 }],
    }

    await expect(智能体实例.载入快照(JSON.stringify(损坏快照数据))).rejects.toThrow()

    let 记忆列表 = await 智能体实例.查询记忆()
    expect(记忆列表.map((记忆) => 记忆.内容)).toEqual(['必须被事务保护的记忆'])
  })
})
