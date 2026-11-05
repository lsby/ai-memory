import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

type 包信息 = {
  name: string
  dependencies?: Record<string, string>
}

describe('@lsby/ai-agent 包边界', () => {
  it('不安装记忆运行时', () => {
    let 内容 = fs.readFileSync(path.resolve(import.meta.dirname, '../../package.json'), 'utf-8')
    let 包信息 = JSON.parse(内容) as 包信息
    let 依赖 = 包信息.dependencies ?? {}

    expect(包信息.name).toBe('@lsby/ai-agent')
    expect(依赖).not.toHaveProperty('@electric-sql/pglite')
    expect(依赖).not.toHaveProperty('@huggingface/transformers')
    expect(依赖).not.toHaveProperty('kysely')
    expect(依赖).not.toHaveProperty('quickjs-emscripten')
  })
})
