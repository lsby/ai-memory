import childProcess from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { 公开记忆 } from '../../../src/index'
import { 带记忆的智能体, 记忆等级 } from '../../../src/index'
import { parseGrowthCliOptions } from './src/options'

function findDbDir(dir: string): string | undefined {
  let entries = fs.readdirSync(dir, { withFileTypes: true })
  for (let e of entries) {
    if (e.isDirectory() === true) {
      if (e.name === 'db') return path.join(dir, e.name)
      let nested = findDbDir(path.join(dir, e.name))
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

async function inspectDatabase(): Promise<void> {
  let options = parseGrowthCliOptions()
  let dbPath = options.db ?? options.from

  if (dbPath === undefined || dbPath.trim() === '') {
    console.error('❌ 请提供要检查的数据库路径: --db=<path>')
    console.log(
      '示例: pnpm tsx test/benchmark/growth/inspect.ts --db=test/benchmark/db-baseline/20261105-054945-sample-0-deepseek-inject.zip',
    )
    process.exit(1)
  }

  let resolvedDbPath = path.resolve(process.cwd(), dbPath)
  if (fs.existsSync(resolvedDbPath) === false && fs.existsSync(`${resolvedDbPath}.zip`) === true) {
    resolvedDbPath = `${resolvedDbPath}.zip`
  }
  if (fs.existsSync(resolvedDbPath) === false) {
    console.error(`❌ 找不到数据库路径: ${resolvedDbPath}`)
    process.exit(1)
  }

  let tempDirToClean: string | undefined = undefined
  let targetInspectDir = resolvedDbPath

  if (resolvedDbPath.endsWith('.zip') === true && fs.statSync(resolvedDbPath).isFile() === true) {
    let tempUnpack = path.join(os.tmpdir(), `inspect_zip_${String(Date.now())}`)
    fs.mkdirSync(tempUnpack, { recursive: true })
    childProcess.execSync(`tar.exe -xf "${resolvedDbPath}" -C "${tempUnpack}"`)
    let locatedDb = findDbDir(tempUnpack)
    if (locatedDb === undefined) {
      fs.rmSync(tempUnpack, { recursive: true, force: true })
      throw new Error(`在 ZIP 包中找不到 db 文件夹: ${resolvedDbPath}`)
    }
    targetInspectDir = locatedDb
    tempDirToClean = tempUnpack
  } else if (
    fs.existsSync(path.join(resolvedDbPath, 'db')) === true &&
    fs.statSync(path.join(resolvedDbPath, 'db')).isDirectory() === true
  ) {
    targetInspectDir = path.join(resolvedDbPath, 'db')
  }

  console.log('=====================================================')
  console.log(`🔍 智能体记忆透视镜 (0 Token 极速检测)`)
  console.log(`📁 目标数据库: ${resolvedDbPath}`)
  console.log('=====================================================')

  let agent = new 带记忆的智能体({
    存储: { 模式: '文件', 路径: targetInspectDir },
    向量模型: { 类型: '无' },
  })

  try {
    await agent.初始化()

    let allMemories = await agent.查询记忆()
    let level1Memories = allMemories.filter((m: 公开记忆) => m.等级 === 记忆等级.一级)
    let level2Memories = allMemories.filter((m: 公开记忆) => m.等级 === 记忆等级.二级)
    let allClues = await agent.查询线索()
    let clueLinks = await agent.查询记忆线索关联()
    let allSkills = await agent.查询技能()

    console.log(`\n📊 记忆统计概要:`)
    console.log(`   - 一级记忆 (Level 1 工作记忆): ${String(level1Memories.length)} 条`)
    console.log(`   - 二级记忆 (Level 2 长期法则): ${String(level2Memories.length)} 条`)
    console.log(`   - 独立线索库 (Clues 概念池):  ${String(allClues.length)} 条`)
    console.log(`   - 记忆线索关联边 (Edges):    ${String(clueLinks.length)} 条`)
    console.log(`   - 智能体自制技能 (Skills):    ${String(allSkills.length)} 个`)

    if (level2Memories.length === 0) {
      console.log('\n💡 [提示] 当前数据库中暂无 Level 2 长期记忆法则。')
    } else {
      console.log(`\n🧠 ===== Level 2 长期法则与认知理论 (${String(level2Memories.length)} 条) =====`)
      for (let i = 0; i < level2Memories.length; i++) {
        let mem = level2Memories[i]
        if (mem === undefined) continue
        let clueStr = mem.线索.length > 0 ? mem.线索.join(', ') : '(无显式关联线索)'
        console.log(
          `\n[#${String(i + 1)}] 记忆 ID: ${mem.id} | 评分: ${String(mem.评分)} | 记录时间: ${mem.创建时间.toISOString()}`,
        )
        console.log(`     线索: [ ${clueStr} ]`)
        console.log(`     内容: ${mem.内容}`)
      }
    }

    if (allSkills.length > 0) {
      console.log(`\n🛠️  ===== 智能体自制技能系统 (${String(allSkills.length)} 个) =====`)
      for (let i = 0; i < allSkills.length; i++) {
        let s = allSkills[i]
        if (s === undefined) continue
        console.log(`\n[#${String(i + 1)}] 技能: ${s.名称} (ID: ${s.id})`)
        console.log(`     描述: ${s.描述}`)
        console.log(`     线索: [ ${s.线索.join(', ')} ]`)
      }
    }

    console.log('\n=====================================================')
    console.log('✅ 记忆透视检查完毕！')
  } finally {
    await agent.销毁()
    if (tempDirToClean !== undefined) {
      fs.rmSync(tempDirToClean, { recursive: true, force: true })
    }
  }
}

inspectDatabase().catch((err) => {
  console.error('❌ 检查发生异常:', err)
  process.exit(1)
})
