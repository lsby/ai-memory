import type { 智能体事件 } from '@lsby/ai-agent'
import type { Kysely } from 'kysely'
import { 创建向量缓存 } from '../context'
import { 生成技能线索向量文本, 生成记忆线索向量文本 } from '../storage/clue-storage'
import type { 向量缓存 } from '../storage/vector-cache'
import type { 内部带记忆的智能体配置, 补算缺失向量结果, 补算缺失向量选项, 记忆数据库 } from '../types'

export type 向量补算依赖 = {
  配置: 内部带记忆的智能体配置
  数据库查询器: Kysely<记忆数据库>
  确保已初始化: () => Promise<void>
  执行记忆变更任务: <R>(
    消息: string,
    操作: (trx: Kysely<记忆数据库>, 父记忆提交id: string | null) => Promise<R>,
    缓存?: 向量缓存,
    回调?: (事件: 智能体事件) => Promise<void>,
    事件组id?: string,
  ) => Promise<R>
}

/** 一行待补的数据：定位它的方式，以及它的向量应该由哪段文本算出来。 */
type 待补行 =
  | { 表: '当前记忆表'; id: string; 文本: string }
  | { 表: '当前线索表'; id: string; 文本: string }
  | { 表: '当前记忆线索关联表'; 记忆id: string; 线索id: string; 文本: string }
  | { 表: '当前技能表'; id: string; 文本: string }
  | { 表: '当前技能线索关联表'; 技能id: string; 线索id: string; 文本: string }

export let 默认补算单次上限 = 100

/** 按固定顺序读出最多 上限 行 向量 IS NULL 的数据。文本规则与正常写入时完全一致。 */
async function 读取待补行(数据库查询器: Kysely<记忆数据库>, 上限: number): Promise<待补行[]> {
  let 结果: 待补行[] = []
  let 剩余 = (): number => 上限 - 结果.length

  let 记忆列表 = await 数据库查询器
    .selectFrom('当前记忆表')
    .select(['id', '内容'])
    .where('向量', 'is', null)
    .orderBy('创建序号')
    .limit(剩余())
    .execute()
  for (let 行 of 记忆列表) 结果.push({ 表: '当前记忆表', id: 行.id, 文本: 行.内容 })
  if (剩余() <= 0) return 结果

  let 线索列表 = await 数据库查询器
    .selectFrom('当前线索表')
    .select(['id', '内容'])
    .where('向量', 'is', null)
    .orderBy('创建时间')
    .orderBy('id')
    .limit(剩余())
    .execute()
  for (let 行 of 线索列表) 结果.push({ 表: '当前线索表', id: 行.id, 文本: 行.内容 })
  if (剩余() <= 0) return 结果

  let 记忆关联列表 = await 数据库查询器
    .selectFrom('当前记忆线索关联表 as 关联')
    .innerJoin('当前记忆表 as 记忆', '记忆.id', '关联.记忆id')
    .innerJoin('当前线索表 as 线索', '线索.id', '关联.线索id')
    .select(['关联.记忆id', '关联.线索id', '记忆.内容 as 记忆内容', '线索.内容 as 线索内容'])
    .where('关联.向量', 'is', null)
    .orderBy('记忆.创建序号')
    .orderBy('关联.线索id')
    .limit(剩余())
    .execute()
  for (let 行 of 记忆关联列表) {
    结果.push({
      表: '当前记忆线索关联表',
      记忆id: 行.记忆id,
      线索id: 行.线索id,
      文本: 生成记忆线索向量文本(行.记忆内容, 行.线索内容),
    })
  }
  if (剩余() <= 0) return 结果

  let 技能列表 = await 数据库查询器
    .selectFrom('当前技能表')
    .select(['id', '名称', '描述'])
    .where('向量', 'is', null)
    .orderBy('创建时间')
    .orderBy('id')
    .limit(剩余())
    .execute()
  for (let 行 of 技能列表) 结果.push({ 表: '当前技能表', id: 行.id, 文本: `${行.名称} ${行.描述}` })
  if (剩余() <= 0) return 结果

  let 技能关联列表 = await 数据库查询器
    .selectFrom('当前技能线索关联表 as 关联')
    .innerJoin('当前技能表 as 技能', '技能.id', '关联.技能id')
    .innerJoin('当前线索表 as 线索', '线索.id', '关联.线索id')
    .select(['关联.技能id', '关联.线索id', '技能.名称 as 技能名称', '技能.描述 as 技能描述', '线索.内容 as 线索内容'])
    .where('关联.向量', 'is', null)
    .orderBy('技能.创建时间')
    .orderBy('关联.线索id')
    .limit(剩余())
    .execute()
  for (let 行 of 技能关联列表) {
    结果.push({
      表: '当前技能线索关联表',
      技能id: 行.技能id,
      线索id: 行.线索id,
      文本: 生成技能线索向量文本(行.技能名称, 行.技能描述, 行.线索内容),
    })
  }
  return 结果
}

async function 统计缺失向量数(数据库查询器: Kysely<记忆数据库>): Promise<number> {
  let 合计 = 0
  let 表名列表 = ['当前记忆表', '当前线索表', '当前记忆线索关联表', '当前技能表', '当前技能线索关联表'] as const
  for (let 表名 of 表名列表) {
    let 行 = await 数据库查询器
      .selectFrom(表名)
      .select((eb) => eb.fn.countAll<string>().as('数量'))
      .where('向量', 'is', null)
      .executeTakeFirst()
    合计 += Number(行?.数量 ?? 0)
  }
  return 合计
}

async function 写入向量(trx: Kysely<记忆数据库>, 行: 待补行, 向量: number[]): Promise<void> {
  let 值 = { 向量: JSON.stringify(向量), 向量维度: 向量.length }
  switch (行.表) {
    case '当前记忆表':
    case '当前线索表':
    case '当前技能表':
      await trx.updateTable(行.表).set(值).where('id', '=', 行.id).where('向量', 'is', null).execute()
      return
    case '当前记忆线索关联表':
      await trx
        .updateTable(行.表)
        .set(值)
        .where('记忆id', '=', 行.记忆id)
        .where('线索id', '=', 行.线索id)
        .where('向量', 'is', null)
        .execute()
      return
    case '当前技能线索关联表':
      await trx
        .updateTable(行.表)
        .set(值)
        .where('技能id', '=', 行.技能id)
        .where('线索id', '=', 行.线索id)
        .where('向量', 'is', null)
        .execute()
      return
  }
}

/**
 * 给 向量 IS NULL 的行补算向量（记忆、线索、记忆线索关联、技能、技能线索关联），不处理消息表。
 * 两段式：事务外先把这批文本的向量算好放进缓存，事务内重读这批行、只读缓存写回，走正常的记忆提交，
 * 所以变更记录表里每行都有 update 记录。算失败的行保持 NULL 等下次再补。
 */
export async function 补算缺失向量(依赖: 向量补算依赖, 选项: 补算缺失向量选项): Promise<补算缺失向量结果> {
  let { 配置, 数据库查询器 } = 依赖
  let 上限 = 选项.单次上限 ?? 默认补算单次上限
  if (Number.isInteger(上限) === false || 上限 < 1) throw new Error('补算缺失向量的单次上限必须是正整数')
  if (配置.只读模式 === true) throw new Error('智能体当前处于只读模式，禁止执行任何记忆变更')
  if (配置.向量模型.类型 === '无') return { 已补算数: 0, 剩余数: 0, 失败数: 0 }
  await 依赖.确保已初始化()
  let 待补列表 = await 读取待补行(数据库查询器, 上限)
  if (待补列表.length === 0) return { 已补算数: 0, 剩余数: 0, 失败数: 0 }

  let 缓存 = await 创建向量缓存(
    配置,
    待补列表.map((行) => 行.文本),
  )
  let 统计 = await 依赖.执行记忆变更任务(
    '补算缺失向量',
    async (trx): Promise<{ 已补算数: number; 失败数: number }> => {
      // 事务内重读：外面算向量期间如果有行被改过、删掉或已被补好，文本对不上缓存的就跳过，等下一次再补
      let 当前列表 = await 读取待补行(trx, 上限)
      let 已补算数 = 0
      let 失败数 = 0
      for (let 行 of 当前列表) {
        let 结果 = 缓存.结果.get(行.文本)
        if (结果 === undefined) continue
        if (结果.类型 === '成功' && 结果.向量.length > 0) {
          await 写入向量(trx, 行, 结果.向量)
          已补算数 += 1
        } else {
          失败数 += 1
        }
      }
      return { 已补算数, 失败数 }
    },
    缓存,
  )
  return { ...统计, 剩余数: await 统计缺失向量数(数据库查询器) }
}
