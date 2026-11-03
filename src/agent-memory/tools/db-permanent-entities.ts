import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { 转义标识符 } from '../storage/connection'
import type { 记忆数据库 } from '../types'

type 执行数据库语句 = (语句: string) => Promise<void>

function 创建数据库帮助器(
  数据库查询器: Kysely<记忆数据库>,
  schema: string,
): { 名: (对象名: string) => string; 执行: 执行数据库语句 } {
  return {
    名: (对象名: string): string => `${转义标识符(schema)}.${转义标识符(对象名)}`,
    执行: async (语句: string): Promise<void> => {
      await sql.raw(语句).execute(数据库查询器)
    },
  }
}

/** 创建只增不减的实体身份层，并登记当前状态中已有的实体身份。 */
export async function 初始化永久实体表(数据库查询器: Kysely<记忆数据库>, schema: string): Promise<void> {
  let { 名, 执行 } = 创建数据库帮助器(数据库查询器, schema)
  await 执行(`CREATE TABLE IF NOT EXISTS ${名('记忆实体表')} (id TEXT PRIMARY KEY);`)
  await 执行(`CREATE TABLE IF NOT EXISTS ${名('动态工具实体表')} (id TEXT PRIMARY KEY);`)
  await 执行(`
    CREATE TABLE IF NOT EXISTS ${名('记忆关联实体表')} (
      起点id TEXT NOT NULL REFERENCES ${名('记忆实体表')}(id) ON DELETE RESTRICT,
      终点id TEXT NOT NULL REFERENCES ${名('记忆实体表')}(id) ON DELETE RESTRICT,
      PRIMARY KEY (起点id, 终点id)
    );
  `)
  await 执行(`
    INSERT INTO ${名('记忆实体表')} (id)
    SELECT id FROM ${名('当前记忆表')}
    UNION SELECT 记忆实体id FROM ${名('记忆提交变更表')} WHERE 记忆实体id IS NOT NULL
    ON CONFLICT (id) DO NOTHING;
  `)
  await 执行(`
    INSERT INTO ${名('动态工具实体表')} (id)
    SELECT id FROM ${名('当前动态工具表')}
    UNION SELECT 动态工具实体id FROM ${名('记忆提交变更表')} WHERE 动态工具实体id IS NOT NULL
    ON CONFLICT (id) DO NOTHING;
  `)
  await 执行(`
    INSERT INTO ${名('记忆关联实体表')} (起点id, 终点id)
    SELECT 起点id, 终点id FROM ${名('当前记忆关联表')}
    UNION SELECT 起点记忆实体id, 终点记忆实体id FROM ${名('记忆提交变更表')}
      WHERE 起点记忆实体id IS NOT NULL AND 终点记忆实体id IS NOT NULL
    ON CONFLICT (起点id, 终点id) DO NOTHING;
  `)
}

/** 当 HEAD 投影首次出现对象时，先登记永久身份，供同事务的变更日志引用。 */
export async function 初始化永久实体登记触发器(数据库查询器: Kysely<记忆数据库>, schema: string): Promise<void> {
  let { 名, 执行 } = 创建数据库帮助器(数据库查询器, schema)
  await 执行(`
    CREATE OR REPLACE FUNCTION ${名('登记永久实体_触发器')}()
    RETURNS TRIGGER AS $$
    BEGIN
      IF TG_TABLE_NAME = '当前记忆表' THEN
        INSERT INTO ${名('记忆实体表')} (id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING;
      ELSIF TG_TABLE_NAME = '当前记忆关联表' THEN
        INSERT INTO ${名('记忆关联实体表')} (起点id, 终点id)
        VALUES (NEW.起点id, NEW.终点id) ON CONFLICT (起点id, 终点id) DO NOTHING;
      ELSIF TG_TABLE_NAME = '当前动态工具表' THEN
        INSERT INTO ${名('动态工具实体表')} (id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING;
      ELSE
        RAISE EXCEPTION '不支持的状态投影表: %', TG_TABLE_NAME;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)
  for (let 表名 of ['当前记忆表', '当前记忆关联表', '当前动态工具表']) {
    await 执行(`DROP TRIGGER IF EXISTS trg_登记永久实体 ON ${名(表名)};`)
    await 执行(`
      CREATE TRIGGER trg_登记永久实体 BEFORE INSERT ON ${名(表名)}
      FOR EACH ROW EXECUTE FUNCTION ${名('登记永久实体_触发器')}();
    `)
  }
}
