import { Kysely, sql } from 'kysely'
import { 校验记忆提交拓扑 } from '../operations/commit'
import { 校验schema名, 转义标识符, 默认schema } from '../storage/connection'
import { 记忆数据库 } from '../types'
import { 确保在事务中执行 } from './common'
import { 初始化不可变约束 } from './db-immutable-schema'

export let 记忆数据库架构版本 = 14

/**
 * 在指定 schema 里建表（默认 public，和旧版本的数据布局一致）。
 * 所有对象（枚举、表、索引、触发器函数）都带 schema 前缀，不依赖会话里当时的 search_path；
 * vector 扩展只在 public 建一次。整个初始化在一个事务里完成，互斥锁因此不会被别的实例插队。
 */
export async function 初始化数据库(数据库查询器: Kysely<记忆数据库>, schema: string = 默认schema): Promise<void> {
  await 确保在事务中执行(数据库查询器, async (trx) => await 在事务中初始化数据库(trx, 校验schema名(schema)))
}

async function 在事务中初始化数据库(数据库查询器: Kysely<记忆数据库>, schema: string): Promise<void> {
  let 名 = (对象名: string): string => `${转义标识符(schema)}.${转义标识符(对象名)}`
  let 执行 = async (语句: string): Promise<void> => {
    await sql.raw(语句).execute(数据库查询器)
  }

  let 现有表结果 = await sql<{ table_name: string }>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = ${schema}
      AND table_name IN ('记忆元数据表', '系统版本表', '记忆表', '当前记忆表', '记忆提交表')
  `.execute(数据库查询器)
  let 现有表 = new Set(现有表结果.rows.map((记录) => 记录.table_name))
  if (现有表.has('记忆元数据表')) throw new Error('检测到旧版记忆数据库；v14 不支持自动迁移，请使用全新 schema')
  let 全新数据库 = 现有表.has('系统版本表') === false
  if (全新数据库 && (现有表.has('记忆表') || 现有表.has('当前记忆表') || 现有表.has('记忆提交表'))) {
    throw new Error('检测到没有系统版本的记忆数据表，拒绝将其当作全新 v14 数据库')
  }
  if (全新数据库 === false) {
    let 版本结果 = await sql<{ 内核架构版本: number }>`
      SELECT 内核架构版本 FROM ${sql.raw(名('系统版本表'))} WHERE id = 1
    `.execute(数据库查询器)
    let 版本 = 版本结果.rows[0]?.内核架构版本
    if (版本 !== 记忆数据库架构版本 || 版本结果.rows.length !== 1) {
      throw new Error(`记忆数据库架构版本不兼容：代码要求 v${String(记忆数据库架构版本)}，数据库为 v${String(版本)}`)
    }
  }

  if (schema !== 默认schema) await 执行(`CREATE SCHEMA IF NOT EXISTS ${转义标识符(schema)}`)
  await 执行(`CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public`)

  let enumCheck = await sql`
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = '记忆等级枚举' AND n.nspname = ${schema}
  `.execute(数据库查询器)
  if (enumCheck.rows.length === 0) {
    await 执行(`CREATE TYPE ${名('记忆等级枚举')} AS ENUM ('零级', '一级', '二级');`)
  }
  let 日志事件类型枚举检查 = await sql`
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = '日志事件类型枚举' AND n.nspname = ${schema}
  `.execute(数据库查询器)
  if (日志事件类型枚举检查.rows.length === 0) {
    await 执行(`
      CREATE TYPE ${名('日志事件类型枚举')} AS ENUM (
        '流程开始', '流程结束', '流程异常', '记忆召回', '记忆提交', '记忆分支切换',
        'AI文本片段', '工具调用开始', '工具调用结果', '工具调用失败', '校验失败', '最终结果',
        '流程信息', '错误', '原始请求配置', '原始AI返回', '模型请求审计', '模型响应完成', '自定义'
      );
    `)
  }
  let 记忆变更目标表枚举检查 = await sql`
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = '记忆变更目标表枚举' AND n.nspname = ${schema}
  `.execute(数据库查询器)
  if (记忆变更目标表枚举检查.rows.length === 0) {
    await 执行(
      `CREATE TYPE ${名('记忆变更目标表枚举')} AS ENUM ('memory', 'clue', 'memory_clue_relation', 'dynamic_tool');`,
    )
  }
  let 记忆行操作类型枚举检查 = await sql`
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = '记忆行操作类型枚举' AND n.nspname = ${schema}
  `.execute(数据库查询器)
  if (记忆行操作类型枚举检查.rows.length === 0) {
    await 执行(`CREATE TYPE ${名('记忆行操作类型枚举')} AS ENUM ('insert', 'update', 'delete');`)
  }

  await 执行(`
          CREATE TABLE IF NOT EXISTS ${名('当前记忆表')} (
            id TEXT PRIMARY KEY,
            等级 ${名('记忆等级枚举')} NOT NULL,
            评分 DOUBLE PRECISION NOT NULL,
            内容 TEXT NOT NULL,
            向量 public.vector,
            向量维度 INTEGER,
            创建时间 TIMESTAMPTZ NOT NULL,
            创建序号 SERIAL,
            最后访问序号 INTEGER NOT NULL DEFAULT 0,
            访问次数 INTEGER NOT NULL DEFAULT 0,
            x DOUBLE PRECISION NOT NULL DEFAULT 0,
            y DOUBLE PRECISION NOT NULL DEFAULT 0
          )
        `)

  await 执行(`
          CREATE TABLE IF NOT EXISTS ${名('当前线索表')} (
            id TEXT PRIMARY KEY,
            内容 TEXT NOT NULL UNIQUE,
            向量 public.vector,
            向量维度 INTEGER,
            创建时间 TIMESTAMPTZ NOT NULL
          )
        `)

  await 执行(`
          CREATE TABLE IF NOT EXISTS ${名('当前记忆线索关联表')} (
            记忆id TEXT NOT NULL REFERENCES ${名('当前记忆表')}(id) ON DELETE RESTRICT,
            线索id TEXT NOT NULL REFERENCES ${名('当前线索表')}(id) ON DELETE RESTRICT,
            向量 public.vector,
            向量维度 INTEGER,
            PRIMARY KEY (记忆id, 线索id)
          )
        `)

  await 执行(`
          CREATE TABLE IF NOT EXISTS ${名('记忆提交表')} (
            id TEXT PRIMARY KEY,
            父记忆提交id TEXT,
            提交说明 TEXT NOT NULL,
            状态名称 TEXT,
            创建时间 TIMESTAMPTZ NOT NULL
          )
        `)

  await 执行(`
          CREATE TABLE IF NOT EXISTS ${名('记忆行变更表')} (
            id TEXT PRIMARY KEY,
            记忆提交id TEXT NOT NULL REFERENCES ${名('记忆提交表')}(id) ON DELETE RESTRICT,
            提交内序号 INTEGER NOT NULL,
            目标表 ${名('记忆变更目标表枚举')} NOT NULL,
            操作类型 ${名('记忆行操作类型枚举')} NOT NULL,
            主键 JSONB NOT NULL,
            行数据 JSONB
          )
        `)

  await 执行(`
          CREATE TABLE IF NOT EXISTS ${名('系统版本表')} (
            id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
            内核架构版本 INTEGER NOT NULL CHECK (内核架构版本 > 0)
          )
        `)

  await 执行(`
          CREATE TABLE IF NOT EXISTS ${名('记忆指针表')} (
            id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
            当前记忆提交id TEXT REFERENCES ${名('记忆提交表')}(id) ON DELETE RESTRICT
          )
        `)
  if (全新数据库) {
    await 数据库查询器.insertInto('系统版本表').values({ id: 1, 内核架构版本: 记忆数据库架构版本 }).execute()
    await 数据库查询器.insertInto('记忆指针表').values({ id: 1, 当前记忆提交id: null }).execute()
  }
  await 校验记忆提交拓扑(数据库查询器)

  await 执行(`
          CREATE TABLE IF NOT EXISTS ${名('当前动态工具表')} (
            id TEXT PRIMARY KEY,
            名称 TEXT NOT NULL UNIQUE,
            描述 TEXT NOT NULL,
            代码 TEXT NOT NULL,
            向量 public.vector,
            向量维度 INTEGER,
            创建时间 TIMESTAMPTZ NOT NULL
          )
        `)

  await 执行(`
          CREATE TABLE IF NOT EXISTS ${名('会话表')} (
            id TEXT PRIMARY KEY,
            标题 TEXT NOT NULL DEFAULT '',
            当前消息id TEXT,
            前驱消息id TEXT,
            创建时间 TIMESTAMPTZ NOT NULL,
            更新时间 TIMESTAMPTZ NOT NULL
          )
        `)

  await 执行(`
          CREATE TABLE IF NOT EXISTS ${名('消息表')} (
            id TEXT PRIMARY KEY,
            序号 BIGSERIAL,
            会话id TEXT NOT NULL REFERENCES ${名('会话表')}(id) ON DELETE RESTRICT,
            父消息id TEXT,
            角色 TEXT NOT NULL CHECK (角色 IN ('system', 'developer', 'user', 'assistant', 'tool', 'function')),
            载荷 JSONB NOT NULL,
            向量 public.vector,
            向量维度 INTEGER,
            创建时间 TIMESTAMPTZ NOT NULL,
            CHECK (
              (向量 IS NULL AND 向量维度 IS NULL)
              OR (向量 IS NOT NULL AND 向量维度 = public.vector_dims(向量))
            )
          )
        `)

  await 执行(`
          CREATE TABLE IF NOT EXISTS ${名('前缀快照表')} (
            id TEXT PRIMARY KEY,
            系统提示词 TEXT NOT NULL,
            工具定义 JSONB NOT NULL,
            创建时间 TIMESTAMPTZ NOT NULL
          )
        `)

  await 执行(`
          CREATE TABLE IF NOT EXISTS ${名('日志表')} (
            id TEXT PRIMARY KEY,
            序号 BIGSERIAL,
            事件组id TEXT NOT NULL,
            事件类型 ${名('日志事件类型枚举')} NOT NULL,
            开始时间 TIMESTAMPTZ NOT NULL,
            耗时ms DOUBLE PRECISION,
            事件内容 JSONB NOT NULL,
            上下文头消息id TEXT REFERENCES ${名('消息表')}(id) ON DELETE RESTRICT,
            关联消息id TEXT REFERENCES ${名('消息表')}(id) ON DELETE RESTRICT,
            模型请求id TEXT,
            当时记忆提交id TEXT REFERENCES ${名('记忆提交表')}(id) ON DELETE RESTRICT,
            前缀快照id TEXT REFERENCES ${名('前缀快照表')}(id) ON DELETE RESTRICT
          )
        `)

  await 执行(`ALTER TABLE ${名('日志表')} ADD COLUMN IF NOT EXISTS 上下文头消息id TEXT;`)
  await 执行(`ALTER TABLE ${名('日志表')} ADD COLUMN IF NOT EXISTS 关联消息id TEXT;`)
  await 执行(`ALTER TABLE ${名('日志表')} ADD COLUMN IF NOT EXISTS 模型请求id TEXT;`)
  await 执行(`ALTER TABLE ${名('日志表')} ADD COLUMN IF NOT EXISTS 当时记忆提交id TEXT;`)
  await 执行(`ALTER TABLE ${名('日志表')} ADD COLUMN IF NOT EXISTS 前缀快照id TEXT;`)
  await 执行(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '日志表_上下文头消息id_fkey' AND conrelid = '日志表'::regclass) THEN
        ALTER TABLE ${名('日志表')} ADD CONSTRAINT 日志表_上下文头消息id_fkey
          FOREIGN KEY (上下文头消息id) REFERENCES ${名('消息表')}(id) ON DELETE RESTRICT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '日志表_关联消息id_fkey' AND conrelid = '日志表'::regclass) THEN
        ALTER TABLE ${名('日志表')} ADD CONSTRAINT 日志表_关联消息id_fkey
          FOREIGN KEY (关联消息id) REFERENCES ${名('消息表')}(id) ON DELETE RESTRICT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '日志表_当时记忆提交id_fkey' AND conrelid = '日志表'::regclass) THEN
        ALTER TABLE ${名('日志表')} ADD CONSTRAINT 日志表_当时记忆提交id_fkey
          FOREIGN KEY (当时记忆提交id) REFERENCES ${名('记忆提交表')}(id) ON DELETE RESTRICT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '日志表_前缀快照id_fkey' AND conrelid = '日志表'::regclass) THEN
        ALTER TABLE ${名('日志表')} ADD CONSTRAINT 日志表_前缀快照id_fkey
          FOREIGN KEY (前缀快照id) REFERENCES ${名('前缀快照表')}(id) ON DELETE RESTRICT;
      END IF;
    END $$;
  `)

  await 执行(`CREATE INDEX IF NOT EXISTS 当前记忆表_等级_创建序号_idx ON ${名('当前记忆表')} (等级, 创建序号);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 当前记忆表_创建时间_idx ON ${名('当前记忆表')} (创建时间);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 当前记忆线索关联表_线索_idx ON ${名('当前记忆线索关联表')} (线索id);`)
  await 执行(
    `CREATE UNIQUE INDEX IF NOT EXISTS 记忆行变更表_提交内序号_idx ON ${名('记忆行变更表')} (记忆提交id, 提交内序号);`,
  )
  await 执行(`CREATE INDEX IF NOT EXISTS 记忆提交表_创建时间_idx ON ${名('记忆提交表')} (创建时间 DESC);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 记忆提交表_父记忆提交_idx ON ${名('记忆提交表')} (父记忆提交id);`)
  await 执行(
    `CREATE UNIQUE INDEX IF NOT EXISTS 记忆提交表_唯一根_idx ON ${名('记忆提交表')} ((1)) WHERE 父记忆提交id IS NULL;`,
  )
  await 执行(
    `CREATE UNIQUE INDEX IF NOT EXISTS 记忆提交表_状态名称唯一_idx ON ${名('记忆提交表')} (状态名称) WHERE 状态名称 IS NOT NULL;`,
  )
  await 执行(`CREATE INDEX IF NOT EXISTS 日志表_事件组_idx ON ${名('日志表')} (事件组id, 序号);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 日志表_开始时间_idx ON ${名('日志表')} (开始时间 DESC);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 会话表_更新时间_idx ON ${名('会话表')} (更新时间 DESC, id);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 会话表_前驱消息_idx ON ${名('会话表')} (前驱消息id);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 消息表_会话序号_idx ON ${名('消息表')} (会话id, 序号);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 消息表_父消息_idx ON ${名('消息表')} (父消息id);`)
  await 执行(`CREATE UNIQUE INDEX IF NOT EXISTS 消息表_会话_id_unique ON ${名('消息表')} (会话id, id);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 日志表_上下文头消息_idx ON ${名('日志表')} (上下文头消息id);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 日志表_关联消息_idx ON ${名('日志表')} (关联消息id);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 日志表_模型请求_idx ON ${名('日志表')} (模型请求id, 序号);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 日志表_当时记忆提交_idx ON ${名('日志表')} (当时记忆提交id);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 日志表_前缀快照_idx ON ${名('日志表')} (前缀快照id);`)

  await 初始化不可变约束(数据库查询器, schema)

  // 所有业务写入必须先创建活动提交。事务局部配置对触发器可见，并会在提交或回滚后自动清除。
  await 执行(`
    CREATE OR REPLACE FUNCTION ${名('校验记忆写入上下文_触发器')}()
    RETURNS TRIGGER AS $$
    DECLARE
      v_活动记忆提交id TEXT;
      v_回放中 BOOLEAN;
      v_当前记忆提交id TEXT;
      v_父记忆提交id TEXT;
      v_提交说明 TEXT;
    BEGIN
      v_回放中 := COALESCE(current_setting('lsby_ai_memory.replaying', TRUE), '') = 'true';
      IF v_回放中 THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END IF;

      v_活动记忆提交id := NULLIF(current_setting('lsby_ai_memory.active_commit_id', TRUE), '');
      IF v_活动记忆提交id IS NULL OR v_活动记忆提交id = '' THEN
        RAISE EXCEPTION '%只能在活动记忆提交中修改', TG_TABLE_NAME;
      END IF;

      SELECT 父记忆提交id, 提交说明 INTO v_父记忆提交id, v_提交说明
      FROM ${名('记忆提交表')} WHERE id = v_活动记忆提交id;
      IF NOT FOUND OR v_提交说明 IS NULL OR length(btrim(v_提交说明)) = 0 THEN
        RAISE EXCEPTION '活动记忆提交不存在或提交说明为空: %', v_活动记忆提交id;
      END IF;

      SELECT 当前记忆提交id INTO v_当前记忆提交id FROM ${名('记忆指针表')} WHERE id = 1;
      IF v_父记忆提交id IS DISTINCT FROM v_当前记忆提交id THEN
        RAISE EXCEPTION '活动记忆提交的父提交必须是当前 HEAD: 父提交 %, HEAD %', v_父记忆提交id, v_当前记忆提交id;
      END IF;

      IF TG_OP = 'UPDATE' AND TG_TABLE_NAME IN ('当前记忆表', '当前线索表', '当前动态工具表')
        AND to_jsonb(OLD)->>'id' IS DISTINCT FROM to_jsonb(NEW)->>'id' THEN
        RAISE EXCEPTION '%不允许修改主键', TG_TABLE_NAME;
      END IF;
      IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = '当前记忆线索关联表'
        AND (to_jsonb(OLD)->>'记忆id' IS DISTINCT FROM to_jsonb(NEW)->>'记忆id'
          OR to_jsonb(OLD)->>'线索id' IS DISTINCT FROM to_jsonb(NEW)->>'线索id') THEN
        RAISE EXCEPTION '当前记忆线索关联表不允许修改主键';
      END IF;

      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)
  for (let 表名 of ['当前记忆表', '当前线索表', '当前记忆线索关联表', '当前动态工具表']) {
    await 执行(`DROP TRIGGER IF EXISTS trg_校验记忆写入上下文 ON ${名(表名)};`)
    await 执行(`
      CREATE TRIGGER trg_校验记忆写入上下文
      BEFORE INSERT OR UPDATE OR DELETE ON ${名(表名)}
      FOR EACH ROW EXECUTE FUNCTION ${名('校验记忆写入上下文_触发器')}();
    `)
  }

  // 一个提交可以包含多项行级变化；触发器按发生顺序记录完整的新行快照。
  await 执行(`
    CREATE OR REPLACE FUNCTION ${名('记录记忆行变更_触发器')}()
    RETURNS TRIGGER AS $$
    DECLARE
      v_活动记忆提交id TEXT;
      v_回放中 BOOLEAN;
      v_目标表 ${名('记忆变更目标表枚举')};
      v_操作类型 ${名('记忆行操作类型枚举')};
      v_主键 JSONB;
      v_行数据 JSONB;
      v_提交内序号 INTEGER;
    BEGIN
      v_回放中 := COALESCE(current_setting('lsby_ai_memory.replaying', TRUE), '') = 'true';
      IF v_回放中 THEN
        RETURN NULL;
      END IF;

      v_活动记忆提交id := NULLIF(current_setting('lsby_ai_memory.active_commit_id', TRUE), '');
      IF v_活动记忆提交id IS NULL THEN
        RAISE EXCEPTION '%只能在活动记忆提交中修改', TG_TABLE_NAME;
      END IF;
      IF TG_OP = 'UPDATE' AND to_jsonb(OLD) IS NOT DISTINCT FROM to_jsonb(NEW) THEN
        RETURN NULL;
      END IF;

      IF TG_OP = 'INSERT' THEN
        v_操作类型 := 'insert';
        v_行数据 := to_jsonb(NEW);
      ELSIF TG_OP = 'UPDATE' THEN
        v_操作类型 := 'update';
        v_行数据 := to_jsonb(NEW);
      ELSIF TG_OP = 'DELETE' THEN
        v_操作类型 := 'delete';
        v_行数据 := NULL;
      END IF;

      IF TG_TABLE_NAME = '当前记忆表' THEN
        v_目标表 := 'memory';
        IF TG_OP = 'DELETE' THEN
          v_主键 := jsonb_build_object('id', to_jsonb(OLD)->>'id');
        ELSE
          v_主键 := jsonb_build_object('id', to_jsonb(NEW)->>'id');
        END IF;
      ELSIF TG_TABLE_NAME = '当前线索表' THEN
        v_目标表 := 'clue';
        IF TG_OP = 'DELETE' THEN
          v_主键 := jsonb_build_object('id', to_jsonb(OLD)->>'id');
        ELSE
          v_主键 := jsonb_build_object('id', to_jsonb(NEW)->>'id');
        END IF;
      ELSIF TG_TABLE_NAME = '当前记忆线索关联表' THEN
        v_目标表 := 'memory_clue_relation';
        IF TG_OP = 'DELETE' THEN
          v_主键 := jsonb_build_object('记忆id', to_jsonb(OLD)->>'记忆id', '线索id', to_jsonb(OLD)->>'线索id');
        ELSE
          v_主键 := jsonb_build_object('记忆id', to_jsonb(NEW)->>'记忆id', '线索id', to_jsonb(NEW)->>'线索id');
        END IF;
      ELSIF TG_TABLE_NAME = '当前动态工具表' THEN
        v_目标表 := 'dynamic_tool';
        IF TG_OP = 'DELETE' THEN
          v_主键 := jsonb_build_object('id', to_jsonb(OLD)->>'id');
        ELSE
          v_主键 := jsonb_build_object('id', to_jsonb(NEW)->>'id');
        END IF;
      ELSE
        RAISE EXCEPTION '未知的记忆投影表: %', TG_TABLE_NAME;
      END IF;

      SELECT COALESCE(MAX(提交内序号), 0) + 1 INTO v_提交内序号
      FROM ${名('记忆行变更表')} WHERE 记忆提交id = v_活动记忆提交id;
      INSERT INTO ${名('记忆行变更表')}
        (id, 记忆提交id, 提交内序号, 目标表, 操作类型, 主键, 行数据)
      VALUES
        (gen_random_uuid()::TEXT, v_活动记忆提交id, v_提交内序号, v_目标表, v_操作类型, v_主键, v_行数据);

      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `)

  for (let 表名 of ['当前记忆表', '当前线索表', '当前记忆线索关联表', '当前动态工具表']) {
    await 执行(`DROP TRIGGER IF EXISTS trg_记录记忆行变更 ON ${名(表名)};`)
    await 执行(`
      CREATE TRIGGER trg_记录记忆行变更
      AFTER INSERT OR UPDATE OR DELETE ON ${名(表名)}
      FOR EACH ROW EXECUTE FUNCTION ${名('记录记忆行变更_触发器')}();
    `)
  }
}
