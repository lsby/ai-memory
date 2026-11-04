import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { Kysely, PGliteDialect, sql } from 'kysely'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { 初始化数据库, 记忆数据库架构版本 } from '../../../src/agent-memory/tools/db-schema'
import type { 记忆数据库 } from '../../../src/agent-memory/types'
import { 交互日志事件类型Schema, 带记忆的智能体, 记忆等级 } from '../../../src/index'

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
      线索: ['共享'],
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

  it('接入数据库时拒绝不兼容的架构版本', async (): Promise<void> => {
    let pglite = new PGlite({ extensions: { vector } })
    let 数据库查询器 = new Kysely<记忆数据库>({ dialect: new PGliteDialect({ pglite }) })
    try {
      await pglite.exec(`
        CREATE TABLE 系统版本表 (id INTEGER PRIMARY KEY, 内核架构版本 INTEGER NOT NULL);
        INSERT INTO 系统版本表 (id, 内核架构版本) VALUES (1, 999);
      `)
      await expect(初始化数据库(数据库查询器)).rejects.toThrow(
        `记忆数据库架构版本不兼容：代码要求 v${String(记忆数据库架构版本)}，数据库为 v999`,
      )
      let 业务表 = await pglite.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '记忆提交表'`,
      )
      expect(业务表.rows).toEqual([])
      let 扩展 = await pglite.query<{ extname: string }>(`SELECT extname FROM pg_extension WHERE extname = 'vector'`)
      expect(扩展.rows).toEqual([])
    } finally {
      await 数据库查询器.destroy()
    }
  })

  it('初始化数据库会创建 v15 行变更模型、消息向量列、强外键指针和关键索引', async (): Promise<void> => {
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
        WHERE tablename IN ('当前记忆表', '当前线索表', '当前记忆线索关联表', '当前技能线索关联表', '记忆行变更表', '记忆提交表', '日志表', '会话表')
      `.execute(数据库查询器)
      let 索引名称 = 索引结果.rows.map((行) => 行.indexname)
      let 日志内容列 = await sql<{ data_type: string }>`
        SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '日志表' AND column_name = '事件内容'
      `.execute(数据库查询器)
      let 日志事件类型列 = await sql<{ data_type: string; udt_name: string }>`
        SELECT data_type, udt_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '日志表' AND column_name = '事件类型'
      `.execute(数据库查询器)
      let 日志事件类型值 = await sql<{ enumlabel: string }>`
        SELECT e.enumlabel
        FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = '日志事件类型枚举'
        ORDER BY e.enumsortorder
      `.execute(数据库查询器)

      let 表结果 = await sql<{ table_name: string }>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN (
          '系统版本表', '记忆指针表', '记忆元数据表',
          '记忆实体表', '记忆关联实体表', '技能实体表',
          '当前记忆表', '当前线索表', '当前记忆线索关联表', '当前技能表', '当前技能线索关联表', '记忆提交表', '记忆行变更表', '日志表',
          '_记忆提交上下文表', '记忆表', '记忆关联表', '技能表', '记忆变更表', '交互日志表', '_agent_session_commit'
        )
      `.execute(数据库查询器)
      let 外键结果 = await sql<{ delete_rule: string }>`
        SELECT rc.delete_rule
        FROM information_schema.referential_constraints rc
        WHERE rc.constraint_schema = 'public' AND rc.constraint_name = '记忆指针表_当前记忆提交id_fkey'
      `.execute(数据库查询器)
      let 变更提交外键 = await sql<{ constraint_name: string; delete_rule: string }>`
        SELECT rc.constraint_name, rc.delete_rule
        FROM information_schema.referential_constraints rc
        WHERE rc.constraint_schema = 'public' AND rc.constraint_name = '记忆行变更表_记忆提交id_fkey'
      `.execute(数据库查询器)
      let 会话前驱列 = await sql<{ column_name: string }>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '会话表' AND column_name LIKE '前驱%'
        ORDER BY column_name
      `.execute(数据库查询器)
      let 会话前驱外键 = await sql<{ constraint_name: string; delete_rule: string }>`
        SELECT rc.constraint_name, rc.delete_rule FROM information_schema.referential_constraints rc
        WHERE rc.constraint_schema = 'public' AND rc.constraint_name = '会话表_前驱消息id_fkey'
      `.execute(数据库查询器)
      let 消息向量列 = await sql<{ column_name: string; data_type: string; is_nullable: string }>`
        SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '消息表' AND column_name IN ('向量', '向量维度')
        ORDER BY column_name
      `.execute(数据库查询器)

      expect(版本?.内核架构版本).toBe(记忆数据库架构版本)
      expect(指针).toEqual({ id: 1, 当前记忆提交id: null })
      expect(表结果.rows.map((记录) => 记录.table_name).sort()).toEqual(
        [
          '当前技能表',
          '当前技能线索关联表',
          '当前记忆表',
          '当前线索表',
          '当前记忆线索关联表',
          '记忆提交表',
          '记忆行变更表',
          '记忆指针表',
          '日志表',
          '系统版本表',
        ].sort(),
      )
      expect(外键结果.rows).toEqual([{ delete_rule: 'RESTRICT' }])
      expect(变更提交外键.rows).toEqual([{ constraint_name: '记忆行变更表_记忆提交id_fkey', delete_rule: 'RESTRICT' }])
      expect(会话前驱列.rows).toEqual([{ column_name: '前驱消息id' }])
      expect(会话前驱外键.rows).toEqual([{ constraint_name: '会话表_前驱消息id_fkey', delete_rule: 'RESTRICT' }])
      expect(消息向量列.rows).toEqual([
        { column_name: '向量', data_type: 'USER-DEFINED', is_nullable: 'YES' },
        { column_name: '向量维度', data_type: 'integer', is_nullable: 'YES' },
      ])
      await pglite.query(
        `INSERT INTO 会话表 (id, 标题, 创建时间, 更新时间) VALUES ('vector-session', '', now(), now())`,
      )
      await expect(
        pglite.query(
          `INSERT INTO 消息表 (id, 会话id, 角色, 载荷, 向量, 向量维度, 创建时间)
           VALUES ('bad-vector', 'vector-session', 'user', '{"role":"user","content":"x"}', '[1,2]', 3, now())`,
        ),
      ).rejects.toThrow()
      expect(日志内容列.rows).toEqual([{ data_type: 'jsonb' }])
      expect(日志事件类型列.rows).toEqual([{ data_type: 'USER-DEFINED', udt_name: '日志事件类型枚举' }])
      expect(日志事件类型值.rows.map((记录) => 记录.enumlabel)).toEqual(交互日志事件类型Schema.options)
      await expect(
        pglite.query(
          `INSERT INTO 日志表 (id, 事件组id, 事件类型, 开始时间, 事件内容) VALUES ('invalid-log-type', 'group', '未定义事件', now(), '{}')`,
        ),
      ).rejects.toThrow()
      expect(索引名称).toEqual(
        expect.arrayContaining([
          '当前记忆表_等级_创建序号_idx',
          '当前记忆线索关联表_线索_idx',
          '当前技能线索关联表_线索_idx',
          '记忆行变更表_提交内序号_idx',
          '记忆提交表_父记忆提交_idx',
          '记忆提交表_唯一根_idx',
          '记忆提交表_状态名称唯一_idx',
          '日志表_事件组_idx',
          '会话表_前驱消息_idx',
        ]),
      )
    } finally {
      await 数据库查询器.destroy()
    }
  })

  it('数据库原生保证唯一根并禁止删除 HEAD 提交', async (): Promise<void> => {
    let pglite = new PGlite({ extensions: { vector } })
    let 数据库查询器 = new Kysely<记忆数据库>({ dialect: new PGliteDialect({ pglite }) })
    try {
      await 初始化数据库(数据库查询器)
      await pglite.query(
        `INSERT INTO 记忆提交表 (id, 父记忆提交id, 提交说明, 创建时间) VALUES ('root', NULL, '根提交', now())`,
      )
      await pglite.query(`UPDATE 记忆指针表 SET 当前记忆提交id = 'root' WHERE id = 1`)

      await expect(
        pglite.query(
          `INSERT INTO 记忆提交表 (id, 父记忆提交id, 提交说明, 创建时间) VALUES ('root-2', NULL, '第二个根', now())`,
        ),
      ).rejects.toThrow()
      await expect(pglite.query(`DELETE FROM 记忆提交表 WHERE id = 'root'`)).rejects.toThrow()
      expect(await 数据库查询器.selectFrom('记忆指针表').select('当前记忆提交id').executeTakeFirst()).toEqual({
        当前记忆提交id: 'root',
      })
    } finally {
      await 数据库查询器.destroy()
    }
  })

  it('外键保证消息、HEAD 和前驱消息有效', async (): Promise<void> => {
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
          `INSERT INTO 会话表 (id, 标题, 前驱消息id, 创建时间, 更新时间) VALUES ('session-c', 'C', 'missing-message', now(), now())`,
        ),
      ).rejects.toThrow()
      await pglite.query(
        `INSERT INTO 会话表 (id, 标题, 前驱消息id, 创建时间, 更新时间) VALUES ('session-c', 'C', 'message-b', now(), now())`,
      )
      await expect(
        pglite.query(
          `INSERT INTO 当前技能表 (id, 名称, 描述, 代码, 创建时间) VALUES ('direct-tool', 'x', 'x', 'x', now())`,
        ),
      ).rejects.toThrow('只能在活动记忆提交中修改')
    } finally {
      await 数据库查询器.destroy()
    }
  })
})
