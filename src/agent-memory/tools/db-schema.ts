import { Kysely, sql } from 'kysely'
import { 校验记忆提交拓扑 } from '../operations/commit'
import { 校验schema名, 转义标识符, 默认schema } from '../storage/connection'
import { 记忆数据库 } from '../types'
import { 确保在事务中执行 } from './common'
import { 初始化不可变约束 } from './db-immutable-schema'
import { 初始化永久实体登记触发器, 初始化永久实体表 } from './db-permanent-entities'

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

  if (schema !== 默认schema) await 执行(`CREATE SCHEMA IF NOT EXISTS ${转义标识符(schema)}`)
  await 执行(`CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public`)

  let 现有表结果 = await sql<{ table_name: string }>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = ${schema}
      AND table_name IN ('记忆元数据表', '系统版本表', '记忆表', '当前记忆表', '记忆提交表')
  `.execute(数据库查询器)
  let 现有表 = new Set(现有表结果.rows.map((记录) => 记录.table_name))
  if (现有表.has('记忆元数据表')) throw new Error('检测到 v8 或更旧的记忆数据库；v10 不支持自动迁移，请使用全新 schema')
  let 全新数据库 = 现有表.has('系统版本表') === false
  if (全新数据库 && (现有表.has('记忆表') || 现有表.has('当前记忆表') || 现有表.has('记忆提交表'))) {
    throw new Error('检测到没有系统版本的记忆数据表，拒绝将其当作全新 v10 数据库')
  }
  if (全新数据库 === false) {
    let 版本结果 = await sql<{ 内核架构版本: number }>`
      SELECT 内核架构版本 FROM ${sql.raw(名('系统版本表'))} WHERE id = 1
    `.execute(数据库查询器)
    let 版本 = 版本结果.rows[0]?.内核架构版本
    if (版本 !== 10 || 版本结果.rows.length !== 1) throw new Error(`不支持的记忆数据库版本: ${String(版本)}`)
  }

  let enumCheck = await sql`
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = '记忆等级枚举' AND n.nspname = ${schema}
  `.execute(数据库查询器)
  if (enumCheck.rows.length === 0) {
    await 执行(`CREATE TYPE ${名('记忆等级枚举')} AS ENUM ('零级', '一级', '二级');`)
  }

  await 执行(`
          CREATE TABLE IF NOT EXISTS ${名('当前记忆表')} (
            id TEXT PRIMARY KEY,
            等级 ${名('记忆等级枚举')} NOT NULL,
            评分 DOUBLE PRECISION NOT NULL,
            内容 TEXT NOT NULL,
            关键词 TEXT[] NOT NULL,
            标签 TEXT[] NOT NULL DEFAULT '{}',
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
          CREATE TABLE IF NOT EXISTS ${名('当前记忆关联表')} (
            起点id TEXT NOT NULL REFERENCES ${名('当前记忆表')}(id) ON DELETE CASCADE,
            终点id TEXT NOT NULL REFERENCES ${名('当前记忆表')}(id) ON DELETE CASCADE,
            关联度 DOUBLE PRECISION NOT NULL,
            PRIMARY KEY (起点id, 终点id)
          )
        `)

  await 执行(`
          CREATE TABLE IF NOT EXISTS ${名('记忆提交表')} (
            id TEXT PRIMARY KEY,
            父记忆提交id TEXT,
            提交说明 TEXT NOT NULL,
            创建时间 TIMESTAMPTZ NOT NULL
          )
        `)

  await 执行(`
          CREATE TABLE IF NOT EXISTS ${名('记忆提交变更表')} (
            id TEXT PRIMARY KEY,
            序号 BIGSERIAL,
            记忆提交id TEXT NOT NULL REFERENCES ${名('记忆提交表')}(id) ON DELETE CASCADE,
            变更类型 TEXT NOT NULL,
            目标实体类型 TEXT NOT NULL,
            记忆实体id TEXT,
            起点记忆实体id TEXT,
            终点记忆实体id TEXT,
            动态工具实体id TEXT,
            变更前数据 JSONB,
            变更后数据 JSONB
          )
        `)

  await 执行(`ALTER TABLE ${名('记忆提交变更表')} ADD COLUMN IF NOT EXISTS 序号 BIGSERIAL;`)

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
    await 数据库查询器.insertInto('系统版本表').values({ id: 1, 内核架构版本: 10 }).execute()
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

  await 初始化永久实体表(数据库查询器, schema)

  await 执行(`
          CREATE TABLE IF NOT EXISTS ${名('会话表')} (
            id TEXT PRIMARY KEY,
            标题 TEXT NOT NULL DEFAULT '',
            当前消息id TEXT,
            前驱会话id TEXT REFERENCES ${名('会话表')}(id) ON DELETE RESTRICT,
            前驱消息id TEXT,
            创建时间 TIMESTAMPTZ NOT NULL,
            更新时间 TIMESTAMPTZ NOT NULL,
            CHECK ((前驱会话id IS NULL) = (前驱消息id IS NULL)),
            CHECK (前驱会话id IS NULL OR 前驱会话id <> id)
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
            创建时间 TIMESTAMPTZ NOT NULL
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
            事件类型 TEXT NOT NULL,
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

  await 执行(`
    CREATE TABLE IF NOT EXISTS ${名('_记忆提交上下文表')} (
      id INTEGER PRIMARY KEY,
      活动记忆提交id TEXT,
      回放中 BOOLEAN NOT NULL DEFAULT FALSE
    );
  `)

  await 执行(`ALTER TABLE ${名('_记忆提交上下文表')} ADD COLUMN IF NOT EXISTS 回放中 BOOLEAN NOT NULL DEFAULT FALSE;`)

  await 执行(`
    INSERT INTO ${名('_记忆提交上下文表')} (id, 活动记忆提交id) VALUES (1, NULL) ON CONFLICT (id) DO NOTHING;
  `)
  await 执行(`UPDATE ${名('_记忆提交上下文表')} SET 活动记忆提交id = NULL, 回放中 = FALSE WHERE id = 1;`)

  await 执行(`CREATE INDEX IF NOT EXISTS 当前记忆表_等级_创建序号_idx ON ${名('当前记忆表')} (等级, 创建序号);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 当前记忆表_创建时间_idx ON ${名('当前记忆表')} (创建时间);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 当前记忆表_关键词_idx ON ${名('当前记忆表')} USING GIN (关键词);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 当前记忆表_标签_idx ON ${名('当前记忆表')} USING GIN (标签);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 当前记忆关联表_终点_idx ON ${名('当前记忆关联表')} (终点id);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 记忆提交变更表_记忆提交_idx ON ${名('记忆提交变更表')} (记忆提交id);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 记忆提交表_创建时间_idx ON ${名('记忆提交表')} (创建时间 DESC);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 记忆提交表_父记忆提交_idx ON ${名('记忆提交表')} (父记忆提交id);`)
  await 执行(
    `CREATE UNIQUE INDEX IF NOT EXISTS 记忆提交表_唯一根_idx ON ${名('记忆提交表')} ((1)) WHERE 父记忆提交id IS NULL;`,
  )
  await 执行(`CREATE INDEX IF NOT EXISTS 日志表_事件组_idx ON ${名('日志表')} (事件组id, 序号);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 日志表_开始时间_idx ON ${名('日志表')} (开始时间 DESC);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 会话表_更新时间_idx ON ${名('会话表')} (更新时间 DESC, id);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 会话表_前驱会话_idx ON ${名('会话表')} (前驱会话id);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 消息表_会话序号_idx ON ${名('消息表')} (会话id, 序号);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 消息表_父消息_idx ON ${名('消息表')} (父消息id);`)
  await 执行(`CREATE UNIQUE INDEX IF NOT EXISTS 消息表_会话_id_unique ON ${名('消息表')} (会话id, id);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 日志表_上下文头消息_idx ON ${名('日志表')} (上下文头消息id);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 日志表_关联消息_idx ON ${名('日志表')} (关联消息id);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 日志表_模型请求_idx ON ${名('日志表')} (模型请求id, 序号);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 日志表_当时记忆提交_idx ON ${名('日志表')} (当时记忆提交id);`)
  await 执行(`CREATE INDEX IF NOT EXISTS 日志表_前缀快照_idx ON ${名('日志表')} (前缀快照id);`)

  await 初始化不可变约束(数据库查询器, schema)

  await 初始化永久实体登记触发器(数据库查询器, schema)

  // 所有业务写入必须先创建提交并把它设为 HEAD。BEFORE 触发器负责在改动发生前快速失败，
  // AFTER 触发器只负责把已经通过校验的行级 Diff 记入当前提交。
  await 执行(`
    CREATE OR REPLACE FUNCTION ${名('校验记忆写入上下文_触发器')}()
    RETURNS TRIGGER AS $$
    DECLARE
      v_活动记忆提交id TEXT;
      v_restoring BOOLEAN := FALSE;
      v_head_id TEXT;
      v_commit_message TEXT;
    BEGIN
      SELECT 活动记忆提交id, 回放中 INTO v_活动记忆提交id, v_restoring
      FROM ${名('_记忆提交上下文表')} WHERE id = 1;

      IF v_restoring THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END IF;

      IF v_活动记忆提交id IS NULL OR v_活动记忆提交id = '' THEN
        RAISE EXCEPTION '%只能在活动提交中修改', TG_TABLE_NAME;
      END IF;

      SELECT 提交说明 INTO v_commit_message FROM ${名('记忆提交表')} WHERE id = v_活动记忆提交id;
      IF v_commit_message IS NULL OR length(btrim(v_commit_message)) = 0 THEN
        RAISE EXCEPTION '活动记忆提交不存在或提交说明为空: %', v_活动记忆提交id;
      END IF;

      SELECT 当前记忆提交id INTO v_head_id FROM ${名('记忆指针表')} WHERE id = 1;
      IF v_head_id IS DISTINCT FROM v_活动记忆提交id THEN
        RAISE EXCEPTION '活动记忆提交必须是当前 HEAD: 活动提交 %, HEAD %', v_活动记忆提交id, v_head_id;
      END IF;

      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)
  for (let 表名 of ['当前记忆表', '当前记忆关联表', '当前动态工具表']) {
    await 执行(`DROP TRIGGER IF EXISTS trg_校验记忆写入上下文 ON ${名(表名)};`)
    await 执行(`
      CREATE TRIGGER trg_校验记忆写入上下文
      BEFORE INSERT OR UPDATE OR DELETE ON ${名(表名)}
      FOR EACH ROW EXECUTE FUNCTION ${名('校验记忆写入上下文_触发器')}();
    `)
  }

  let columnsCheck = await sql`
    SELECT column_name FROM information_schema.columns WHERE table_schema = ${schema} AND table_name = '当前记忆表'
  `.execute(数据库查询器)
  let hasX = columnsCheck.rows.some(
    (记录: unknown): boolean =>
      typeof 记录 === 'object' && 记录 !== null && 'column_name' in 记录 && 记录.column_name === 'x',
  )
  if (!hasX) {
    await 执行(`ALTER TABLE ${名('当前记忆表')} ADD COLUMN x DOUBLE PRECISION NOT NULL DEFAULT 0;`)
    await 执行(`ALTER TABLE ${名('当前记忆表')} ADD COLUMN y DOUBLE PRECISION NOT NULL DEFAULT 0;`)
  }

  // 提升向量检索性能，添加针对余弦距离 (<=>) 的 hnsw 索引
  // 注意：在 pgvector 中创建 hnsw 索引要求 vector 字段具有明确的维度（例如 vector(1536)）。
  // 由于我们的系统支持多种不同的模型（不同维度），因此不能在未指定维度的情况下创建 hnsw 索引。
  // await sql`CREATE INDEX IF NOT EXISTS 当前记忆表_向量_idx ON 当前记忆表 USING hnsw (向量 vector_cosine_ops);`.execute(
  //   数据库查询器,
  // )
  // await sql`CREATE INDEX IF NOT EXISTS 当前动态工具表_向量_idx ON 当前动态工具表 USING hnsw (向量 vector_cosine_ops);`.execute(
  //   数据库查询器,
  // )

  // ==================== 创建用于自动生成提交 Diff 的触发器 ====================
  // 1. 当前记忆表触发器函数
  await 执行(`
    CREATE OR REPLACE FUNCTION ${名('记录当前记忆表变更_触发器')}()
    RETURNS TRIGGER AS $$
    DECLARE
      v_活动记忆提交id TEXT;
      v_restoring BOOLEAN := FALSE;
      v_op_type TEXT;
      v_memory_id TEXT;
      v_old_val JSONB := NULL;
      v_new_val JSONB := NULL;
    BEGIN
      BEGIN
        SELECT 活动记忆提交id, 回放中 INTO v_活动记忆提交id, v_restoring FROM ${名('_记忆提交上下文表')} WHERE id = 1;
      EXCEPTION WHEN OTHERS THEN
        v_活动记忆提交id := NULL;
      END;
      
      IF v_restoring THEN
        RETURN NULL;
      ELSIF v_活动记忆提交id IS NULL OR v_活动记忆提交id = '' THEN
        RAISE EXCEPTION '当前记忆表只能在活动提交中修改';
      END IF;

      IF TG_OP = 'INSERT' THEN
        v_op_type := 'add';
        v_memory_id := NEW.id;
        v_new_val := to_jsonb(NEW);
      ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.等级 IS NOT DISTINCT FROM NEW.等级
          AND OLD.评分 IS NOT DISTINCT FROM NEW.评分
          AND OLD.内容 IS NOT DISTINCT FROM NEW.内容
          AND OLD.关键词 IS NOT DISTINCT FROM NEW.关键词
          AND OLD.标签 IS NOT DISTINCT FROM NEW.标签
          AND OLD.向量 IS NOT DISTINCT FROM NEW.向量
          AND OLD.向量维度 IS NOT DISTINCT FROM NEW.向量维度
          AND OLD.创建时间 IS NOT DISTINCT FROM NEW.创建时间
          AND OLD.创建序号 IS NOT DISTINCT FROM NEW.创建序号
          AND OLD.最后访问序号 IS NOT DISTINCT FROM NEW.最后访问序号
          AND OLD.访问次数 IS NOT DISTINCT FROM NEW.访问次数
          AND OLD.x IS NOT DISTINCT FROM NEW.x
          AND OLD.y IS NOT DISTINCT FROM NEW.y THEN
          RETURN NULL;
        END IF;
        v_op_type := 'update';
        v_memory_id := NEW.id;
        v_old_val := to_jsonb(OLD);
        v_new_val := to_jsonb(NEW);
      ELSIF TG_OP = 'DELETE' THEN
        v_op_type := 'remove';
        v_memory_id := OLD.id;
        v_old_val := to_jsonb(OLD);
      END IF;

      INSERT INTO ${名('记忆提交变更表')} (id, 记忆提交id, 变更类型, 目标实体类型, 记忆实体id, 变更前数据, 变更后数据)
      VALUES (gen_random_uuid()::TEXT, v_活动记忆提交id, v_op_type, 'memory', v_memory_id, v_old_val, v_new_val);

      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `)

  await 执行(`DROP TRIGGER IF EXISTS trg_记录当前记忆表变更 ON ${名('当前记忆表')};`)
  await 执行(`
    CREATE TRIGGER trg_记录当前记忆表变更
    AFTER INSERT OR UPDATE OR DELETE ON ${名('当前记忆表')}
    FOR EACH ROW EXECUTE FUNCTION ${名('记录当前记忆表变更_触发器')}();
  `)

  // 2. 当前记忆关联表触发器函数
  await 执行(`
    CREATE OR REPLACE FUNCTION ${名('记录当前记忆关联表变更_触发器')}()
    RETURNS TRIGGER AS $$
    DECLARE
      v_活动记忆提交id TEXT;
      v_restoring BOOLEAN := FALSE;
      v_op_type TEXT;
      v_source_id TEXT;
      v_end_id TEXT;
      v_old_val JSONB := NULL;
      v_new_val JSONB := NULL;
    BEGIN
      BEGIN
        SELECT 活动记忆提交id, 回放中 INTO v_活动记忆提交id, v_restoring FROM ${名('_记忆提交上下文表')} WHERE id = 1;
      EXCEPTION WHEN OTHERS THEN
        v_活动记忆提交id := NULL;
      END;

      IF v_restoring THEN
        RETURN NULL;
      ELSIF v_活动记忆提交id IS NULL OR v_活动记忆提交id = '' THEN
        RAISE EXCEPTION '当前记忆关联表只能在活动提交中修改';
      END IF;

      IF TG_OP = 'INSERT' THEN
        v_op_type := 'add';
        v_source_id := NEW.起点id;
        v_end_id := NEW.终点id;
        v_new_val := to_jsonb(NEW);
      ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.关联度 IS NOT DISTINCT FROM NEW.关联度 THEN
          RETURN NULL;
        END IF;
        v_op_type := 'update';
        v_source_id := NEW.起点id;
        v_end_id := NEW.终点id;
        v_old_val := to_jsonb(OLD);
        v_new_val := to_jsonb(NEW);
      ELSIF TG_OP = 'DELETE' THEN
        v_op_type := 'remove';
        v_source_id := OLD.起点id;
        v_end_id := OLD.终点id;
        v_old_val := to_jsonb(OLD);
      END IF;

      INSERT INTO ${名('记忆提交变更表')} (id, 记忆提交id, 变更类型, 目标实体类型, 起点记忆实体id, 终点记忆实体id, 变更前数据, 变更后数据)
      VALUES (gen_random_uuid()::TEXT, v_活动记忆提交id, v_op_type, 'memory_relation', v_source_id, v_end_id, v_old_val, v_new_val);

      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `)

  await 执行(`DROP TRIGGER IF EXISTS trg_记录当前记忆关联表变更 ON ${名('当前记忆关联表')};`)
  await 执行(`
    CREATE TRIGGER trg_记录当前记忆关联表变更
    AFTER INSERT OR UPDATE OR DELETE ON ${名('当前记忆关联表')}
    FOR EACH ROW EXECUTE FUNCTION ${名('记录当前记忆关联表变更_触发器')}();
  `)

  // 3. 当前动态工具表触发器函数。动态工具会参与模型上下文，也必须跟随提交历史回退。
  await 执行(`
    CREATE OR REPLACE FUNCTION ${名('记录当前动态工具表变更_触发器')}()
    RETURNS TRIGGER AS $$
    DECLARE
      v_活动记忆提交id TEXT;
      v_restoring BOOLEAN := FALSE;
      v_op_type TEXT;
      v_tool_id TEXT;
      v_old_val JSONB := NULL;
      v_new_val JSONB := NULL;
    BEGIN
      BEGIN
        SELECT 活动记忆提交id, 回放中 INTO v_活动记忆提交id, v_restoring FROM ${名('_记忆提交上下文表')} WHERE id = 1;
      EXCEPTION WHEN OTHERS THEN
        v_活动记忆提交id := NULL;
      END;

      IF v_restoring THEN
        RETURN NULL;
      ELSIF v_活动记忆提交id IS NULL OR v_活动记忆提交id = '' THEN
        RAISE EXCEPTION '当前动态工具表只能在活动提交中修改';
      END IF;

      IF TG_OP = 'INSERT' THEN
        v_op_type := 'add';
        v_tool_id := NEW.id;
        v_new_val := to_jsonb(NEW);
      ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.名称 IS NOT DISTINCT FROM NEW.名称
          AND OLD.描述 IS NOT DISTINCT FROM NEW.描述
          AND OLD.代码 IS NOT DISTINCT FROM NEW.代码
          AND OLD.向量 IS NOT DISTINCT FROM NEW.向量
          AND OLD.向量维度 IS NOT DISTINCT FROM NEW.向量维度
          AND OLD.创建时间 IS NOT DISTINCT FROM NEW.创建时间 THEN
          RETURN NULL;
        END IF;
        v_op_type := 'update';
        v_tool_id := NEW.id;
        v_old_val := to_jsonb(OLD);
        v_new_val := to_jsonb(NEW);
      ELSIF TG_OP = 'DELETE' THEN
        v_op_type := 'remove';
        v_tool_id := OLD.id;
        v_old_val := to_jsonb(OLD);
      END IF;

      INSERT INTO ${名('记忆提交变更表')} (id, 记忆提交id, 变更类型, 目标实体类型, 动态工具实体id, 变更前数据, 变更后数据)
      VALUES (gen_random_uuid()::TEXT, v_活动记忆提交id, v_op_type, 'dynamic_tool', v_tool_id, v_old_val, v_new_val);

      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `)

  await 执行(`DROP TRIGGER IF EXISTS trg_记录当前动态工具表变更 ON ${名('当前动态工具表')};`)
  await 执行(`
    CREATE TRIGGER trg_记录当前动态工具表变更
    AFTER INSERT OR UPDATE OR DELETE ON ${名('当前动态工具表')}
    FOR EACH ROW EXECUTE FUNCTION ${名('记录当前动态工具表变更_触发器')}();
  `)
}
