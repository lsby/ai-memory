import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll } from 'vitest'
import { 带记忆的智能体, type 带记忆的智能体选项 } from '../../src/index'
import { 创建带向量的PGlite } from './shared-storage-helper'

export type 共享PGlite夹具 = {
  /** 给当前用例分配一个全文件唯一的 schema 名。 */
  分配schema(): string
  /** 新建一个用共享 PGlite + 独立 schema 的实例；默认不用向量模型，选项可覆盖。 */
  新建智能体(选项?: 带记忆的智能体选项): 带记忆的智能体
}

let schema计数 = 0

/**
 * 每个测试文件共用一个带 pgvector 的 PGlite，每个用例用自己的 schema，省掉每个用例新开 PGlite 的初始化耗时。
 * 在 describe 内部（或文件顶层）调用一次；beforeAll 建句柄，afterAll 关句柄。
 * 不测内存/文件模式、不依赖 public schema 的用例才使用它。
 */
export function 使用共享PGlite(): 共享PGlite夹具 {
  let pglite: PGlite | undefined

  beforeAll((): void => {
    pglite = 创建带向量的PGlite()
  })

  afterAll(async (): Promise<void> => {
    if (pglite !== undefined) {
      await pglite.close()
      pglite = undefined
    }
  })

  function 分配schema(): string {
    schema计数 += 1
    return `case_${String(schema计数)}`
  }

  return {
    分配schema,
    新建智能体(选项: 带记忆的智能体选项 = {}): 带记忆的智能体 {
      if (pglite === undefined) throw new Error('共享 PGlite 尚未初始化，请在用例或钩子内部调用')
      return new 带记忆的智能体({
        向量模型: { 类型: '无' },
        ...选项,
        存储: { 模式: '外部', pglite, schema: 分配schema() },
      })
    },
  }
}
