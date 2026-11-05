import type { PGlite } from '@electric-sql/pglite'
import { PGliteDialect, PGliteDriver, type DatabaseConnection, type Driver } from 'kysely'

/**
 * kysely 自带的 PGliteDriver 只有一个共享连接，acquireConnection 不加锁：
 * 事务期间别的普通查询会跑进这个事务，两个事务同时开还会互相覆盖提交和回滚。
 * 这里按 PGlite 对象维护一把先进先出的互斥锁，所有用这个 PGlite 的实例（内存、文件、外部）排同一个队。
 */
export class 连接互斥锁 {
  private 队尾: Promise<void> = Promise.resolve()

  /** 排队等待，轮到时返回放锁函数。放锁函数多次调用无副作用。 */
  public async 获取(): Promise<() => void> {
    let 放锁: () => void = () => {}
    let 前一个 = this.队尾
    this.队尾 = new Promise<void>((resolve) => {
      放锁 = resolve
    })
    await 前一个
    return 放锁
  }
}

let 互斥锁表 = new WeakMap<PGlite, 连接互斥锁>()

export function 获取连接互斥锁(pglite: PGlite): 连接互斥锁 {
  let 已有 = 互斥锁表.get(pglite)
  if (已有 !== undefined) return 已有
  let 新锁 = new 连接互斥锁()
  互斥锁表.set(pglite, 新锁)
  return 新锁
}

/** 在 PGlite 的连接互斥锁内执行一段操作。 */
export async function 在互斥锁内执行<R>(pglite: PGlite, 操作: () => Promise<R>): Promise<R> {
  await pglite.waitReady
  let 放锁 = await 获取连接互斥锁(pglite).获取()
  try {
    return await 操作()
  } finally {
    放锁()
  }
}

export let 默认schema = 'public'

/** 校验 schema 名：非空、不含空字符、不超过 63 字节、不占用 PostgreSQL 保留前缀。 */
export function 校验schema名(名称: string): string {
  if (名称 === '') throw new Error('schema 名不能为空')
  if (名称.includes('\u0000')) throw new Error('schema 名不能包含空字符')
  if (Buffer.byteLength(名称, 'utf8') > 63) throw new Error('schema 名不能超过 63 字节')
  if (名称.startsWith('pg_')) throw new Error('schema 名不能以 pg_ 开头（PostgreSQL 保留）')
  if (名称 === 'information_schema') throw new Error('schema 名不能使用 information_schema')
  return 名称
}

/** 把标识符转义成带双引号的形式，内部的双引号翻倍。 */
export function 转义标识符(名称: string): string {
  return `"${名称.replace(/"/g, '""')}"`
}

type 实例持有 = { 实例?: PGlite }

class 带互斥的驱动 extends PGliteDriver {
  private 释放当前锁: (() => void) | null = null

  public constructor(
    获取实例: () => PGlite | Promise<PGlite>,
    private readonly schema: string,
    private readonly 持有: 实例持有 = {},
  ) {
    super({
      pglite: async (): Promise<PGlite> => {
        let 实例 = await 获取实例()
        持有.实例 = 实例
        return 实例
      },
    })
  }

  public override async acquireConnection(): Promise<DatabaseConnection> {
    let 实例 = this.持有.实例
    if (实例 === undefined) throw new Error('PGlite 尚未就绪，不能获取连接')
    let 放锁 = await 获取连接互斥锁(实例).获取()
    try {
      if (this.schema !== 默认schema) await 实例.exec(`SET search_path TO ${转义标识符(this.schema)}, public`)
      let 连接 = await super.acquireConnection()
      this.释放当前锁 = 放锁
      return 连接
    } catch (错误) {
      放锁()
      throw 错误
    }
  }

  public override async releaseConnection(): Promise<void> {
    let 放锁 = this.释放当前锁
    this.释放当前锁 = null
    try {
      let 实例 = this.持有.实例
      // 共享句柄上还可能有调用方自己的查询，不能把 search_path 留在我们的 schema 上
      if (this.schema !== 默认schema && 实例 !== undefined) await 实例.exec('RESET search_path')
    } catch (_错误) {
      // 句柄已关闭等情况下重置失败不影响放锁
    } finally {
      if (放锁 !== null) 放锁()
    }
  }
}

/** 带连接互斥锁、可按 schema 设置 search_path 的 PGlite 方言。 */
export class 带互斥的PGlite方言 extends PGliteDialect {
  public constructor(
    private readonly 获取实例: () => PGlite | Promise<PGlite>,
    private readonly schema: string = 默认schema,
  ) {
    super({ pglite: 获取实例 })
  }

  public override createDriver(): Driver {
    return new 带互斥的驱动(this.获取实例, this.schema)
  }
}

/** 删除一个记忆空间（schema）及其中全部数据。调用方应先销毁使用该 schema 的实例。 */
export async function 删除记忆空间(pglite: PGlite, schema: string): Promise<void> {
  let 已校验名称 = 校验schema名(schema)
  if (已校验名称 === 默认schema) throw new Error('不能删除 public 记忆空间，它同时存放 vector 扩展')
  await 在互斥锁内执行(pglite, async (): Promise<void> => {
    await pglite.exec(`DROP SCHEMA IF EXISTS ${转义标识符(已校验名称)} CASCADE`)
  })
}
