import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { 带记忆的智能体, 记忆等级, type 批量注入记忆项 } from '../src/index'
import { 使用共享PGlite } from './helpers/shared-pglite-fixture'
import { 限时 } from './helpers/shared-storage-helper'

function 记忆项(内容: string, 关键词: string[] = [内容], 等级: 记忆等级 = 记忆等级.一级): 批量注入记忆项 {
  return { 内容, 关键词, 标签: [], 评分: 80, 等级, 创建时间: new Date('2026-01-01T00:00:00.000Z') }
}

describe('变更记录', { timeout: 90000 }, () => {
  let 夹具 = 使用共享PGlite()
  let 智能体列表: 带记忆的智能体[] = []

  function 创建实例(选项: Partial<ConstructorParameters<typeof 带记忆的智能体>[0]> = {}): 带记忆的智能体 {
    // 自己带存储配置的用例（自己管 PGlite 句柄）保持原样，其余用共享 PGlite
    let 实例 =
      选项.存储 !== undefined
        ? new 带记忆的智能体({ 向量模型: { 类型: '无' }, ...选项 })
        : 夹具.新建智能体({ 向量模型: { 类型: '无' }, ...选项 })
    智能体列表.push(实例)
    return 实例
  }

  afterEach(async (): Promise<void> => {
    for (let 实例 of 智能体列表) await 实例.销毁()
    智能体列表 = []
  })

  it('默认保留全部变更记录，回退最近记忆提交可用', async (): Promise<void> => {
    let 实例 = 创建实例()
    await 实例.添加记忆(记忆项('第一条'))
    await 实例.添加记忆(记忆项('第二条'))
    expect((await 实例.查询记忆提交()).length).toBe(2)
    expect(await 实例.回退最近记忆提交()).toBe(true)
    expect((await 实例.查询记忆()).map((记忆) => 记忆.内容)).toEqual(['第一条'])
  })

  it('删除记忆保留完整历史并且可以回退', async (): Promise<void> => {
    let 实例 = 创建实例()
    let 记忆 = await 实例.添加记忆(记忆项('不会从历史消失', ['永久历史']))
    expect(await 实例.删除记忆(记忆.id)).toBe(true)
    expect(await 实例.查询记忆()).toEqual([])
    expect(JSON.stringify(await 实例.查询记忆提交(100))).toContain('永久历史')
    expect(await 实例.回退最近记忆提交()).toBe(true)
    expect(await 实例.查找记忆(记忆.id)).toMatchObject({ 内容: '不会从历史消失' })
  })

  it('数据库拒绝在活动提交之外修改任何受提交管理的状态', async (): Promise<void> => {
    let pglite = new PGlite({ extensions: { vector } })
    try {
      let 实例 = 创建实例({ 存储: { 模式: '外部', pglite } })
      let 记忆 = await 实例.添加记忆(记忆项('受提交保护', ['共同关键词']))
      await 实例.添加记忆(记忆项('关联也受保护', ['共同关键词']))
      await expect(pglite.query(`UPDATE 记忆表 SET 内容 = '绕过提交' WHERE id = $1`, [记忆.id])).rejects.toThrow(
        '只能在活动提交中修改',
      )
      await expect(pglite.query(`UPDATE 记忆关联表 SET 关联度 = 999`)).rejects.toThrow('只能在活动提交中修改')
      await expect(
        pglite.query(
          `INSERT INTO 动态工具表 (id, 名称, 描述, 代码, 创建时间) VALUES ('bypass', 'bypass', '', '', now())`,
        ),
      ).rejects.toThrow('只能在活动提交中修改')
      expect(await 实例.查找记忆(记忆.id)).toMatchObject({ 内容: '受提交保护' })
    } finally {
      for (let 实例 of 智能体列表) await 实例.销毁()
      智能体列表 = []
      await pglite.close()
    }
  })
})

describe('文件模式', { timeout: 90000 }, () => {
  let 临时目录列表: string[] = []
  let 智能体列表: 带记忆的智能体[] = []

  afterEach(async (): Promise<void> => {
    for (let 实例 of 智能体列表) await 实例.销毁()
    智能体列表 = []
    for (let 目录 of 临时目录列表) await rm(目录, { recursive: true, force: true })
    临时目录列表 = []
  })

  async function 创建临时数据目录(): Promise<string> {
    let 目录 = await mkdtemp(path.join(os.tmpdir(), 'ai-memory-files-'))
    临时目录列表.push(目录)
    return path.join(目录, 'db')
  }

  it('0.2.3 在 public 里建的旧数据目录能被正常打开、读写和回退', async (): Promise<void> => {
    let 数据目录 = await 创建临时数据目录()
    let 旧库 = new PGlite({ dataDir: 数据目录, extensions: { vector } })
    await 旧库.exec(await readFile(path.join(import.meta.dirname, 'fixtures', 'legacy-public-schema.sql'), 'utf8'))
    await 旧库.exec(`
      INSERT INTO 记忆提交表 (id, 父提交id, 消息, 创建时间) VALUES ('旧提交', NULL, '旧版本写入', now());
      INSERT INTO 记忆元数据表 (键, 值) VALUES ('HEAD_COMMIT', '旧提交');
      INSERT INTO 记忆表 (id, 等级, 评分, 内容, 关键词, 创建时间) VALUES ('old-1', '一级', 70, '旧版本留下的记忆', ARRAY['旧'], now());
    `)
    await 旧库.close()

    let 实例 = new 带记忆的智能体({ 存储: { 模式: '文件', 路径: 数据目录 }, 向量模型: { 类型: '无' } })
    智能体列表.push(实例)
    await 实例.初始化()

    expect((await 实例.查询记忆()).map((记忆) => 记忆.内容)).toEqual(['旧版本留下的记忆'])
    await 实例.添加记忆(记忆项('新版本写入的记忆', ['新']))
    expect((await 实例.查询记忆()).map((记忆) => 记忆.内容).sort()).toEqual(
      ['新版本写入的记忆', '旧版本留下的记忆'].sort(),
    )
    expect(await 实例.回退最近记忆提交()).toBe(true)
    expect((await 实例.查询记忆()).map((记忆) => 记忆.内容)).toEqual(['旧版本留下的记忆'])

    // 数据都在 public 里，没有凭空多出别的 schema 的表
    await 实例.销毁()
    智能体列表 = []
    let 复查 = new PGlite({ dataDir: 数据目录, extensions: { vector } })
    let 表所在schema = await 复查.query<{ 名称: string }>(
      `SELECT table_schema AS 名称 FROM information_schema.tables WHERE table_name = '记忆表'`,
    )
    expect(表所在schema.rows.map((行) => 行.名称)).toEqual(['public'])
    await 复查.close()
  })

  it('文件模式也可以带 schema，同一个目录里不同 schema 互不干扰', async (): Promise<void> => {
    let 数据目录 = await 创建临时数据目录()
    let 甲 = new 带记忆的智能体({ 存储: { 模式: '文件', 路径: 数据目录, schema: 'file_a' }, 向量模型: { 类型: '无' } })
    let 乙 = new 带记忆的智能体({ 存储: { 模式: '文件', 路径: 数据目录, schema: 'file_b' }, 向量模型: { 类型: '无' } })
    智能体列表.push(甲, 乙)
    await 限时(Promise.all([甲.初始化(), 乙.初始化()]), 60000, '文件模式两个 schema 初始化')
    await 限时(Promise.all([甲.添加记忆(记忆项('甲')), 乙.添加记忆(记忆项('乙'))]), 60000, '并发写入')
    expect((await 甲.查询记忆()).map((记忆) => 记忆.内容)).toEqual(['甲'])
    expect((await 乙.查询记忆()).map((记忆) => 记忆.内容)).toEqual(['乙'])
  })

  it('同一路径正在关闭时，新的打开要等关完再进行，数据不丢', async (): Promise<void> => {
    let 数据目录 = await 创建临时数据目录()
    let 第一实例 = new 带记忆的智能体({ 存储: { 模式: '文件', 路径: 数据目录 }, 向量模型: { 类型: '无' } })
    智能体列表.push(第一实例)
    await 第一实例.初始化()
    await 第一实例.添加记忆(记忆项('关闭前写入的记忆'))

    // 不等关闭完成就立刻在同一路径上新开实例
    let 关闭任务 = 第一实例.销毁()
    let 第二实例 = new 带记忆的智能体({ 存储: { 模式: '文件', 路径: 数据目录 }, 向量模型: { 类型: '无' } })
    智能体列表.push(第二实例)
    await 限时(Promise.all([关闭任务, 第二实例.初始化()]), 60000, '关闭与重新打开')
    expect((await 第二实例.查询记忆()).map((记忆) => 记忆.内容)).toEqual(['关闭前写入的记忆'])
    await 第二实例.添加记忆(记忆项('重新打开后写入的记忆', ['重新']))
    expect(await 第二实例.查询记忆()).toHaveLength(2)
  })

  it('很多实例交替打开关闭同一路径，不会出现两个句柄同时占用目录', async (): Promise<void> => {
    let 数据目录 = await 创建临时数据目录()
    let 任务列表: Promise<void>[] = []
    for (let i = 0; i < 4; i++) {
      任务列表.push(
        (async (): Promise<void> => {
          let 实例 = new 带记忆的智能体({ 存储: { 模式: '文件', 路径: 数据目录 }, 向量模型: { 类型: '无' } })
          await 实例.初始化()
          await 实例.添加记忆(记忆项(`轮换写入-${String(i)}`, [`词${String(i)}`]))
          await 实例.销毁()
        })(),
      )
    }
    await 限时(Promise.all(任务列表), 80000, '多实例轮换打开关闭')
    let 检查实例 = new 带记忆的智能体({ 存储: { 模式: '文件', 路径: 数据目录 }, 向量模型: { 类型: '无' } })
    智能体列表.push(检查实例)
    expect(await 检查实例.查询记忆()).toHaveLength(4)
  })
})
