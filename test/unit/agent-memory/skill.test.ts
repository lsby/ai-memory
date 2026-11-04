import { afterEach, describe, expect, it } from 'vitest'
import { 带记忆的智能体 } from '../../../src/index'

describe('技能运行期校验', () => {
  let 智能体实例: 带记忆的智能体 | undefined

  afterEach(async (): Promise<void> => {
    if (智能体实例 !== undefined) {
      await 智能体实例.销毁()
      智能体实例 = undefined
    }
  })

  it('拒绝不符合返回值 Schema 的技能结果', async (): Promise<void> => {
    智能体实例 = new 带记忆的智能体({ 向量模型: { 类型: '无' } })
    let 代码 = `
skill = {
  name: 'conditional_result',
  description: '根据模式返回结果',
  parametersSchema: { type: 'object', properties: { mode: { type: 'string' } }, required: ['mode'] },
  returnSchema: { type: 'object', properties: { 结果: { type: 'number' } }, required: ['结果'] },
  execute: async function(args) { return { 结果: args.mode === 'valid' ? 1 : '错误类型' }; }
}
    `

    let 注册结果 = await 智能体实例.创建技能(代码, '{"mode":"valid"}', ['校验'])
    expect(注册结果.结果).toBe('成功')

    let 调用结果 = await 智能体实例.执行技能('conditional_result', '{"mode":"invalid"}')
    expect(调用结果.结果).toBe('失败')
    expect(调用结果.错误信息).toContain('返回值')
  })

  it('完整校验嵌套字段、枚举和额外字段', async (): Promise<void> => {
    智能体实例 = new 带记忆的智能体({ 向量模型: { 类型: '无' } })
    let 代码 = `
skill = {
  name: 'strict_schema',
  description: '校验嵌套输入',
  parametersSchema: {
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
  returnSchema: { type: 'object', properties: { 完成: { type: 'boolean' } }, required: ['完成'] },
  execute: async function() { return { 完成: true }; }
}
    `

    let 注册结果 = await 智能体实例.创建技能(代码, '{"配置":{"模式":"安全"}}', ['配置'])
    expect(注册结果.结果).toBe('成功')

    let 调用结果 = await 智能体实例.执行技能('strict_schema', '{"配置":{"模式":"未知","额外":true}}')
    expect(调用结果.结果).toBe('失败')
    expect(调用结果.错误信息).toContain('输入参数')
  })

  it('在技能的异步实现永不结束时返回超时错误', async (): Promise<void> => {
    智能体实例 = new 带记忆的智能体({ 向量模型: { 类型: '无' } })
    let 代码 = `
skill = {
  name: 'never_settles',
  description: '永不结束的异步工具',
  parametersSchema: { type: 'object', properties: {}, required: [] },
  returnSchema: { type: 'object', properties: {}, required: [] },
  execute: async function() { await new Promise(() => {}); return {}; }
}
    `

    let 注册结果 = await 智能体实例.创建技能(代码, '{}', ['超时'])

    expect(注册结果.结果).toBe('失败')
    expect(注册结果.错误信息).toContain('技能执行超时')
  })
})
