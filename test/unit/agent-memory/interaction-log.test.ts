import { afterEach, describe, expect, it } from 'vitest'
import { 交互日志事件Schema, 带记忆的智能体, 记忆等级 } from '../../../src/index'
import { 使用共享PGlite } from '../../helpers/shared-pglite-fixture'

describe('交互事件日志', () => {
  let 夹具 = 使用共享PGlite()
  let 智能体实例: 带记忆的智能体 | undefined

  afterEach(async (): Promise<void> => {
    if (智能体实例 !== undefined) {
      await 智能体实例.销毁()
      智能体实例 = undefined
    }
  })

  it('允许调用方写入联合类型事件并自动生成事件组 ID', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体()
    let 开始时间 = new Date('2026-01-01T00:00:00.000Z')
    let 写入结果 = await 智能体实例.记录交互日志({
      类型: '自定义',
      开始时间,
      耗时ms: 12,
      内容: { 任意字段: ['由调用方', 1, true, null] },
    })

    let 查询结果 = await 智能体实例.查询交互日志({ 事件组id: 写入结果.事件组id })
    expect(查询结果).toEqual([写入结果])
    expect(查询结果[0]).toMatchObject({ 类型: '自定义', 耗时ms: 12, 内容: { 任意字段: ['由调用方', 1, true, null] } })
    expect(() => 交互日志事件Schema.parse({ 类型: '未设计事件', 开始时间, 内容: {} })).toThrow()
  })

  it('记忆变更和提交日志使用调用方指定的同一个事件组', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体()
    await 智能体实例.添加记忆(
      {
        内容: '遥测测试记忆',
        关键词: ['遥测'],
        标签: [],
        评分: 80,
        等级: 记忆等级.一级,
        创建时间: new Date('2026-01-01T00:00:00.000Z'),
      },
      undefined,
      'memory-group',
    )

    let 日志列表 = await 智能体实例.查询交互日志({ 事件组id: 'memory-group' })
    expect(日志列表.map((日志) => 日志.类型)).toEqual(['流程开始', '记忆提交', '流程结束'])
    expect(日志列表[1]?.内容).toMatchObject({ 消息: '添加记忆' })
  })

  it('支持按事件类型筛选并严格按序号返回', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体()
    let 开始时间 = new Date('2026-01-01T00:00:00.000Z')
    await 智能体实例.记录交互日志({ 类型: '流程开始', 开始时间, 内容: { 次序: 1 } }, 'ordered-group')
    await 智能体实例.记录交互日志({ 类型: '流程结束', 开始时间, 耗时ms: 1, 内容: { 次序: 2 } }, 'ordered-group')

    let 全部 = await 智能体实例.查询交互日志({ 事件组id: 'ordered-group' })
    let 结束 = await 智能体实例.查询交互日志({ 事件组id: 'ordered-group', 类型: '流程结束' })
    expect(全部.map((日志) => 日志.内容)).toEqual([{ 次序: 1 }, { 次序: 2 }])
    expect(结束).toHaveLength(1)
    expect(结束[0]?.类型).toBe('流程结束')
  })

  it('支持分页并拒绝无效的查询条件', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体()
    let 开始时间 = new Date('2026-01-01T00:00:00.000Z')
    await 智能体实例.记录交互日志({ 类型: '自定义', 开始时间, 内容: { 次序: 1 } }, 'page-group')
    await 智能体实例.记录交互日志({ 类型: '自定义', 开始时间, 内容: { 次序: 2 } }, 'page-group')
    await 智能体实例.记录交互日志({ 类型: '自定义', 开始时间, 内容: { 次序: 3 } }, 'page-group')

    let 第二页 = await 智能体实例.查询交互日志({ 事件组id: 'page-group', 偏移: 1, 数量: 1 })
    expect(第二页.map((日志) => 日志.内容)).toEqual([{ 次序: 2 }])
    await expect(智能体实例.查询交互日志({ 偏移: -1 })).rejects.toThrow()
    await expect(智能体实例.查询交互日志({ 数量: 1001 })).rejects.toThrow()
    await expect(智能体实例.查询交互日志({ 事件组id: '   ' })).rejects.toThrow()
  })

  it('分支切换事件记录请求、结果和切换后的 HEAD', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体()
    let 记忆 = await 智能体实例.添加记忆({
      内容: '分支日志基线',
      关键词: ['分支'],
      标签: [],
      评分: 80,
      等级: 记忆等级.一级,
      创建时间: new Date('2026-01-01T00:00:00.000Z'),
    })
    let 基线提交id = await 智能体实例.查询当前记忆提交id()
    await 智能体实例.更新记忆(记忆.id, { 内容: '另一分支' })
    if (基线提交id === null) throw new Error('基线提交未生成')

    expect(await 智能体实例.切换记忆提交(基线提交id, 'branch-group')).toBe(true)

    let 日志列表 = await 智能体实例.查询交互日志({ 事件组id: 'branch-group' })
    expect(日志列表.map((日志) => 日志.类型)).toEqual(['流程开始', '记忆分支切换', '流程结束'])
    expect(日志列表[1]?.内容).toEqual({ 请求: { 目标提交id: 基线提交id }, 结果: true, 当前提交id: 基线提交id })
  })

  it('编程调用动态工具时记录同组的开始和结果事件', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体()
    let 注册结果 = await 智能体实例.注册动态工具(
      `工具 = {
  名称: 'telemetry_echo',
  描述: '返回输入值',
  参数Schema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] },
  返回值Schema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] },
  实现: async function(参数) { return { value: 参数.value }; }
}`,
      '{"value":7}',
    )
    expect(注册结果.结果).toBe('成功')

    let 调用结果 = await 智能体实例.调用动态工具('telemetry_echo', '{"value":7}', undefined, 'tool-group')
    expect(调用结果.结果).toBe('成功')
    let 日志列表 = await 智能体实例.查询交互日志({ 事件组id: 'tool-group' })
    expect(日志列表.map((日志) => 日志.类型)).toEqual(['工具调用开始', '工具调用结果'])
    expect(日志列表[0]?.内容).toEqual({ 工具名称: 'telemetry_echo' })
    expect(日志列表[1]?.内容).toEqual({ 工具名称: 'telemetry_echo', 状态: '成功' })
  })

  it('记忆操作失败时同一事务里的日志也会回滚', async (): Promise<void> => {
    智能体实例 = 夹具.新建智能体()
    await expect(智能体实例.载入快照('{不是合法快照}', 'rollback-group')).rejects.toThrow()
    expect(await 智能体实例.查询交互日志({ 事件组id: 'rollback-group' })).toEqual([])
  })
})
