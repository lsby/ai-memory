import { Kysely, sql } from 'kysely'
import { 记忆数据库 } from '../agent-memory-types'

export async function 初始化数据库(数据库查询器: Kysely<记忆数据库>): Promise<void> {
  let enumCheck = await sql`
          SELECT 1 FROM pg_type WHERE typname = '记忆等级枚举'
        `.execute(数据库查询器)
  if (enumCheck.rows.length === 0) {
    await sql`CREATE TYPE 记忆等级枚举 AS ENUM ('零级', '一级', '二级');`.execute(数据库查询器)
  }

  await sql`CREATE EXTENSION IF NOT EXISTS vector;`.execute(数据库查询器)

  await sql`
          CREATE TABLE IF NOT EXISTS 记忆表 (
            id TEXT PRIMARY KEY,
            等级 记忆等级枚举 NOT NULL,
            评分 DOUBLE PRECISION NOT NULL,
            内容 TEXT NOT NULL,
            关键词 TEXT[] NOT NULL,
            标签 TEXT[] NOT NULL DEFAULT '{}',
            向量 vector,
            向量维度 INTEGER,
            创建时间 TIMESTAMPTZ NOT NULL,
            创建序号 SERIAL,
            最后访问序号 INTEGER NOT NULL DEFAULT 0,
            访问次数 INTEGER NOT NULL DEFAULT 0,
            x DOUBLE PRECISION NOT NULL DEFAULT 0,
            y DOUBLE PRECISION NOT NULL DEFAULT 0
          )
        `.execute(数据库查询器)

  await sql`
          CREATE TABLE IF NOT EXISTS 记忆关联表 (
            起点id TEXT NOT NULL REFERENCES 记忆表(id) ON DELETE CASCADE,
            终点id TEXT NOT NULL REFERENCES 记忆表(id) ON DELETE CASCADE,
            关联度 DOUBLE PRECISION NOT NULL,
            PRIMARY KEY (起点id, 终点id)
          )
        `.execute(数据库查询器)

  await sql`
          CREATE TABLE IF NOT EXISTS 记忆提交表 (
            id TEXT PRIMARY KEY,
            父提交id TEXT,
            消息 TEXT NOT NULL,
            创建时间 TIMESTAMPTZ NOT NULL
          )
        `.execute(数据库查询器)

  await sql`
          CREATE TABLE IF NOT EXISTS 记忆变更表 (
            id TEXT PRIMARY KEY,
            提交id TEXT NOT NULL REFERENCES 记忆提交表(id) ON DELETE CASCADE,
            操作类型 TEXT NOT NULL,
            目标表 TEXT NOT NULL,
            目标id TEXT NOT NULL,
            旧值 TEXT,
            新值 TEXT
          )
        `.execute(数据库查询器)

  await sql`
          CREATE TABLE IF NOT EXISTS 记忆元数据表 (
            键 TEXT PRIMARY KEY,
            值 TEXT NOT NULL
          )
        `.execute(数据库查询器)

  await sql`
          CREATE TABLE IF NOT EXISTS 动态工具表 (
            id TEXT PRIMARY KEY,
            名称 TEXT NOT NULL UNIQUE,
            描述 TEXT NOT NULL,
            代码 TEXT NOT NULL,
            向量 vector,
            向量维度 INTEGER,
            创建时间 TIMESTAMPTZ NOT NULL
          )
        `.execute(数据库查询器)

  await sql`
    CREATE TABLE IF NOT EXISTS _agent_session_commit (
      id INTEGER PRIMARY KEY,
      commit_id TEXT
    );
  `.execute(数据库查询器)

  await sql`
    INSERT INTO _agent_session_commit (id, commit_id) VALUES (1, NULL) ON CONFLICT (id) DO NOTHING;
  `.execute(数据库查询器)

  let columnsCheck = await sql`
    SELECT column_name FROM information_schema.columns WHERE table_name = '记忆表'
  `.execute(数据库查询器)
  let hasX = columnsCheck.rows.some(
    (记录: unknown): boolean =>
      typeof 记录 === 'object' && 记录 !== null && 'column_name' in 记录 && 记录.column_name === 'x',
  )
  if (!hasX) {
    await sql`ALTER TABLE 记忆表 ADD COLUMN x DOUBLE PRECISION NOT NULL DEFAULT 0;`.execute(数据库查询器)
    await sql`ALTER TABLE 记忆表 ADD COLUMN y DOUBLE PRECISION NOT NULL DEFAULT 0;`.execute(数据库查询器)
  }

  // 提升向量检索性能，添加针对余弦距离 (<=>) 的 hnsw 索引
  // 注意：在 pgvector 中创建 hnsw 索引要求 vector 字段具有明确的维度（例如 vector(1536)）。
  // 由于我们的系统支持多种不同的模型（不同维度），因此不能在未指定维度的情况下创建 hnsw 索引。
  // await sql`CREATE INDEX IF NOT EXISTS 记忆表_向量_idx ON 记忆表 USING hnsw (向量 vector_cosine_ops);`.execute(
  //   数据库查询器,
  // )
  // await sql`CREATE INDEX IF NOT EXISTS 动态工具表_向量_idx ON 动态工具表 USING hnsw (向量 vector_cosine_ops);`.execute(
  //   数据库查询器,
  // )

  // ==================== 创建用于自动生成提交 Diff 的触发器 ====================
  // 1. 记忆表触发器函数
  await sql`
    CREATE OR REPLACE FUNCTION 记录记忆表变更_触发器()
    RETURNS TRIGGER AS $$
    DECLARE
      v_commit_id TEXT;
      v_op_type TEXT;
      v_target_id TEXT;
      v_old_val TEXT := NULL;
      v_new_val TEXT := NULL;
    BEGIN
      BEGIN
        SELECT commit_id INTO v_commit_id FROM _agent_session_commit WHERE id = 1;
      EXCEPTION WHEN OTHERS THEN
        v_commit_id := NULL;
      END;
      
      IF v_commit_id IS NULL OR v_commit_id = '' THEN
        RETURN NULL;
      END IF;

      IF TG_OP = 'INSERT' THEN
        v_op_type := 'add';
        v_target_id := NEW.id;
        v_new_val := row_to_json(NEW)::TEXT;
      ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.等级 = NEW.等级 AND OLD.评分 = NEW.评分 AND OLD.内容 = NEW.内容 AND OLD.关键词 = NEW.关键词 AND OLD.标签 = NEW.标签 AND OLD.向量 = NEW.向量 THEN
          RETURN NULL;
        END IF;
        v_op_type := 'update';
        v_target_id := NEW.id;
        v_old_val := row_to_json(OLD)::TEXT;
        v_new_val := row_to_json(NEW)::TEXT;
      ELSIF TG_OP = 'DELETE' THEN
        v_op_type := 'delete';
        v_target_id := OLD.id;
        v_old_val := row_to_json(OLD)::TEXT;
      END IF;

      INSERT INTO 记忆变更表 (id, 提交id, 操作类型, 目标表, 目标id, 旧值, 新值)
      VALUES (gen_random_uuid()::TEXT, v_commit_id, v_op_type, 'node', v_target_id, v_old_val, v_new_val);

      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `.execute(数据库查询器)

  await sql`DROP TRIGGER IF EXISTS trg_记录记忆表变更 ON 记忆表;`.execute(数据库查询器)
  await sql`
    CREATE TRIGGER trg_记录记忆表变更
    AFTER INSERT OR UPDATE OR DELETE ON 记忆表
    FOR EACH ROW EXECUTE FUNCTION 记录记忆表变更_触发器();
  `.execute(数据库查询器)

  // 2. 记忆关联表触发器函数
  await sql`
    CREATE OR REPLACE FUNCTION 记录记忆关联表变更_触发器()
    RETURNS TRIGGER AS $$
    DECLARE
      v_commit_id TEXT;
      v_op_type TEXT;
      v_target_id TEXT;
      v_old_val TEXT := NULL;
      v_new_val TEXT := NULL;
    BEGIN
      BEGIN
        SELECT commit_id INTO v_commit_id FROM _agent_session_commit WHERE id = 1;
      EXCEPTION WHEN OTHERS THEN
        v_commit_id := NULL;
      END;

      IF v_commit_id IS NULL OR v_commit_id = '' THEN
        RETURN NULL;
      END IF;

      IF TG_OP = 'INSERT' THEN
        v_op_type := 'add';
        v_target_id := NEW.起点id || '_' || NEW.终点id;
        v_new_val := row_to_json(NEW)::TEXT;
      ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.关联度 = NEW.关联度 THEN
          RETURN NULL;
        END IF;
        v_op_type := 'update';
        v_target_id := NEW.起点id || '_' || NEW.终点id;
        v_old_val := row_to_json(OLD)::TEXT;
        v_new_val := row_to_json(NEW)::TEXT;
      ELSIF TG_OP = 'DELETE' THEN
        v_op_type := 'delete';
        v_target_id := OLD.起点id || '_' || OLD.终点id;
        v_old_val := row_to_json(OLD)::TEXT;
      END IF;

      INSERT INTO 记忆变更表 (id, 提交id, 操作类型, 目标表, 目标id, 旧值, 新值)
      VALUES (gen_random_uuid()::TEXT, v_commit_id, v_op_type, 'link', v_target_id, v_old_val, v_new_val);

      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `.execute(数据库查询器)

  await sql`DROP TRIGGER IF EXISTS trg_记录记忆关联表变更 ON 记忆关联表;`.execute(数据库查询器)
  await sql`
    CREATE TRIGGER trg_记录记忆关联表变更
    AFTER INSERT OR UPDATE OR DELETE ON 记忆关联表
    FOR EACH ROW EXECUTE FUNCTION 记录记忆关联表变更_触发器();
  `.execute(数据库查询器)
}
