import * as 公共API from '@lsby/ai-memory'
import { describe, expect, it } from 'vitest'

describe('@lsby/ai-memory 公共 API', () => {
  it('不导出数据库 schema 或底层查询能力', () => {
    expect(公共API).not.toHaveProperty('当前记忆表Schema')
    expect(公共API).not.toHaveProperty('当前记忆关联表Schema')
  })

  it('基础语言包不携带记忆文案，兼容语言包仍保留完整记忆能力', () => {
    expect(公共API.中文基础模型语言包).not.toHaveProperty('默认记忆提示词')
    expect(公共API.英文基础模型语言包).not.toHaveProperty('记忆工具描述')
    expect(公共API.中文模型语言包).toHaveProperty('默认记忆提示词')
    expect(公共API.英文模型语言包).toHaveProperty('记忆工具描述')
  })
})
