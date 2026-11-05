import type { 公开记忆, 智能体事件 } from '@lsby/ai-memory'
import { 带记忆的智能体, 记忆等级 } from '@lsby/ai-memory'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import OpenAI from 'openai'
import { z } from 'zod'
import {
  formatTimestamp,
  loadGrowthEnv,
  parseGrowthCliOptions,
  sanitizeNoteForDir,
  setupTerminalMirrorLog,
} from './src/options'

let __dirname = path.dirname(fileURLToPath(import.meta.url))

function formatDuration(ms: number): string {
  let s = Math.floor(ms / 1000)
  let m = Math.floor(s / 60)
  let remS = s % 60
  if (m === 0) return `${String(remS)}s`
  return `${String(m)}m ${String(remS)}s`
}

function extractDatabaseFromZip(zipPath: string, targetStorageDir: string): void {
  let tempExtractDir = path.join(path.dirname(targetStorageDir), `_temp_unpack_${String(Date.now())}`)
  fs.mkdirSync(tempExtractDir, { recursive: true })
  try {
    childProcess.execSync(`tar.exe -xf "${zipPath}" -C "${tempExtractDir}"`)
    let findDbDir = (dir: string): string | undefined => {
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
    let foundDb = findDbDir(tempExtractDir)
    if (foundDb === undefined) {
      throw new Error(`在 ZIP 包中找不到 db 文件夹: ${zipPath}`)
    }
    fs.cpSync(foundDb, targetStorageDir, { recursive: true })
  } finally {
    fs.rmSync(tempExtractDir, { recursive: true, force: true })
  }
}

function resolveSourceDatabase(rawPath: string, outputDir: string): string {
  let dbBaselineDir = path.resolve(__dirname, '../db-baseline')
  let candidates = [
    rawPath,
    rawPath.endsWith('.zip') ? rawPath : `${rawPath}.zip`,
    path.resolve(process.cwd(), rawPath),
    path.resolve(process.cwd(), `${rawPath}.zip`),
    path.resolve(outputDir, rawPath),
    path.resolve(outputDir, `${rawPath}.zip`),
    path.resolve(outputDir, rawPath, 'db'),
    path.resolve(__dirname, rawPath),
    path.resolve(__dirname, `${rawPath}.zip`),
    path.resolve(__dirname, 'output', rawPath),
    path.resolve(__dirname, 'output', `${rawPath}.zip`),
    path.resolve(__dirname, 'output', rawPath, 'db'),
    path.resolve(dbBaselineDir, rawPath),
    path.resolve(dbBaselineDir, `${rawPath}.zip`),
  ]
  for (let c of candidates) {
    if (fs.existsSync(c) === true) {
      if (c.endsWith('.zip') === true && fs.statSync(c).isFile() === true) {
        return c
      }
      if (fs.existsSync(path.join(c, 'db')) === true && fs.statSync(path.join(c, 'db')).isDirectory() === true) {
        return path.join(c, 'db')
      }
      if (fs.statSync(c).isDirectory() === true) {
        return c
      }
    }
  }
  throw new Error(`找不到指定的预置数据库目录或 ZIP 包: ${rawPath}`)
}

async function runReorganizeBenchmark(): Promise<void> {
  let overallStartMs = Date.now()
  let options = parseGrowthCliOptions()
  let rounds = options.rounds > 0 ? options.rounds : 50

  let envPath = loadGrowthEnv(options.configName)
  console.log('=====================================================')
  console.log('🌌 智能体潜意识记忆重组与梦境巩固 (Memory Consolidation)')
  console.log('=====================================================')
  console.log(`[配置] 已载入环境: ${envPath}`)
  if (options.note !== undefined && options.note !== '') {
    console.log(`[备注] 本次运行说明: ${options.note}`)
  }

  let timestamp = formatTimestamp(new Date())
  let noteSlug = sanitizeNoteForDir(options.note)
  let runDirName = `${timestamp}-sample-${String(options.sampleIndex)}-reorganize-${String(rounds)}-rounds${noteSlug}`
  let runDir = path.resolve(__dirname, 'output', runDirName)
  let storageDir = path.join(runDir, 'db')

  fs.mkdirSync(runDir, { recursive: true })

  let logFilePath = path.join(runDir, 'run.log')
  let stopMirrorLog = setupTerminalMirrorLog(logFilePath)

  try {
    let rawFromDb =
      options.from ?? options.db ?? 'test/benchmark/growth/output/20261105-071113-sample-0-tutor-50-auto-persist/db'

    let sourceDbDir = resolveSourceDatabase(rawFromDb, path.resolve(__dirname, 'output'))

    let fullCmd = `pnpm tsx test/benchmark/growth/reorganize.ts --config=${options.configName ?? 'local'} --from-db="${sourceDbDir}" --rounds=${String(rounds)}${options.note !== undefined ? ` --note="${options.note}"` : ''}`
    fs.writeFileSync(path.join(runDir, 'command.txt'), `${fullCmd}\n`, 'utf-8')
    fs.writeFileSync(path.join(runDir, 'note.txt'), `${options.note ?? ''}\n`, 'utf-8')

    let commitHash = 'unknown'
    try {
      commitHash = childProcess.execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim()
    } catch {
      // 忽略 git 异常
    }
    fs.writeFileSync(path.join(runDir, 'commit.txt'), `${commitHash}\n`, 'utf-8')

    let targetBaseURL = options.baseUrl ?? process.env['TARGET_BASE_URL'] ?? 'http://localhost:11434/v1'
    let targetApiKey = options.apiKey ?? process.env['TARGET_API_KEY'] ?? 'ollama'
    let targetModel = options.model ?? process.env['TARGET_MODEL_NAME'] ?? 'gpt-oss-20b'

    console.log(`[配置] 被测模型: ${targetModel} @ ${targetBaseURL}`)
    console.log(`[配置] 重组轮数: ${String(rounds)} 场梦境`)
    console.log(`[存储] 演化数据库目录: ${storageDir}`)

    if (sourceDbDir.endsWith('.zip') === true) {
      console.log(`[复用] 从 ZIP 归档包解压并安全载入记忆库:`)
      console.log(`       源归档: ${sourceDbDir}`)
      console.log(`       新目录: ${storageDir}`)
      extractDatabaseFromZip(sourceDbDir, storageDir)
    } else {
      console.log(`[复用] 安全深拷贝已有记忆库 (绝不污染原数据库):`)
      console.log(`       源目录: ${sourceDbDir}`)
      console.log(`       新目录: ${storageDir}`)
      fs.cpSync(sourceDbDir, storageDir, { recursive: true })
    }

    let agent = new 带记忆的智能体({
      系统提示词:
        'You are an autonomous memory consolidation agent. During subconscious reorganization, you analyze connections between concepts, identify cross-session patterns, and consolidate valuable general rules into memory without forcing spurious links.',
      存储: { 模式: '文件', 路径: storageDir },
      向量模型: { 类型: '本地', 模型名称: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2' },
      博闻强记模式: true,
      博闻强记消息搜索数量: 20,
    })

    await agent.初始化()

    let client = new OpenAI({
      baseURL: targetBaseURL,
      apiKey: targetApiKey,
    })

    let initialMemories = await agent.查询记忆()
    let initialClues = await agent.查询线索()
    let initialEdges = await agent.查询记忆线索关联()

    let initialL1 = initialMemories.filter((m) => m.等级 === 记忆等级.一级).length
    let initialL2 = initialMemories.filter((m) => m.等级 === 记忆等级.二级).length

    console.log(`\n📊 重组前心智状态:`)
    console.log(
      `   - 一级记忆: ${String(initialL1)} 条 | 二级记忆: ${String(initialL2)} 条 | 总记忆: ${String(initialMemories.length)} 条`,
    )
    console.log(`   - 概念线索: ${String(initialClues.length)} 条 | 关联图边: ${String(initialEdges.length)} 条`)
    console.log(`\n--- 启动 ${String(rounds)} 轮潜意识梦境重组与概念关联整合 ---`)

    type DreamLog = {
      round: number
      seedClues: string[]
      toolCalls: Array<{ tool: string; args: Record<string, unknown> }>
      synthesizedInsight?: string | undefined
      memoriesDelta: number
    }

    let dreamLogs: DreamLog[] = []

    for (let r = 1; r <= rounds; r++) {
      let rStart = Date.now()
      let currentMemories = await agent.查询记忆()
      let memsBeforeRound = currentMemories.length

      // 1. 概念聚类选种：从现有记忆中选取一个核心记忆锚点及其相关联概念
      let anchorIndex = Math.floor(Math.random() * currentMemories.length)
      let anchorMem = currentMemories[anchorIndex]
      let seedClues: string[] = []
      let relatedMemories: 公开记忆[] = []

      if (anchorMem !== undefined) {
        relatedMemories.push(anchorMem)
        seedClues.push(...anchorMem.线索.slice(0, 3))

        let candidates = currentMemories.filter(
          (m) =>
            m.id !== anchorMem.id &&
            m.线索.some((c) =>
              anchorMem.线索.some(
                (ac) => ac.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(ac.toLowerCase()),
              ),
            ),
        )

        for (let rel of candidates.slice(0, 2)) {
          relatedMemories.push(rel)
          for (let rc of rel.线索) {
            if (seedClues.includes(rc) === false && seedClues.length < 5) {
              seedClues.push(rc)
            }
          }
        }
      }

      if (seedClues.length === 0) {
        seedClues = ['personality and habits', 'interpersonal relationship', 'life values']
      }

      let relatedMemoriesText =
        relatedMemories.length > 0
          ? relatedMemories
              .map((m, idx) => `[Memory #${String(idx + 1)} (${m.等级})]: ${m.内容} (Clues: ${m.线索.join(', ')})`)
              .join('\n')
          : '(No direct related memory loaded, use search_memories tool to explore related concepts)'

      let consolidationPrompt = [
        `## Subconscious Thematic Consolidation & Insight Synthesis`,
        `Focus Thematic Concepts: [${seedClues.join(', ')}]`,
        '',
        `Related Context Memories from Subconscious:`,
        relatedMemoriesText,
        '',
        'Task & Scientific Synthesis Guidelines:',
        '1. Analyze the deeper relationships, personality traits, character philosophies, emotional dynamics, or problem-solving patterns across these concepts.',
        '2. If these memories connect into a broader understanding (e.g. an overarching timeline, personal philosophy, core life values, emotional dynamics, or problem-solving strategy), synthesize a concise, high-value Level 2 insight (1-3 sentences).',
        '3. If you synthesize a genuine new insight or cross-event summary that is not already explicitly recorded, call `add_level_2_memory` with an importance score (85-95) and relevant clues to store it.',
        '4. Avoid shallow duplication: do not record trivial restatements of single existing facts.',
        '5. Finalize by returning whether a pattern was discovered, the synthesized insight, and your justification.',
      ].join('\n')

      let toolCalls: Array<{ tool: string; args: Record<string, unknown> }> = []

      let roundResult = await agent.私有反思({
        命令: consolidationPrompt,
        预期结果Schema: z.object({
          pattern_discovered: z
            .boolean()
            .describe('Whether a meaningful higher-level pattern or summary was discovered'),
          synthesized_insight: z
            .string()
            .describe('The synthesized rule, character profile insight, or thematic consolidation (or "None")'),
          justification: z.string().describe('Brief reasoning for the synthesis or why no new rule was needed'),
        }),
        预期结果描述: 'Subconscious thematic consolidation and higher-level insight synthesis',
        回调: async (event: 智能体事件): Promise<void> => {
          if (event.类型 === '工具调用开始') {
            toolCalls.push({ tool: event.工具名称, args: event.参数 })
            console.log(`   🛠️ [重组调用] ${event.工具名称} -> ${JSON.stringify(event.参数).slice(0, 100)}`)
          }
        },
        openai客户端: client,
        模型名称: targetModel,
        温度: 0.3,
        是否支持函数调用: options.useNativeToolCalls,
      })

      let patternDiscovered = roundResult.结果?.pattern_discovered === true
      let synthesizedInsight = roundResult.结果?.synthesized_insight ?? 'None'
      let memsAfterRound = (await agent.查询记忆()).length

      if (
        patternDiscovered === true &&
        synthesizedInsight.trim() !== '' &&
        synthesizedInsight !== 'None' &&
        memsAfterRound === memsBeforeRound
      ) {
        await agent.添加记忆({
          内容: synthesizedInsight.trim(),
          线索: seedClues,
          评分: 90,
          等级: 记忆等级.二级,
          创建时间: new Date(),
        })
        memsAfterRound = (await agent.查询记忆()).length
        console.log(`   💡 [自动落盘] 梦境提炼的新认知已入库: ${synthesizedInsight.slice(0, 100)}...`)
      }

      let memsDelta = memsAfterRound - memsBeforeRound

      console.log(
        `[第 ${String(r)}/${String(rounds)} 场梦] 聚类主题: [${seedClues.slice(0, 3).join(', ')}] | 提炼新模式: ${patternDiscovered ? '✅' : '➖'} | 记忆条目: ${String(memsBeforeRound)} ➔ ${String(memsAfterRound)} (${formatDuration(Date.now() - rStart)})`,
      )

      dreamLogs.push({
        round: r,
        seedClues,
        toolCalls,
        synthesizedInsight: patternDiscovered ? synthesizedInsight : undefined,
        memoriesDelta: memsDelta,
      })
    }

    let finalMemories = await agent.查询记忆()
    let finalClues = await agent.查询线索()
    let finalEdges = await agent.查询记忆线索关联()

    let finalL1 = finalMemories.filter((m) => m.等级 === 记忆等级.一级).length
    let finalL2 = finalMemories.filter((m) => m.等级 === 记忆等级.二级).length

    let newMemories = finalMemories.filter(
      (mFinal) => initialMemories.some((mInit) => mInit.id === mFinal.id) === false,
    )

    console.log('\n=====================================================')
    console.log(`🎉 潜意识重组完成！总耗时: ${formatDuration(Date.now() - overallStartMs)}`)
    console.log('=====================================================')
    console.log(`📊 重组后心智资产变动:`)
    console.log(
      `   - 一级工作记忆: ${String(initialL1)} ➔ ${String(finalL1)} 条 (${finalL1 >= initialL1 ? '+' : ''}${String(finalL1 - initialL1)})`,
    )
    console.log(
      `   - 二级长期潜意识: ${String(initialL2)} ➔ ${String(finalL2)} 条 (${finalL2 >= initialL2 ? '+' : ''}${String(finalL2 - initialL2)})`,
    )
    console.log(`   - 概念线索总数: ${String(initialClues.length)} ➔ ${String(finalClues.length)} 条`)
    console.log(`   - 关联图谱边数: ${String(initialEdges.length)} ➔ ${String(finalEdges.length)} 条`)
    console.log(`   - 新诞生总结/规则: ${String(newMemories.length)} 条`)

    if (newMemories.length > 0) {
      console.log(`\n🌟 ===== 梦境重组新提炼出的认知记忆 (${String(newMemories.length)} 条) =====`)
      for (let i = 0; i < newMemories.length; i++) {
        let nm = newMemories[i]
        if (nm === undefined) continue
        console.log(`[#${String(i + 1)}] 等级: ${nm.等级} | 评分: ${String(nm.评分)}`)
        console.log(`     线索: [${nm.线索.join(', ')}]`)
        console.log(`     内容: ${nm.内容}`)
      }
    } else {
      console.log('\n💡 本次 50 场梦境重组巩固了现有概念关联边，未生成新的冗余记忆项。')
    }

    // 生成总结报告 REPORT.md
    let reportLines = [
      '# 潜意识记忆重组与梦境巩固报告 (Memory Consolidation)',
      '',
      `- **执行时间**: ${new Date().toISOString()}`,
      `- **总耗时**: ${formatDuration(Date.now() - overallStartMs)}`,
      `- **来源数据库**: ${sourceDbDir}`,
      `- **重组后数据库**: \`${storageDir}\``,
      `- **重组轮数**: ${String(rounds)} 场梦境`,
      '',
      '## 核心心智大盘变动',
      '| 统计指标 | 重组前 | 重组后 | 净变动 |',
      '| :--- | :---: | :---: | :---: |',
      `| **一级工作记忆 (Level 1)** | ${String(initialL1)} 条 | ${String(finalL1)} 条 | ${finalL1 >= initialL1 ? '+' : ''}${String(finalL1 - initialL1)} |`,
      `| **二级长期记忆 (Level 2)** | ${String(initialL2)} 条 | ${String(finalL2)} 条 | ${finalL2 >= initialL2 ? '+' : ''}${String(finalL2 - initialL2)} |`,
      `| **总记忆条目** | ${String(initialMemories.length)} 条 | ${String(finalMemories.length)} 条 | ${finalMemories.length >= initialMemories.length ? '+' : ''}${String(finalMemories.length - initialMemories.length)} |`,
      `| **独立概念线索 (Clues)** | ${String(initialClues.length)} 条 | ${String(finalClues.length)} 条 | ${finalClues.length >= initialClues.length ? '+' : ''}${String(finalClues.length - initialClues.length)} |`,
      `| **图谱关联边 (Edges)** | ${String(initialEdges.length)} 条 | ${String(finalEdges.length)} 条 | ${finalEdges.length >= initialEdges.length ? '+' : ''}${String(finalEdges.length - initialEdges.length)} |`,
      '',
      '## 梦境重组新提炼的总结或法则',
      newMemories.length > 0
        ? newMemories
            .map(
              (m: 公开记忆, idx: number) =>
                `### ${String(idx + 1)}. [${m.等级}] 评分: ${String(m.评分)}\n- **线索**: \`[${m.线索.join(', ')}]\`\n- **内容**: ${m.内容}\n`,
            )
            .join('\n')
        : '- 本次 50 场梦境重组检验了潜意识随机概念关联，智能体判定已有法则足以解释现有概念，未强行捏造新规则，有效防范了认知冗余。',
      '',
      '## 50 场梦境记录摘要',
      '| 轮次 | 随机种子线索 | 工具调用次数 | 记忆净变动 |',
      '| :---: | :--- | :---: | :---: |',
      ...dreamLogs.map(
        (d) =>
          `| #${String(d.round)} | ${d.seedClues.join(', ')} | ${String(d.toolCalls.length)} 次 | ${d.memoriesDelta >= 0 ? '+' : ''}${String(d.memoriesDelta)} |`,
      ),
      '',
    ]

    fs.writeFileSync(path.join(runDir, 'REPORT.md'), reportLines.join('\n'), 'utf-8')
    console.log(`📁 详细总结报告已保存至: ${path.join(runDir, 'REPORT.md')}`)

    await agent.销毁()
  } finally {
    stopMirrorLog()
  }
}

runReorganizeBenchmark().catch((err: unknown) => {
  console.error('\n❌ 记忆重组过程中出现异常:', err)
  process.exit(1)
})
