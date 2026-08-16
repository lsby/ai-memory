import * as d3 from 'd3'
import { Kysely } from 'kysely'
import { 记忆数据库 } from '../agent-memory-types'
import { 确保在事务中执行 } from './common'

type 布局节点 = d3.SimulationNodeDatum & { id: string; x: number; y: number }
type 布局连接 = d3.SimulationLinkDatum<布局节点> & { 关联度: number }

export async function 增量排版(数据库查询器: Kysely<记忆数据库>, 中心节点id: string): Promise<void> {
  // 1. 获取所有跟中心节点直接相连的边
  let 相关边 = await 数据库查询器
    .selectFrom('记忆关联表')
    .selectAll()
    .where((eb) => eb.or([eb('起点id', '=', 中心节点id), eb('终点id', '=', 中心节点id)]))
    .execute()

  // 收集涉及到的所有节点 ID
  let 节点id集合 = new Set<string>()
  节点id集合.add(中心节点id)
  for (let 边 of 相关边) {
    节点id集合.add(边.起点id)
    节点id集合.add(边.终点id)
  }

  // 2. 查出这些节点的 x, y, 以及它们的“基础半径”（这里用类似前端的逻辑，关联数量）
  // 为了简单，我们只查询出 x, y
  let 涉及节点 = await 数据库查询器
    .selectFrom('记忆表')
    .select(['id', 'x', 'y'])
    .where('id', 'in', Array.from(节点id集合))
    .execute()

  let 节点映射 = new Map<string, 布局节点>()
  for (let 节点 of 涉及节点) {
    节点映射.set(节点.id, { id: 节点.id, x: 节点.x ?? 0, y: 节点.y ?? 0 })
  }

  let 中心节点 = 节点映射.get(中心节点id)
  if (中心节点 === undefined) return

  // 3. 如果这是一个纯新节点(0,0)，把它初始放置在最强关联节点的附近
  if (中心节点.x === 0 && 中心节点.y === 0 && 相关边.length > 0) {
    let 最强边 = [...相关边].sort((a, b) => b.关联度 - a.关联度)[0]
    if (最强边 === undefined) return
    let 邻居id = 最强边.起点id === 中心节点id ? 最强边.终点id : 最强边.起点id
    let 邻居节点 = 节点映射.get(邻居id)
    if (邻居节点 !== undefined) {
      中心节点.x = 邻居节点.x + (Math.random() - 0.5) * 50
      中心节点.y = 邻居节点.y + (Math.random() - 0.5) * 50
    }
  } else if (中心节点.x === 0 && 中心节点.y === 0) {
    // 孤立节点，放在大地图随机边缘
    中心节点.x = (Math.random() - 0.5) * 800
    中心节点.y = (Math.random() - 0.5) * 800
  }

  // 4. 让除中心节点以外的老节点有一定的移动空间，但不死锁
  // 移除了 fx 和 fy 的强制锁定，改用 forceX 和 forceY 来维持原位
  let nodes = Array.from(节点映射.values())
  let links = 相关边.map((边) => ({ source: 边.起点id, target: 边.终点id, 关联度: 边.关联度 }))

  // 5. 运行物理引擎 (后端模拟)
  let 模拟 = d3
    .forceSimulation<布局节点>(nodes)
    .force(
      'link',
      d3
        .forceLink<布局节点, 布局连接>(links)
        .id((节点) => 节点.id)
        .distance((连接) => Math.max(60, 250 - 连接.关联度 * 150))
        .strength((连接) => 0.1 + 连接.关联度 * 0.2), // 关联度越高拉力越强，但总体保持较弱，让斥力发挥作用
    )
    .force('charge', d3.forceManyBody().strength(-500).distanceMax(800)) // 增加斥力，增加作用范围
    .force('collision', d3.forceCollide().radius(20).strength(0.8)) // 缩小碰撞半径，减弱碰撞刚性，允许轻微重叠以呈现有机形态
    .force(
      'x',
      d3.forceX<布局节点>((节点) => 节点.x).strength((节点) => (节点.id === 中心节点id ? 0 : 0.8)),
    )
    .force(
      'y',
      d3.forceY<布局节点>((节点) => 节点.y).strength((节点) => (节点.id === 中心节点id ? 0 : 0.8)),
    )
    .stop()

  // 手动推进模拟过程，因为我们在 Node 环境，不能依赖 requestAnimationFrame
  // 运行 150 步足以稳定一个小范围局部网络
  for (let i = 0; i < 150; i++) {
    模拟.tick()
  }

  // 6. 将新坐标保存回数据库
  // 由于我们放开了老节点，所有的相关节点都可以发生小幅度弹开，避免重叠
  for (let node of nodes) {
    let 原始 = 节点映射.get(node.id)
    if (
      node.id === 中心节点id ||
      (原始 !== undefined && (Math.abs(node.x - 原始.x) > 1 || Math.abs(node.y - 原始.y) > 1))
    ) {
      await 数据库查询器.updateTable('记忆表').set({ x: node.x, y: node.y }).where('id', '=', node.id).execute()
    }
  }
}

export async function 全局排版(数据库查询器: Kysely<记忆数据库>): Promise<void> {
  // 1. 读取所有节点和边
  let 所有节点 = await 数据库查询器.selectFrom('记忆表').select(['id', 'x', 'y']).execute()
  let 所有边 = await 数据库查询器.selectFrom('记忆关联表').selectAll().execute()

  let nodes = 所有节点.map((n) => ({
    id: n.id,
    x: n.x ?? (Math.random() - 0.5) * 800,
    y: n.y ?? (Math.random() - 0.5) * 800,
  }))
  let links = 所有边.map((l) => ({ source: l.起点id, target: l.终点id, 关联度: l.关联度 }))

  // 2. 运行更全面的物理排版
  let 模拟 = d3
    .forceSimulation<布局节点>(nodes)
    .force(
      'link',
      d3
        .forceLink<布局节点, 布局连接>(links)
        .id((节点) => 节点.id)
        .distance((连接) => Math.max(80, 300 - 连接.关联度 * 180))
        .strength((连接) => 0.05 + 连接.关联度 * 0.15),
    )
    .force('charge', d3.forceManyBody().strength(-800).distanceMax(1200))
    .force('center', d3.forceCenter(0, 0).strength(0.02))
    .force('collision', d3.forceCollide().radius(25).strength(0.8))
    .stop()

  // 运行较长时间以让全图舒展，迭代次数可以适当增加以求得更好的平衡
  for (let i = 0; i < 400; i++) {
    模拟.tick()
  }

  // 3. 批量更新数据库
  // 使用事务进行批量更新
  await 确保在事务中执行(数据库查询器, async (trx) => {
    for (let node of nodes) {
      await trx.updateTable('记忆表').set({ x: node.x, y: node.y }).where('id', '=', node.id).execute()
    }
  })
}
