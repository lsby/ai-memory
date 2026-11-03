import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { 转义标识符 } from '../storage/connection'
import type { 记忆数据库 } from '../types'

/** 保护永久历史和实体身份，并为当前状态投影建立完整的数据库约束。 */
export async function 初始化不可变约束(数据库查询器: Kysely<记忆数据库>, schema: string): Promise<void> {
  let 名 = (对象名: string): string => `${转义标识符(schema)}.${转义标识符(对象名)}`
  let 执行 = async (语句: string): Promise<void> => {
    await sql.raw(语句).execute(数据库查询器)
  }
  await 执行(`ALTER TABLE ${名('当前记忆关联表')} DROP CONSTRAINT IF EXISTS 当前记忆关联表_起点id_fkey;`)
  await 执行(`ALTER TABLE ${名('当前记忆关联表')} DROP CONSTRAINT IF EXISTS 当前记忆关联表_终点id_fkey;`)
  await 执行(
    `ALTER TABLE ${名('当前记忆关联表')} ADD CONSTRAINT 当前记忆关联表_起点id_fkey FOREIGN KEY (起点id) REFERENCES ${名('当前记忆表')}(id) ON DELETE RESTRICT;`,
  )
  await 执行(
    `ALTER TABLE ${名('当前记忆关联表')} ADD CONSTRAINT 当前记忆关联表_终点id_fkey FOREIGN KEY (终点id) REFERENCES ${名('当前记忆表')}(id) ON DELETE RESTRICT;`,
  )
  await 执行(`ALTER TABLE ${名('记忆提交变更表')} DROP CONSTRAINT IF EXISTS 记忆提交变更表_记忆提交id_fkey;`)
  await 执行(
    `ALTER TABLE ${名('记忆提交变更表')} ADD CONSTRAINT 记忆提交变更表_记忆提交id_fkey FOREIGN KEY (记忆提交id) REFERENCES ${名('记忆提交表')}(id) ON DELETE RESTRICT;`,
  )
  await 执行(`ALTER TABLE ${名('记忆提交变更表')} DROP CONSTRAINT IF EXISTS 记忆提交变更表_记忆实体id_fkey;`)
  await 执行(
    `ALTER TABLE ${名('记忆提交变更表')} ADD CONSTRAINT 记忆提交变更表_记忆实体id_fkey FOREIGN KEY (记忆实体id) REFERENCES ${名('记忆实体表')}(id) ON DELETE RESTRICT;`,
  )
  await 执行(`ALTER TABLE ${名('记忆提交变更表')} DROP CONSTRAINT IF EXISTS 记忆提交变更表_动态工具实体id_fkey;`)
  await 执行(
    `ALTER TABLE ${名('记忆提交变更表')} ADD CONSTRAINT 记忆提交变更表_动态工具实体id_fkey FOREIGN KEY (动态工具实体id) REFERENCES ${名('动态工具实体表')}(id) ON DELETE RESTRICT;`,
  )
  await 执行(`ALTER TABLE ${名('记忆提交变更表')} DROP CONSTRAINT IF EXISTS 记忆提交变更表_关联实体_fkey;`)
  await 执行(
    `ALTER TABLE ${名('记忆提交变更表')} ADD CONSTRAINT 记忆提交变更表_关联实体_fkey FOREIGN KEY (起点记忆实体id, 终点记忆实体id) REFERENCES ${名('记忆关联实体表')}(起点id, 终点id) ON DELETE RESTRICT;`,
  )
  await 执行(`ALTER TABLE ${名('记忆提交表')} DROP CONSTRAINT IF EXISTS 记忆提交表_父记忆提交id_fkey;`)
  await 执行(
    `ALTER TABLE ${名('记忆提交表')} ADD CONSTRAINT 记忆提交表_父记忆提交id_fkey FOREIGN KEY (父记忆提交id) REFERENCES ${名('记忆提交表')}(id) ON DELETE RESTRICT;`,
  )
  await 执行(`ALTER TABLE ${名('_记忆提交上下文表')} DROP CONSTRAINT IF EXISTS _记忆提交上下文表_活动记忆提交id_fkey;`)
  await 执行(
    `ALTER TABLE ${名('_记忆提交上下文表')} ADD CONSTRAINT _记忆提交上下文表_活动记忆提交id_fkey FOREIGN KEY (活动记忆提交id) REFERENCES ${名('记忆提交表')}(id) ON DELETE RESTRICT;`,
  )
  await 执行(`ALTER TABLE ${名('记忆提交表')} DROP CONSTRAINT IF EXISTS 记忆提交表_禁止自引用_check;`)
  await 执行(
    `ALTER TABLE ${名('记忆提交表')} ADD CONSTRAINT 记忆提交表_禁止自引用_check CHECK (父记忆提交id IS NULL OR 父记忆提交id <> id);`,
  )
  await 执行(`ALTER TABLE ${名('记忆提交表')} DROP CONSTRAINT IF EXISTS 记忆提交表_提交说明非空_check;`)
  await 执行(
    `ALTER TABLE ${名('记忆提交表')} ADD CONSTRAINT 记忆提交表_提交说明非空_check CHECK (length(btrim(提交说明)) > 0);`,
  )
  await 执行(`ALTER TABLE ${名('记忆提交变更表')} DROP CONSTRAINT IF EXISTS 记忆提交变更表_变更类型_check;`)
  await 执行(
    `ALTER TABLE ${名('记忆提交变更表')} ADD CONSTRAINT 记忆提交变更表_变更类型_check CHECK (变更类型 IN ('add', 'update', 'remove'));`,
  )
  await 执行(`ALTER TABLE ${名('记忆提交变更表')} DROP CONSTRAINT IF EXISTS 记忆提交变更表_目标实体类型_check;`)
  await 执行(
    `ALTER TABLE ${名('记忆提交变更表')} ADD CONSTRAINT 记忆提交变更表_目标实体类型_check CHECK (目标实体类型 IN ('memory', 'memory_relation', 'dynamic_tool'));`,
  )
  await 执行(`ALTER TABLE ${名('记忆提交变更表')} DROP CONSTRAINT IF EXISTS 记忆提交变更表_目标形状_check;`)
  await 执行(`
    ALTER TABLE ${名('记忆提交变更表')} ADD CONSTRAINT 记忆提交变更表_目标形状_check CHECK (
      (目标实体类型 = 'memory' AND 记忆实体id IS NOT NULL AND 起点记忆实体id IS NULL AND 终点记忆实体id IS NULL AND 动态工具实体id IS NULL)
      OR (目标实体类型 = 'memory_relation' AND 记忆实体id IS NULL AND 起点记忆实体id IS NOT NULL AND 终点记忆实体id IS NOT NULL AND 动态工具实体id IS NULL)
      OR (目标实体类型 = 'dynamic_tool' AND 记忆实体id IS NULL AND 起点记忆实体id IS NULL AND 终点记忆实体id IS NULL AND 动态工具实体id IS NOT NULL)
    );
  `)
  await 执行(`ALTER TABLE ${名('记忆提交变更表')} DROP CONSTRAINT IF EXISTS 记忆提交变更表_数据形状_check;`)
  await 执行(`
    ALTER TABLE ${名('记忆提交变更表')} ADD CONSTRAINT 记忆提交变更表_数据形状_check CHECK (
      (变更类型 = 'add' AND 变更前数据 IS NULL AND 变更后数据 IS NOT NULL)
      OR (变更类型 = 'update' AND 变更前数据 IS NOT NULL AND 变更后数据 IS NOT NULL)
      OR (变更类型 = 'remove' AND 变更前数据 IS NOT NULL AND 变更后数据 IS NULL)
    );
  `)
  await 执行(`ALTER TABLE ${名('记忆提交变更表')} DROP CONSTRAINT IF EXISTS 记忆提交变更表_实体数据一致_check;`)
  await 执行(`
    ALTER TABLE ${名('记忆提交变更表')} ADD CONSTRAINT 记忆提交变更表_实体数据一致_check CHECK (
      (变更前数据 IS NULL OR jsonb_typeof(变更前数据) = 'object')
      AND (变更后数据 IS NULL OR jsonb_typeof(变更后数据) = 'object')
      AND CASE 目标实体类型
        WHEN 'memory' THEN
          (变更前数据 IS NULL OR 变更前数据->>'id' = 记忆实体id)
          AND (变更后数据 IS NULL OR 变更后数据->>'id' = 记忆实体id)
        WHEN 'memory_relation' THEN
          (变更前数据 IS NULL OR (变更前数据->>'起点id' = 起点记忆实体id AND 变更前数据->>'终点id' = 终点记忆实体id))
          AND (变更后数据 IS NULL OR (变更后数据->>'起点id' = 起点记忆实体id AND 变更后数据->>'终点id' = 终点记忆实体id))
        WHEN 'dynamic_tool' THEN
          (变更前数据 IS NULL OR 变更前数据->>'id' = 动态工具实体id)
          AND (变更后数据 IS NULL OR 变更后数据->>'id' = 动态工具实体id)
        ELSE FALSE
      END
    );
  `)

  await 执行(`
    CREATE OR REPLACE FUNCTION ${名('拒绝记忆提交变更修改_触发器')}()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION '记忆变更记录不可修改或删除';
    END;
    $$ LANGUAGE plpgsql;
  `)
  await 执行(`DROP TRIGGER IF EXISTS trg_拒绝记忆提交变更修改 ON ${名('记忆提交变更表')};`)
  await 执行(`
    CREATE TRIGGER trg_拒绝记忆提交变更修改 BEFORE UPDATE OR DELETE ON ${名('记忆提交变更表')}
    FOR EACH ROW EXECUTE FUNCTION ${名('拒绝记忆提交变更修改_触发器')}();
  `)
  await 执行(`
    CREATE OR REPLACE FUNCTION ${名('拒绝永久实体修改_触发器')}()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION '永久实体身份不可修改或删除';
    END;
    $$ LANGUAGE plpgsql;
  `)
  for (let 表名 of ['记忆实体表', '记忆关联实体表', '动态工具实体表']) {
    await 执行(`DROP TRIGGER IF EXISTS trg_拒绝永久实体修改 ON ${名(表名)};`)
    await 执行(`
      CREATE TRIGGER trg_拒绝永久实体修改 BEFORE UPDATE OR DELETE ON ${名(表名)}
      FOR EACH ROW EXECUTE FUNCTION ${名('拒绝永久实体修改_触发器')}();
    `)
  }
  await 执行(`
    CREATE OR REPLACE FUNCTION ${名('限制记忆提交修改_触发器')}()
    RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION '记忆提交不可修改';
      END IF;
      IF EXISTS (SELECT 1 FROM ${名('记忆提交变更表')} WHERE 记忆提交id = OLD.id)
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
    `ALTER TABLE ${名('会话表')} ADD CONSTRAINT 会话表_前驱消息归属_fkey FOREIGN KEY (前驱会话id, 前驱消息id) REFERENCES ${名('消息表')}(会话id, id) ON DELETE RESTRICT;`,
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
        OR OLD.前驱会话id IS DISTINCT FROM NEW.前驱会话id
        OR OLD.前驱消息id IS DISTINCT FROM NEW.前驱消息id
        OR OLD.创建时间 IS DISTINCT FROM NEW.创建时间 THEN
        RAISE EXCEPTION '会话身份、前驱和创建时间不可修改';
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
