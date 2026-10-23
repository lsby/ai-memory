import { PGlite, type PGliteOptions } from '@electric-sql/pglite'
import type { Kysely } from 'kysely'
import fs from 'node:fs'
import path from 'node:path'
import * as lockfile from 'proper-lockfile'
import type { 存储配置, 记忆数据库 } from './agent-memory-types'

let 全局PGlite实例缓存 = new Map<string, PGlite>()
let 全局PGlite引用计数 = new Map<string, number>()
let 全局PGlite初始化锁 = new Map<string, Promise<void>>()
/** 每个路径一条打开/关闭队列：关闭中的路径，新的打开要等它关完。 */
let 全局PGlite路径队列 = new Map<string, Promise<void>>()

function 入队执行<R>(路径: string, 任务: () => Promise<R>): Promise<R> {
  let 前一个 = 全局PGlite路径队列.get(路径) ?? Promise.resolve()
  let 结果 = 前一个.then(任务)
  let 队尾: Promise<void> = 结果
    .then(
      (): void => {},
      (): void => {},
    )
    .then((): void => {
      if (全局PGlite路径队列.get(路径) === 队尾) 全局PGlite路径队列.delete(路径)
    })
  全局PGlite路径队列.set(路径, 队尾)
  return 结果
}

/** 排队打开（或复用）某个路径的 PGlite，并把引用计数加一。 */
export async function 获取或创建PGlite(选项: PGliteOptions & { dataDir: string }): Promise<PGlite> {
  return await 入队执行(选项.dataDir, async (): Promise<PGlite> => 同步获取或创建PGlite(选项))
}

function 同步获取或创建PGlite(选项: PGliteOptions & { dataDir: string }): PGlite {
  let 路径 = 选项.dataDir
  let 已缓存实例 = 全局PGlite实例缓存.get(路径)
  if (已缓存实例 !== undefined) {
    全局PGlite引用计数.set(路径, (全局PGlite引用计数.get(路径) ?? 0) + 1)
    return 已缓存实例
  }

  if (fs.existsSync(路径) === false) fs.mkdirSync(路径, { recursive: true })
  let releaseLock: (() => void) | undefined
  try {
    releaseLock = lockfile.lockSync(路径, { stale: 10000 })
  } catch (error) {
    throw new Error(
      `无法获取数据库目录 ${路径} 的文件锁，可能有其他进程正在同时初始化: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  try {
    let pidFile = path.join(路径, 'postmaster.pid')
    if (fs.existsSync(pidFile)) {
      try {
        let pidContent = fs.readFileSync(pidFile, 'utf8')
        let pid = parseInt(pidContent.split('\n')[0]?.trim() ?? '', 10)
        if (Number.isNaN(pid) === false && pid !== process.pid) {
          let 进程存活 = false
          try {
            process.kill(pid, 0)
            进程存活 = true
          } catch (_error) {}
          if (进程存活 === true)
            throw new Error(`数据库目录 ${路径} 正在被其他进程 (PID: ${String(pid)}) 使用中，无法启动。`)
        }
        fs.unlinkSync(pidFile)
      } catch (error) {
        if (error instanceof Error && error.message.includes('正在被其他进程')) throw error
        try {
          fs.unlinkSync(pidFile)
        } catch (_error) {}
      }
    }

    let 实例 = new PGlite(选项)
    全局PGlite实例缓存.set(路径, 实例)
    全局PGlite引用计数.set(路径, 1)
    return 实例
  } finally {
    releaseLock()
  }
}

export async function 释放PGlite(路径: string): Promise<void> {
  await 入队执行(路径, async (): Promise<void> => {
    let 当前计数 = 全局PGlite引用计数.get(路径)
    if (当前计数 === undefined) return
    当前计数--
    if (当前计数 > 0) {
      全局PGlite引用计数.set(路径, 当前计数)
      return
    }
    let 实例 = 全局PGlite实例缓存.get(路径)
    全局PGlite实例缓存.delete(路径)
    全局PGlite引用计数.delete(路径)
    for (let 键 of [...全局PGlite初始化锁.keys()]) {
      if (键.startsWith(`${路径}\u0000`)) 全局PGlite初始化锁.delete(键)
    }
    // 关闭完成前队列不放行，其间同路径的新打开会排在后面
    if (实例 !== undefined) await 实例.close()
  })
}

function 初始化锁键(路径: string, schema: string): string {
  return `${路径}\u0000${schema}`
}

export function 获取或创建共享初始化锁(路径: string, schema: string, 初始化: () => Promise<void>): Promise<void> {
  let 键 = 初始化锁键(路径, schema)
  let 现有锁 = 全局PGlite初始化锁.get(键)
  if (现有锁 !== undefined) return 现有锁
  let 新锁 = 初始化()
  全局PGlite初始化锁.set(键, 新锁)
  return 新锁
}

export function 清除共享初始化锁(路径: string, schema: string): void {
  全局PGlite初始化锁.delete(初始化锁键(路径, schema))
}

/** 按存储模式释放实例占用的资源：内存模式关闭自己建的句柄，文件模式减引用计数，外部模式什么都不动。 */
export async function 销毁存储(
  存储: 存储配置,
  句柄就绪: Promise<PGlite>,
  数据库查询器: Kysely<记忆数据库>,
): Promise<void> {
  switch (存储.模式) {
    case '内存': {
      // kysely.destroy 会关闭底层连接，只有内存模式才由本实例负责
      try {
        await 数据库查询器.destroy()
      } catch (_e) {}
      try {
        await (await 句柄就绪).close()
      } catch (_e) {}
      break
    }
    case '文件': {
      // 打开失败的路径没有占用引用计数，不需要释放
      let 已打开 = await 句柄就绪.then(
        (): boolean => true,
        (): boolean => false,
      )
      if (已打开) await 释放PGlite(存储.路径)
      break
    }
    case '外部':
      // 外部句柄由调用方自己关闭
      break
  }
}
