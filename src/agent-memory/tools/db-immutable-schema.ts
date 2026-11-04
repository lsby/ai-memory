import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { 转义标识符 } from '../storage/connection'
import type { 记忆数据库 } from '../types'

/** 保护永久历史，并为当前状态投影建立完整的数据库约束。 */
export async function 初始化不可变约束(数据库查询器: Kysely<记忆数据库>, schema: string): Promise<void> {
  let 名 = (对象名: string): string => `${转义标识符(schema)}.${转义标识符(对象名)}`
  let 执行 = async (语句: string): Promise<void> => {
    await sql.raw(语句).execute(数据库查询器)
  }
  await 执行(`ALTER TABLE ${名('当前记忆线索关联表')} DROP CONSTRAINT IF EXISTS 当前记忆线索关联表_记忆id_fkey;`)
  await 执行(`ALTER TABLE ${名('当前记忆线索关联表')} DROP CONSTRAINT IF EXISTS 当前记忆线索关联表_线索id_fkey;`)
  await 执行(
    `ALTER TABLE ${名('当前记忆线索关联表')} ADD CONSTRAINT 当前记忆线索关联表_记忆id_fkey FOREIGN KEY (记忆id) REFERENCES ${名('当前记忆表')}(id) ON DELETE RESTRICT;`,
  )
  await 执行(
    `ALTER TABLE ${名('当前记忆线索关联表')} ADD CONSTRAINT 当前记忆线索关联表_线索id_fkey FOREIGN KEY (线索id) REFERENCES ${名('当前线索表')}(id) ON DELETE RESTRICT;`,
  )
  await 执行(`ALTER TABLE ${名('记忆行变更表')} DROP CONSTRAINT IF EXISTS 记忆行变更表_记忆提交id_fkey;`)
  await 执行(
    `ALTER TABLE ${名('记忆行变更表')} ADD CONSTRAINT 记忆行变更表_记忆提交id_fkey FOREIGN KEY (记忆提交id) REFERENCES ${名('记忆提交表')}(id) ON DELETE RESTRICT;`,
  )
  await 执行(`ALTER TABLE ${名('记忆提交表')} DROP CONSTRAINT IF EXISTS 记忆提交表_父记忆提交id_fkey;`)
  await 执行(
    `ALTER TABLE ${名('记忆提交表')} ADD CONSTRAINT 记忆提交表_父记忆提交id_fkey FOREIGN KEY (父记忆提交id) REFERENCES ${名('记忆提交表')}(id) ON DELETE RESTRICT;`,
  )
  await 执行(`ALTER TABLE ${名('记忆提交表')} DROP CONSTRAINT IF EXISTS 记忆提交表_禁止自引用_check;`)
  await 执行(
    `ALTER TABLE ${名('记忆提交表')} ADD CONSTRAINT 记忆提交表_禁止自引用_check CHECK (父记忆提交id IS NULL OR 父记忆提交id <> id);`,
  )
  await 执行(`ALTER TABLE ${名('记忆提交表')} DROP CONSTRAINT IF EXISTS 记忆提交表_提交说明非空_check;`)
  await 执行(
    `ALTER TABLE ${名('记忆提交表')} ADD CONSTRAINT 记忆提交表_提交说明非空_check CHECK (length(btrim(提交说明)) > 0);`,
  )
  await 执行(`ALTER TABLE ${名('记忆提交表')} DROP CONSTRAINT IF EXISTS 记忆提交表_状态名称非空_check;`)
  await 执行(
    `ALTER TABLE ${名('记忆提交表')} ADD CONSTRAINT 记忆提交表_状态名称非空_check CHECK (状态名称 IS NULL OR length(btrim(状态名称)) > 0);`,
  )
  await 执行(`ALTER TABLE ${名('记忆行变更表')} DROP CONSTRAINT IF EXISTS 记忆行变更表_提交内序号_check;`)
  await 执行(`ALTER TABLE ${名('记忆行变更表')} ADD CONSTRAINT 记忆行变更表_提交内序号_check CHECK (提交内序号 > 0);`)
  await 执行(`ALTER TABLE ${名('记忆行变更表')} DROP CONSTRAINT IF EXISTS 记忆行变更表_数据形状_check;`)
  await 执行(`
    ALTER TABLE ${名('记忆行变更表')} ADD CONSTRAINT 记忆行变更表_数据形状_check CHECK (
      jsonb_typeof(主键) = 'object'
      AND ((操作类型 = 'delete' AND 行数据 IS NULL)
        OR (操作类型 IN ('insert', 'update') AND 行数据 IS NOT NULL AND jsonb_typeof(行数据) = 'object'))
    );
  `)
  await 执行(`ALTER TABLE ${名('记忆行变更表')} DROP CONSTRAINT IF EXISTS 记忆行变更表_主键形状_check;`)
  await 执行(`
    ALTER TABLE ${名('记忆行变更表')} ADD CONSTRAINT 记忆行变更表_主键形状_check CHECK (
      CASE 目标表
        WHEN 'memory' THEN 主键 ? 'id' AND 主键 - 'id' = '{}'::jsonb AND jsonb_typeof(主键->'id') = 'string'
        WHEN 'clue' THEN 主键 ? 'id' AND 主键 - 'id' = '{}'::jsonb AND jsonb_typeof(主键->'id') = 'string'
        WHEN 'dynamic_tool' THEN 主键 ? 'id' AND 主键 - 'id' = '{}'::jsonb AND jsonb_typeof(主键->'id') = 'string'
        WHEN 'memory_clue_relation' THEN 主键 ? '记忆id' AND 主键 ? '线索id'
          AND 主键 - '记忆id' - '线索id' = '{}'::jsonb
          AND jsonb_typeof(主键->'记忆id') = 'string' AND jsonb_typeof(主键->'线索id') = 'string'
        ELSE FALSE
      END
    );
  `)
  await 执行(`ALTER TABLE ${名('记忆行变更表')} DROP CONSTRAINT IF EXISTS 记忆行变更表_行数据一致_check;`)
  await 执行(`
    ALTER TABLE ${名('记忆行变更表')} ADD CONSTRAINT 记忆行变更表_行数据一致_check CHECK (
      行数据 IS NULL OR CASE 目标表
        WHEN 'memory' THEN
          行数据->>'id' = 主键->>'id'
        WHEN 'clue' THEN
          行数据->>'id' = 主键->>'id'
        WHEN 'memory_clue_relation' THEN
          行数据->>'记忆id' = 主键->>'记忆id' AND 行数据->>'线索id' = 主键->>'线索id'
        WHEN 'dynamic_tool' THEN
          行数据->>'id' = 主键->>'id'
        ELSE FALSE
      END
    );
  `)

  await 执行(`
    CREATE OR REPLACE FUNCTION ${名('校验记忆行变更写入_触发器')}()
    RETURNS TRIGGER AS $$
    DECLARE
      v_活动记忆提交id TEXT;
    BEGIN
      v_活动记忆提交id := NULLIF(current_setting('lsby_ai_memory.active_commit_id', TRUE), '');
      IF COALESCE(current_setting('lsby_ai_memory.replaying', TRUE), '') = 'true'
        OR v_活动记忆提交id IS NULL OR v_活动记忆提交id IS DISTINCT FROM NEW.记忆提交id THEN
        RAISE EXCEPTION '记忆行变更只能由当前活动提交生成';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)
  await 执行(`DROP TRIGGER IF EXISTS trg_校验记忆行变更写入 ON ${名('记忆行变更表')};`)
  await 执行(`
    CREATE TRIGGER trg_校验记忆行变更写入 BEFORE INSERT ON ${名('记忆行变更表')}
    FOR EACH ROW EXECUTE FUNCTION ${名('校验记忆行变更写入_触发器')}();
  `)
  await 执行(`
    CREATE OR REPLACE FUNCTION ${名('拒绝记忆行变更修改_触发器')}()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION '记忆行变更不可修改或删除';
    END;
    $$ LANGUAGE plpgsql;
  `)
  await 执行(`DROP TRIGGER IF EXISTS trg_拒绝记忆行变更修改 ON ${名('记忆行变更表')};`)
  await 执行(`
    CREATE TRIGGER trg_拒绝记忆行变更修改 BEFORE UPDATE OR DELETE ON ${名('记忆行变更表')}
    FOR EACH ROW EXECUTE FUNCTION ${名('拒绝记忆行变更修改_触发器')}();
  `)
  await 执行(`
    CREATE OR REPLACE FUNCTION ${名('限制记忆提交修改_触发器')}()
    RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        IF OLD.状态名称 IS NULL AND NEW.状态名称 IS NOT NULL
          AND OLD.id IS NOT DISTINCT FROM NEW.id
          AND OLD.父记忆提交id IS NOT DISTINCT FROM NEW.父记忆提交id
          AND OLD.提交说明 IS NOT DISTINCT FROM NEW.提交说明
          AND OLD.创建时间 IS NOT DISTINCT FROM NEW.创建时间 THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION '记忆提交只允许命名一次';
      END IF;
      IF EXISTS (SELECT 1 FROM ${名('记忆行变更表')} WHERE 记忆提交id = OLD.id)
        OR EXISTS (SELECT 1 FROM ${名('记忆提交表')} WHERE 父记忆提交id = OLD.id) THEN
        RAISE EXCEPTION '已完成或被引用的记忆提交不可删除';
      END IF;
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;
  `)
  await 执行(`DROP TRIGGER IF EXISTS trg_限制记忆提交修改 ON ${名('记忆提交表')};`)
  await 执行(`
    CREATE TRIGGER trg_限制记忆提交修改 BEFORE UPDATE OR DELETE ON ${名('记忆提交表')}
    FOR EACH ROW EXECUTE FUNCTION ${名('限制记忆提交修改_触发器')}();
  `)

  await 执行(`
    CREATE OR REPLACE FUNCTION ${名('拒绝消息修改_触发器')}()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION '消息不可修改或删除，请新建分支';
    END;
    $$ LANGUAGE plpgsql;
  `)
  await 执行(`DROP TRIGGER IF EXISTS trg_校验消息归属 ON ${名('消息表')};`)
  await 执行(`DROP FUNCTION IF EXISTS ${名('校验消息归属_触发器')}();`)
  await 执行(`DROP TRIGGER IF EXISTS trg_拒绝消息修改 ON ${名('消息表')};`)
  await 执行(`
    CREATE TRIGGER trg_拒绝消息修改 BEFORE UPDATE OR DELETE ON ${名('消息表')}
    FOR EACH ROW EXECUTE FUNCTION ${名('拒绝消息修改_触发器')}();
  `)

  await 执行(`ALTER TABLE ${名('消息表')} DROP CONSTRAINT IF EXISTS 消息表_父消息id_fkey;`)
  await 执行(`ALTER TABLE ${名('消息表')} DROP CONSTRAINT IF EXISTS 消息表_父消息归属_fkey;`)
  await 执行(
    `ALTER TABLE ${名('消息表')} ADD CONSTRAINT 消息表_父消息归属_fkey FOREIGN KEY (会话id, 父消息id) REFERENCES ${名('消息表')}(会话id, id) ON DELETE RESTRICT;`,
  )
  await 执行(`ALTER TABLE ${名('会话表')} DROP CONSTRAINT IF EXISTS 会话表_当前消息id_fkey;`)
  await 执行(`ALTER TABLE ${名('会话表')} DROP CONSTRAINT IF EXISTS 会话表_当前消息归属_fkey;`)
  await 执行(
    `ALTER TABLE ${名('会话表')} ADD CONSTRAINT 会话表_当前消息归属_fkey FOREIGN KEY (id, 当前消息id) REFERENCES ${名('消息表')}(会话id, id) ON DELETE RESTRICT;`,
  )
  await 执行(`ALTER TABLE ${名('会话表')} DROP CONSTRAINT IF EXISTS 会话表_前驱消息id_fkey;`)
  await 执行(`ALTER TABLE ${名('会话表')} DROP CONSTRAINT IF EXISTS 会话表_前驱消息归属_fkey;`)
  await 执行(
    `ALTER TABLE ${名('会话表')} ADD CONSTRAINT 会话表_前驱消息id_fkey FOREIGN KEY (前驱消息id) REFERENCES ${名('消息表')}(id) ON DELETE RESTRICT;`,
  )

  await 执行(`
    CREATE OR REPLACE FUNCTION ${名('限制会话修改_触发器')}()
    RETURNS TRIGGER AS $$
    BEGIN
      IF current_setting('lsby_ai_memory.导入中', true) = 'true' THEN
        RETURN NEW;
      END IF;
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION '会话不可删除';
      END IF;
      IF OLD.id IS DISTINCT FROM NEW.id
        OR OLD.前驱消息id IS DISTINCT FROM NEW.前驱消息id
        OR OLD.创建时间 IS DISTINCT FROM NEW.创建时间 THEN
        RAISE EXCEPTION '会话身份、前驱消息和创建时间不可修改';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)
  await 执行(`DROP TRIGGER IF EXISTS trg_校验会话前驱 ON ${名('会话表')};`)
  await 执行(`DROP FUNCTION IF EXISTS ${名('校验会话前驱_触发器')}();`)
  await 执行(`DROP TRIGGER IF EXISTS trg_限制会话修改 ON ${名('会话表')};`)
  await 执行(`
    CREATE TRIGGER trg_限制会话修改 BEFORE UPDATE OR DELETE ON ${名('会话表')}
    FOR EACH ROW EXECUTE FUNCTION ${名('限制会话修改_触发器')}();
  `)

  await 执行(`
    CREATE OR REPLACE FUNCTION ${名('拒绝交互日志修改_触发器')}()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION '交互日志不可修改或删除';
    END;
    $$ LANGUAGE plpgsql;
  `)
  await 执行(`DROP TRIGGER IF EXISTS trg_拒绝交互日志修改 ON ${名('日志表')};`)
  await 执行(`
    CREATE TRIGGER trg_拒绝交互日志修改 BEFORE UPDATE OR DELETE ON ${名('日志表')}
    FOR EACH ROW EXECUTE FUNCTION ${名('拒绝交互日志修改_触发器')}();
  `)
  await 执行(`
    CREATE OR REPLACE FUNCTION ${名('拒绝前缀快照修改_触发器')}()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION '前缀快照不可修改或删除';
    END;
    $$ LANGUAGE plpgsql;
  `)
  await 执行(`DROP TRIGGER IF EXISTS trg_拒绝前缀快照修改 ON ${名('前缀快照表')};`)
  await 执行(`
    CREATE TRIGGER trg_拒绝前缀快照修改 BEFORE UPDATE OR DELETE ON ${名('前缀快照表')}
    FOR EACH ROW EXECUTE FUNCTION ${名('拒绝前缀快照修改_触发器')}();
  `)
}
