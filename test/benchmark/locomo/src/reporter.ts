import { formatDuration } from './options'
import type { LocomoAuditStats, LocomoBenchmarkSummary, LocomoBenchmarkTiming } from './types'

export interface PrintBenchmarkReportOptions {
  summary: LocomoBenchmarkSummary
  timing: LocomoBenchmarkTiming
  auditStats: LocomoAuditStats
  configName?: string | undefined
  sourceDbDir?: string | undefined
  note?: string | undefined
  reorganizeRounds?: number | undefined
  reorganizeTimeMs?: number | undefined
}

export function printBenchmarkReport(options: PrintBenchmarkReportOptions): void {
  let { summary, timing, auditStats, configName, sourceDbDir, note, reorganizeRounds, reorganizeTimeMs } = options

  console.log('\n=====================================================')
  console.log('📊 LoCoMo 记忆评测成绩单')
  console.log('=====================================================')
  if (configName !== undefined) {
    console.log(`使用配置: ${configName}`)
  }
  if (sourceDbDir !== undefined) {
    console.log(`复用数据库: ${sourceDbDir}`)
  }
  if (note !== undefined && note !== '') {
    console.log(`本次备注: ${note}`)
  }
  if (reorganizeRounds !== undefined && reorganizeRounds > 0) {
    console.log(`潜意识重组: 开启 (${String(reorganizeRounds)} 轮梦境重组)`)
  }
  console.log(`总题目数: ${String(summary.totalQuestions)}`)
  console.log(`正确数: ${String(summary.correctCount)}`)
  console.log(`总正确率: ${summary.accuracy.toFixed(2)}%`)
  console.log('-----------------------------------------------------')
  console.log('分题型正确率统计:')
  let catNames: Record<number, string> = {
    1: 'Multi-hop (多跳关联)',
    2: 'Single-hop (单跳回忆)',
    3: 'Temporal (时序推理)',
    4: 'Open-domain (常识结合)',
    5: 'Adversarial (防幻觉)',
  }
  for (let [cat, data] of Object.entries(summary.byCategory)) {
    let name = catNames[Number(cat)] ?? `Category ${cat}`
    console.log(`  - ${name.padEnd(25)}: ${String(data.correct)}/${String(data.total)} (${data.accuracy.toFixed(1)}%)`)
  }
  console.log('-----------------------------------------------------')
  console.log('⏱️ 耗时与性能统计:')
  console.log(
    `  - 记忆摄取耗时: ${formatDuration(timing.ingestTimeMs)} (平均每会话: ${formatDuration(timing.avgSessionTimeMs)})`,
  )
  if (reorganizeTimeMs !== undefined && reorganizeTimeMs > 0) {
    console.log(
      `  - 记忆重组耗时: ${formatDuration(reorganizeTimeMs)} (平均每轮: ${formatDuration(Math.round(reorganizeTimeMs / (reorganizeRounds ?? 1)))})`,
    )
  }
  console.log(
    `  - QA 作答耗时  : ${formatDuration(timing.answerTimeMs)} (平均每题: ${formatDuration(timing.avgQATimeMs)})`,
  )
  console.log(`  - 裁判阅卷耗时: ${formatDuration(timing.judgeTimeMs)}`)
  console.log(`  - 评测总耗时  : ${formatDuration(timing.totalTimeMs)}`)
  console.log('-----------------------------------------------------')
  console.log('🔍 框架内置心智审计看板:')
  console.log(`  - 沉淀记忆总数: ${String(auditStats.memoryStats.total)} 条`)
  console.log(`    ├── 零级常驻记忆: ${String(auditStats.memoryStats.level0)} 条`)
  console.log(`    ├── 一级工作记忆: ${String(auditStats.memoryStats.level1)} 条`)
  console.log(`    └── 二级潜意识网: ${String(auditStats.memoryStats.level2)} 条`)
  console.log(`  - 模型调用总计: ${String(auditStats.modelAudit.模型请求次数)} 次`)
  console.log(`    ├── 新建对话: ${String(auditStats.modelAudit.新建对话请求次数)} 次`)
  console.log(`    └── 缓存复用: ${String(auditStats.modelAudit.缓存复用请求次数)} 次`)
  console.log(
    `  - 吞吐字符数  : 发出 ${String(auditStats.modelAudit.发出字符数)} 字 / 接收 ${String(auditStats.modelAudit.返回字符数)} 字`,
  )
  if (auditStats.modelAudit.token用量.请求次数 > 0) {
    console.log(
      `  - Token 用量  : 输入 ${String(auditStats.modelAudit.token用量.输入token数)} / 输出 ${String(auditStats.modelAudit.token用量.输出token数)} / 缓存命中 ${String(auditStats.modelAudit.token用量.缓存命中token数)}`,
    )
  }
  console.log('=====================================================\n')
}
