-- 0.2.3 版本在 public schema 里建出来的旧布局（语句原样摘自 0.2.3 的 初始化数据库，对象名都不带 schema 前缀）。
-- 用来验证 0.3.0 能直接打开旧的文件模式数据目录。


CREATE TYPE 记忆等级枚举 AS ENUM ('零级', '一级', '二级');

CREATE EXTENSION IF NOT EXISTS vector;

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
          );

CREATE TABLE IF NOT EXISTS 记忆关联表 (
            起点id TEXT NOT NULL REFERENCES 记忆表(id) ON DELETE CASCADE,
            终点id TEXT NOT NULL REFERENCES 记忆表(id) ON DELETE CASCADE,
            关联度 DOUBLE PRECISION NOT NULL,
            PRIMARY KEY (起点id, 终点id)
          );

CREATE TABLE IF NOT EXISTS 记忆提交表 (
            id TEXT PRIMARY KEY,
            父提交id TEXT,
            消息 TEXT NOT NULL,
            创建时间 TIMESTAMPTZ NOT NULL
          );

CREATE TABLE IF NOT EXISTS 记忆变更表 (
            id TEXT PRIMARY KEY,
            序号 BIGSERIAL,
            提交id TEXT NOT NULL REFERENCES 记忆提交表(id) ON DELETE CASCADE,
            操作类型 TEXT NOT NULL,
            目标表 TEXT NOT NULL,
            目标id TEXT NOT NULL,
            旧值 TEXT,
            新值 TEXT
          );

ALTER TABLE 记忆变更表 ADD COLUMN IF NOT EXISTS 序号 BIGSERIAL;

CREATE TABLE IF NOT EXISTS 记忆元数据表 (
            键 TEXT PRIMARY KEY,
            值 TEXT NOT NULL
          );

CREATE TABLE IF NOT EXISTS 动态工具表 (
            id TEXT PRIMARY KEY,
            名称 TEXT NOT NULL UNIQUE,
            描述 TEXT NOT NULL,
            代码 TEXT NOT NULL,
            向量 vector,
            向量维度 INTEGER,
            创建时间 TIMESTAMPTZ NOT NULL
          );

CREATE TABLE IF NOT EXISTS _agent_session_commit (
      id INTEGER PRIMARY KEY,
      commit_id TEXT
    );

INSERT INTO _agent_session_commit (id, commit_id) VALUES (1, NULL) ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS 记忆表_等级_创建序号_idx ON 记忆表 (等级, 创建序号);

CREATE INDEX IF NOT EXISTS 记忆表_创建时间_idx ON 记忆表 (创建时间);

CREATE INDEX IF NOT EXISTS 记忆表_关键词_idx ON 记忆表 USING GIN (关键词);

CREATE INDEX IF NOT EXISTS 记忆表_标签_idx ON 记忆表 USING GIN (标签);

CREATE INDEX IF NOT EXISTS 记忆关联表_终点_idx ON 记忆关联表 (终点id);

CREATE INDEX IF NOT EXISTS 记忆变更表_提交_idx ON 记忆变更表 (提交id);

CREATE INDEX IF NOT EXISTS 记忆提交表_创建时间_idx ON 记忆提交表 (创建时间 DESC);

INSERT INTO 记忆元数据表 (键, 值) VALUES ('KERNEL_SCHEMA_VERSION', '2')
    ON CONFLICT (键) DO UPDATE SET 值 = EXCLUDED.值;

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
        IF OLD.等级 IS NOT DISTINCT FROM NEW.等级
          AND OLD.评分 IS NOT DISTINCT FROM NEW.评分
          AND OLD.内容 IS NOT DISTINCT FROM NEW.内容
          AND OLD.关键词 IS NOT DISTINCT FROM NEW.关键词
          AND OLD.标签 IS NOT DISTINCT FROM NEW.标签
          AND OLD.向量 IS NOT DISTINCT FROM NEW.向量 THEN
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

DROP TRIGGER IF EXISTS trg_记录记忆表变更 ON 记忆表;

CREATE TRIGGER trg_记录记忆表变更
    AFTER INSERT OR UPDATE OR DELETE ON 记忆表
    FOR EACH ROW EXECUTE FUNCTION 记录记忆表变更_触发器();

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
        IF OLD.关联度 IS NOT DISTINCT FROM NEW.关联度 THEN
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

DROP TRIGGER IF EXISTS trg_记录记忆关联表变更 ON 记忆关联表;

CREATE TRIGGER trg_记录记忆关联表变更
    AFTER INSERT OR UPDATE OR DELETE ON 记忆关联表
    FOR EACH ROW EXECUTE FUNCTION 记录记忆关联表变更_触发器();
