import { PGlite, type PGliteOptions } from '@electric-sql/pglite'
import fs from 'node:fs'
import path from 'node:path'
import * as lockfile from 'proper-lockfile'

let 全局PGlite实例缓存 = new Map<string, PGlite>()
let 全局PGlite引用计数 = new Map<string, number>()
let 全局PGlite任务队列锁 = new Map<string, Promise<void>>()
let 全局PGlite初始化锁 = new Map<string, Promise<void>>()

export function 获取或创建PGlite(选项: PGliteOptions & { dataDir: string }): PGlite {
  let 路径 = 选项.dataDir
  if (全局PGlite实例缓存.has(路径)) {
    let 当前计数 = 全局PGlite引用计数.get(路径)
    全局PGlite引用计数.set(路径, (当前计数 ?? 0) + 1)
    let 实例 = 全局PGlite实例缓存.get(路径)
    if (实例 !== undefined) return 实例
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
  全局PGlite任务队列锁.delete(路径)
  全局PGlite初始化锁.delete(路径)
  if (实例 !== undefined) await 实例.close()
}

export function 获取共享任务队列锁(路径: string): Promise<void> {
  return 全局PGlite任务队列锁.get(路径) ?? Promise.resolve()
}

export function 设置共享任务队列锁(路径: string, 锁: Promise<void>): void {
  全局PGlite任务队列锁.set(路径, 锁)
}

export function 获取或创建共享初始化锁(路径: string, 初始化: () => Promise<void>): Promise<void> {
  let 现有锁 = 全局PGlite初始化锁.get(路径)
  if (现有锁 !== undefined) return 现有锁
  let 新锁 = 初始化()
  全局PGlite初始化锁.set(路径, 新锁)
  return 新锁
}

export function 清除共享初始化锁(路径: string): void {
  全局PGlite初始化锁.delete(路径)
}
