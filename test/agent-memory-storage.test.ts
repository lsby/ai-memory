import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { Kysely, PGliteDialect, sql } from 'kysely'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { 记忆数据库 } from '../src/agent-memory/agent-memory-types'
import { 初始化数据库 } from '../src/agent-memory/tools/db-schema'
import { 带记忆的智能体, 记忆等级 } from '../src/index'

describe('文件存储生命周期', () => {
  let 智能体列表: 带记忆的智能体[] = []
  let 临时目录列表: string[] = []

  afterEach(async (): Promise<void> => {
    for (let 智能体实例 of 智能体列表.reverse()) await 智能体实例.销毁()
    智能体列表 = []
    for (let 临时目录 of 临时目录列表) await rm(临时目录, { recursive: true, force: true })
    临时目录列表 = []
  })

  it('等价相对和绝对路径共享初始化、实例与写入队列', async (): Promise<void> => {
    let 临时目录 = await mkdtemp(path.join(os.tmpdir(), 'ai-memory-storage-'))
    临时目录列表.push(临时目录)
    let 数据库绝对路径 = path.join(临时目录, 'shared-db')
    let 数据库相对路径 = path.relative(process.cwd(), 数据库绝对路径)
    let 第一实例 = new 带记忆的智能体({ 存储: { 模式: '文件', 路径: 数据库绝对路径 }, 向量模型: { 类型: '无' } })
    let 第二实例 = new 带记忆的智能体({ 存储: { 模式: '文件', 路径: 数据库相对路径 }, 向量模型: { 类型: '无' } })
    智能体列表.push(第一实例, 第二实例)

    await Promise.all([第一实例.初始化(), 第二实例.初始化()])
    await 第一实例.添加记忆({
      内容: '共享路径记忆',
      关键词: ['共享'],
      标签: [],
      评分: 80,
      等级: 记忆等级.一级,
      创建时间: new Date('2026-01-01T00:00:00.000Z'),
    })
    expect(await 第二实例.查询记忆()).toMatchObject([{ 内容: '共享路径记忆' }])

    await 第一实例.销毁()
    智能体列表 = [第二实例]
    expect(await 第二实例.查询记忆()).toHaveLength(1)
  })

  it('销毁后的实例拒绝继续访问数据库', async (): Promise<void> => {
    let 智能体实例 = new 带记忆的智能体({ 向量模型: { 类型: '无' } })
    await 智能体实例.初始化()
    await 智能体实例.销毁()

    await expect(智能体实例.查询记忆()).rejects.toThrow('已销毁')
    await expect(智能体实例.初始化()).rejects.toThrow('已销毁')
  })

  it('初始化数据库会创建 v2 元数据和关键查询索引', async (): Promise<void> => {
    let pglite = new PGlite({ extensions: { vector } })
    let 数据库查询器 = new Kysely<记忆数据库>({ dialect: new PGliteDialect({ pglite }) })
    try {
      await 初始化数据库(数据库查询器)
      let 版本 = await 数据库查询器
        .selectFrom('记忆元数据表')
        .select('值')
        .where('键', '=', 'KERNEL_SCHEMA_VERSION')
        .executeTakeFirst()
      let 索引结果 = await sql<{ indexname: string }>`
        SELECT indexname FROM pg_indexes WHERE tablename IN ('记忆表', '记忆关联表', '记忆变更表', '记忆提交表')
      `.execute(数据库查询器)
      let 索引名称 = 索引结果.rows.map((行) => 行.indexname)

      expect(版本?.值).toBe('2')
      expect(索引名称).toEqual(
        expect.arrayContaining([
          '记忆表_等级_创建序号_idx',
          '记忆表_关键词_idx',
          '记忆表_标签_idx',
          '记忆关联表_终点_idx',
          '记忆变更表_提交_idx',
        ]),
      )
    } finally {
      await 数据库查询器.destroy()
    }
  })
})
