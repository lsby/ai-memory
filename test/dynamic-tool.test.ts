import { afterEach, describe, expect, it } from 'vitest'
import { 带记忆的智能体 } from '../src/index'

describe('动态工具运行期校验', () => {
  let 智能体实例: 带记忆的智能体 | undefined

  afterEach(async (): Promise<void> => {
    if (智能体实例 !== undefined) {
      await 智能体实例.销毁()
      智能体实例 = undefined
    }
  })

  it('拒绝不符合返回值 Schema 的动态工具结果', async (): Promise<void> => {
    智能体实例 = new 带记忆的智能体({ 向量模型: { 类型: '无' } })
    let 代码 = `
工具 = {
  名称: 'conditional_result',
  描述: '根据模式返回结果',
  参数Schema: { type: 'object', properties: { mode: { type: 'string' } }, required: ['mode'] },
  返回值Schema: { type: 'object', properties: { 结果: { type: 'number' } }, required: ['结果'] },
  实现: async function(参数) { return { 结果: 参数.mode === 'valid' ? 1 : '错误类型' }; }
}
    `

    let 注册结果 = await 智能体实例.注册动态工具(代码, '{"mode":"valid"}')
    expect(注册结果.结果).toBe('成功')

    let 调用结果 = await 智能体实例.调用动态工具('conditional_result', '{"mode":"invalid"}')
    expect(调用结果.结果).toBe('失败')
    expect(调用结果.错误信息).toContain('返回值')
  })

  it('完整校验嵌套字段、枚举和额外字段', async (): Promise<void> => {
    智能体实例 = new 带记忆的智能体({ 向量模型: { 类型: '无' } })
    let 代码 = `
工具 = {
  名称: 'strict_schema',
  描述: '校验嵌套输入',
  参数Schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      配置: {
        type: 'object',
        additionalProperties: false,
        properties: { 模式: { type: 'string', enum: ['安全', '快速'] } },
        required: ['模式']
      }
    },
    required: ['配置']
  },
  返回值Schema: { type: 'object', properties: { 完成: { type: 'boolean' } }, required: ['完成'] },
  实现: async function() { return { 完成: true }; }
}
    `

    let 注册结果 = await 智能体实例.注册动态工具(代码, '{"配置":{"模式":"安全"}}')
    expect(注册结果.结果).toBe('成功')

    let 调用结果 = await 智能体实例.调用动态工具('strict_schema', '{"配置":{"模式":"未知","额外":true}}')
    expect(调用结果.结果).toBe('失败')
    expect(调用结果.错误信息).toContain('输入参数')
  })

  it('在动态工具的异步实现永不结束时返回超时错误', async (): Promise<void> => {
    智能体实例 = new 带记忆的智能体({ 向量模型: { 类型: '无' } })
    let 代码 = `
工具 = {
  名称: 'never_settles',
  描述: '永不结束的异步工具',
  参数Schema: { type: 'object', properties: {}, required: [] },
  返回值Schema: { type: 'object', properties: {}, required: [] },
  实现: async function() { await new Promise(() => {}); return {}; }
}
    `

    let 注册结果 = await 智能体实例.注册动态工具(代码, '{}')

    expect(注册结果.结果).toBe('失败')
    expect(注册结果.错误信息).toContain('动态工具执行超时')
  })
})
