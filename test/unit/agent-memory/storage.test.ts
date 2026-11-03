import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { Kysely, PGliteDialect, sql } from 'kysely'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { 初始化数据库 } from '../../../src/agent-memory/tools/db-schema'
import type { 记忆数据库 } from '../../../src/agent-memory/types'
import { 带记忆的智能体, 记忆等级 } from '../../../src/index'

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

  it('初始化数据库会创建 v9 版本与强外键指针、会话消息表和关键查询索引', async (): Promise<void> => {
    let pglite = new PGlite({ extensions: { vector } })
    let 数据库查询器 = new Kysely<记忆数据库>({ dialect: new PGliteDialect({ pglite }) })
    try {
      await 初始化数据库(数据库查询器)
      let 版本 = await 数据库查询器
        .selectFrom('系统版本表')
        .select('内核架构版本')
        .where('id', '=', 1)
        .executeTakeFirst()
      let 指针 = await 数据库查询器.selectFrom('记忆指针表').selectAll().where('id', '=', 1).executeTakeFirst()
      let 索引结果 = await sql<{ indexname: string }>`
        SELECT indexname FROM pg_indexes
        WHERE tablename IN ('记忆表', '记忆关联表', '记忆变更表', '记忆提交表', '交互日志表')
      `.execute(数据库查询器)
      let 索引名称 = 索引结果.rows.map((行) => 行.indexname)
      let 日志内容列 = await sql<{ data_type: string }>`
        SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '交互日志表' AND column_name = '内容'
      `.execute(数据库查询器)

      let 表结果 = await sql<{ table_name: string }>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('系统版本表', '记忆指针表', '记忆元数据表')
      `.execute(数据库查询器)
      let 外键结果 = await sql<{ delete_rule: string }>`
        SELECT rc.delete_rule
        FROM information_schema.referential_constraints rc
        WHERE rc.constraint_schema = 'public' AND rc.constraint_name = '记忆指针表_head_commit_id_fkey'
      `.execute(数据库查询器)

      expect(版本?.内核架构版本).toBe(9)
      expect(指针).toEqual({ id: 1, head_commit_id: null })
      expect(表结果.rows.map((记录) => 记录.table_name).sort()).toEqual(['系统版本表', '记忆指针表'])
      expect(外键结果.rows).toEqual([{ delete_rule: 'RESTRICT' }])
      expect(日志内容列.rows).toEqual([{ data_type: 'json' }])
      expect(索引名称).toEqual(
        expect.arrayContaining([
          '记忆表_等级_创建序号_idx',
          '记忆表_关键词_idx',
          '记忆表_标签_idx',
          '记忆关联表_终点_idx',
          '记忆变更表_提交_idx',
          '记忆提交表_父提交_idx',
          '记忆提交表_唯一根_idx',
          '交互日志表_事件组_idx',
        ]),
      )
    } finally {
      await 数据库查询器.destroy()
    }
  })

  it('v9 拒绝把旧元数据库当作新库自动迁移', async (): Promise<void> => {
    let pglite = new PGlite({ extensions: { vector } })
    let 数据库查询器 = new Kysely<记忆数据库>({ dialect: new PGliteDialect({ pglite }) })
    try {
      await pglite.exec('CREATE TABLE 记忆元数据表 (键 TEXT PRIMARY KEY, 值 TEXT NOT NULL)')
      await expect(初始化数据库(数据库查询器)).rejects.toThrow('v9 不支持自动迁移')
      let 新表 = await pglite.query<{ table_name: string }>(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('系统版本表', '记忆指针表')
      `)
      expect(新表.rows).toEqual([])
    } finally {
      await 数据库查询器.destroy()
    }
  })

  it('数据库原生保证唯一根并禁止删除 HEAD 提交', async (): Promise<void> => {
    let pglite = new PGlite({ extensions: { vector } })
    let 数据库查询器 = new Kysely<记忆数据库>({ dialect: new PGliteDialect({ pglite }) })
    try {
      await 初始化数据库(数据库查询器)
      await pglite.query(`INSERT INTO 记忆提交表 (id, 父提交id, 消息, 创建时间) VALUES ('root', NULL, '根提交', now())`)
      await pglite.query(`UPDATE 记忆指针表 SET head_commit_id = 'root' WHERE id = 1`)

      await expect(
        pglite.query(
          `INSERT INTO 记忆提交表 (id, 父提交id, 消息, 创建时间) VALUES ('root-2', NULL, '第二个根', now())`,
        ),
      ).rejects.toThrow()
      await expect(pglite.query(`DELETE FROM 记忆提交表 WHERE id = 'root'`)).rejects.toThrow()
      expect(await 数据库查询器.selectFrom('记忆指针表').select('head_commit_id').executeTakeFirst()).toEqual({
        head_commit_id: 'root',
      })
    } finally {
      await 数据库查询器.destroy()
    }
  })

  it('组合外键保证消息、HEAD 和前驱消息的会话归属', async (): Promise<void> => {
    let pglite = new PGlite({ extensions: { vector } })
    let 数据库查询器 = new Kysely<记忆数据库>({ dialect: new PGliteDialect({ pglite }) })
    try {
      await 初始化数据库(数据库查询器)
      await pglite.exec(`
        INSERT INTO 会话表 (id, 标题, 创建时间, 更新时间) VALUES
          ('session-a', 'A', now(), now()),
          ('session-b', 'B', now(), now());
        INSERT INTO 消息表 (id, 会话id, 父消息id, 角色, 载荷, 创建时间) VALUES
          ('message-a', 'session-a', NULL, 'user', '{"role":"user","content":"A"}', now()),
          ('message-b', 'session-b', NULL, 'user', '{"role":"user","content":"B"}', now());
      `)

      await pglite.query(`UPDATE 会话表 SET 当前消息id = 'message-a' WHERE id = 'session-a'`)
      await pglite.query(
        `INSERT INTO 消息表 (id, 会话id, 父消息id, 角色, 载荷, 创建时间) VALUES ('message-a-2', 'session-a', 'message-a', 'assistant', '{"role":"assistant","content":"A2"}', now())`,
      )
      await expect(
        pglite.query(
          `INSERT INTO 消息表 (id, 会话id, 父消息id, 角色, 载荷, 创建时间) VALUES ('cross-parent', 'session-a', 'message-b', 'assistant', '{"role":"assistant","content":"x"}', now())`,
        ),
      ).rejects.toThrow()
      await expect(pglite.query(`UPDATE 会话表 SET 当前消息id = 'message-b' WHERE id = 'session-a'`)).rejects.toThrow()
      await expect(
        pglite.query(
          `INSERT INTO 会话表 (id, 标题, 前驱会话id, 前驱消息id, 创建时间, 更新时间) VALUES ('session-c', 'C', 'session-a', 'message-b', now(), now())`,
        ),
      ).rejects.toThrow()
      await expect(
        pglite.query(`UPDATE _agent_session_commit SET commit_id = 'missing-commit' WHERE id = 1`),
      ).rejects.toThrow()
    } finally {
      await 数据库查询器.destroy()
    }
  })
})
