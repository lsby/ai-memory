import type { Kysely } from 'kysely'

export async function 确保在事务中执行<DB, T>(
  数据库查询器: Kysely<DB>,
  回调: (trx: Kysely<DB>) => Promise<T>,
): Promise<T> {
  if (数据库查询器.isTransaction === true) return await 回调(数据库查询器)
  return await 数据库查询器.transaction().execute(async (trx) => await 回调(trx))
}
