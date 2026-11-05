import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

type 包信息 = {
  name: string
  dependencies?: Record<string, string>
}

describe('@lsby/ai-memory 包边界', () => {
  it('记忆包通过 workspace 依赖普通智能体包', () => {
    let 内容 = fs.readFileSync(path.resolve(import.meta.dirname, '../../package.json'), 'utf-8')
    let 包信息 = JSON.parse(内容) as 包信息

    expect(包信息.name).toBe('@lsby/ai-memory')
    expect(包信息.dependencies?.['@lsby/ai-agent']).toBe('workspace:^')
  })
})
