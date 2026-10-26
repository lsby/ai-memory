import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { 转义标识符 } from '../storage/connection'
import type { 记忆数据库 } from '../types'

/** 把所有历史关系改为显式删除，并在数据库层保护会话、消息和日志。 */
export async function 初始化不可变约束(数据库查询器: Kysely<记忆数据库>, schema: string): Promise<void> {
  let 名 = (对象名: string): string => `${转义标识符(schema)}.${转义标识符(对象名)}`
  let 执行 = async (语句: string): Promise<void> => {
    await sql.raw(语句).execute(数据库查询器)
  }
  await 执行(`ALTER TABLE ${名('记忆关联表')} DROP CONSTRAINT IF EXISTS 记忆关联表_起点id_fkey;`)
  await 执行(`ALTER TABLE ${名('记忆关联表')} DROP CONSTRAINT IF EXISTS 记忆关联表_终点id_fkey;`)
  await 执行(
    `ALTER TABLE ${名('记忆关联表')} ADD CONSTRAINT 记忆关联表_起点id_fkey FOREIGN KEY (起点id) REFERENCES ${名('记忆表')}(id) ON DELETE RESTRICT;`,
  )
  await 执行(
    `ALTER TABLE ${名('记忆关联表')} ADD CONSTRAINT 记忆关联表_终点id_fkey FOREIGN KEY (终点id) REFERENCES ${名('记忆表')}(id) ON DELETE RESTRICT;`,
  )
  await 执行(`ALTER TABLE ${名('记忆变更表')} DROP CONSTRAINT IF EXISTS 记忆变更表_提交id_fkey;`)
  await 执行(
    `ALTER TABLE ${名('记忆变更表')} ADD CONSTRAINT 记忆变更表_提交id_fkey FOREIGN KEY (提交id) REFERENCES ${名('记忆提交表')}(id) ON DELETE RESTRICT;`,
  )

  await 执行(`
    CREATE OR REPLACE FUNCTION ${名('拒绝记忆变更修改_触发器')}()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION '记忆变更记录不可修改或删除';
    END;
    $$ LANGUAGE plpgsql;
  `)
  await 执行(`DROP TRIGGER IF EXISTS trg_拒绝记忆变更修改 ON ${名('记忆变更表')};`)
  await 执行(`
    CREATE TRIGGER trg_拒绝记忆变更修改 BEFORE UPDATE OR DELETE ON ${名('记忆变更表')}
    FOR EACH ROW EXECUTE FUNCTION ${名('拒绝记忆变更修改_触发器')}();
  `)
  await 执行(`
    CREATE OR REPLACE FUNCTION ${名('限制记忆提交修改_触发器')}()
    RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION '记忆提交不可修改';
      END IF;
      IF EXISTS (SELECT 1 FROM ${名('记忆变更表')} WHERE 提交id = OLD.id)
        OR EXISTS (SELECT 1 FROM ${名('记忆提交表')} WHERE 父提交id = OLD.id)
        OR EXISTS (SELECT 1 FROM ${名('记忆元数据表')} WHERE 键 = 'HEAD_COMMIT' AND 值 = OLD.id) THEN
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
  await 执行(`
    CREATE OR REPLACE FUNCTION ${名('校验消息归属_触发器')}()
    RETURNS TRIGGER AS $$
    DECLARE
      v_parent_session TEXT;
    BEGIN
      IF NEW.父消息id IS NOT NULL THEN
        SELECT 会话id INTO v_parent_session FROM ${名('消息表')} WHERE id = NEW.父消息id;
        IF v_parent_session IS NULL OR v_parent_session <> NEW.会话id THEN
          RAISE EXCEPTION '父消息必须属于同一会话';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)
  await 执行(`DROP TRIGGER IF EXISTS trg_校验消息归属 ON ${名('消息表')};`)
  await 执行(`
    CREATE TRIGGER trg_校验消息归属 BEFORE INSERT ON ${名('消息表')}
    FOR EACH ROW EXECUTE FUNCTION ${名('校验消息归属_触发器')}();
  `)
  await 执行(`DROP TRIGGER IF EXISTS trg_拒绝消息修改 ON ${名('消息表')};`)
  await 执行(`
    CREATE TRIGGER trg_拒绝消息修改 BEFORE UPDATE OR DELETE ON ${名('消息表')}
    FOR EACH ROW EXECUTE FUNCTION ${名('拒绝消息修改_触发器')}();
  `)

  await 执行(`
    CREATE OR REPLACE FUNCTION ${名('限制会话修改_触发器')}()
    RETURNS TRIGGER AS $$
    DECLARE
      v_message_session TEXT;
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
      IF NEW.当前消息id IS NOT NULL THEN
        SELECT 会话id INTO v_message_session FROM ${名('消息表')} WHERE id = NEW.当前消息id;
        IF v_message_session IS NULL OR v_message_session <> NEW.id THEN
          RAISE EXCEPTION '当前消息必须属于当前会话';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)
  await 执行(`
    CREATE OR REPLACE FUNCTION ${名('校验会话前驱_触发器')}()
    RETURNS TRIGGER AS $$
    DECLARE
      v_message_session TEXT;
    BEGIN
      IF NEW.前驱消息id IS NOT NULL THEN
        SELECT 会话id INTO v_message_session FROM ${名('消息表')} WHERE id = NEW.前驱消息id;
        IF v_message_session IS NULL OR v_message_session <> NEW.前驱会话id THEN
          RAISE EXCEPTION '前驱消息必须属于前驱会话';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)
  await 执行(`DROP TRIGGER IF EXISTS trg_校验会话前驱 ON ${名('会话表')};`)
  await 执行(`
    CREATE TRIGGER trg_校验会话前驱 BEFORE INSERT ON ${名('会话表')}
    FOR EACH ROW EXECUTE FUNCTION ${名('校验会话前驱_触发器')}();
  `)
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
  await 执行(`DROP TRIGGER IF EXISTS trg_拒绝交互日志修改 ON ${名('交互日志表')};`)
  await 执行(`
    CREATE TRIGGER trg_拒绝交互日志修改 BEFORE UPDATE OR DELETE ON ${名('交互日志表')}
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
