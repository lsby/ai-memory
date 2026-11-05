import type { Kysely } from 'kysely'
import { 查询会话, 读取消息历史 } from '../storage/conversation-storage'
import type { 公开消息, 记忆数据库 } from '../types'

/** 只读取当前会话 HEAD 及压缩前驱链，不会越过会话分支读到旁支消息。 */
export async function 读取当前会话谱系消息(数据库查询器: Kysely<记忆数据库>, 当前会话id: string): Promise<公开消息[]> {
  let 结果: 公开消息[] = []
  let 已访问会话 = new Set<string>()
  let 会话 = await 查询会话(数据库查询器, 当前会话id)
  let 锚点消息id = 会话?.当前消息id ?? null
  while (会话 !== null) {
    if (已访问会话.has(会话.id)) throw new Error(`会话前驱链存在循环: ${会话.id}`)
    已访问会话.add(会话.id)
    if (锚点消息id !== null) 结果.unshift(...(await 读取消息历史(数据库查询器, 锚点消息id, 100000)))
    if (会话.前驱消息id === null) break
    锚点消息id = 会话.前驱消息id
    let 前驱消息 = await 数据库查询器
      .selectFrom('消息表')
      .select('会话id')
      .where('id', '=', 会话.前驱消息id)
      .executeTakeFirst()
    if (前驱消息 === undefined) throw new Error(`前驱消息不存在: ${会话.前驱消息id}`)
    会话 = await 查询会话(数据库查询器, 前驱消息.会话id)
  }
  return 结果
}
