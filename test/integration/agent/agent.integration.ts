import { z } from 'zod'
import { 智能体 } from '../../../src/agent/agent'
import { 智能体事件, 智能体工具 } from '../../../src/agent/types'
import { baseURL, model, 创建客户端, 检查环境变量 } from '../test-helper'

检查环境变量()

// ============================================================
// 工具1: 天气查询 (模拟数据)
// ============================================================

let 天气数据: Record<string, { 温度: number; 天气: string; 湿度: number }> = {
  北京: { 温度: 28, 天气: '晴', 湿度: 45 },
  上海: { 温度: 32, 天气: '多云', 湿度: 78 },
  东京: { 温度: 26, 天气: '阴', 湿度: 65 },
  纽约: { 温度: 22, 天气: '小雨', 湿度: 82 },
  伦敦: { 温度: 18, 天气: '阴', 湿度: 70 },
  巴黎: { 温度: 24, 天气: '晴', 湿度: 55 },
}

let 天气查询工具 = 智能体工具.创建({
  名称: 'get_weather',
  描述: '查询指定城市的当前天气信息, 包括温度、天气状况和湿度',
  参数Schema: z.object({ 城市: z.string().describe('城市名称, 例如 "北京"、"东京"') }),
  返回值Schema: z.object({
    结果: z.enum(['成功', '失败']),
    城市: z.string().optional(),
    温度: z.number().optional(),
    天气: z.string().optional(),
    湿度: z.number().optional(),
    错误: z.string().optional(),
  }),
  返回值描述: '返回 { 温度: number, 天气: string, 湿度: number } 或 { 错误: string }',
  实现: async (参数) => {
    let 数据 = 天气数据[参数.城市] ?? null
    if (数据 === null)
      return {
        结果: '失败',
        错误: `未找到城市 "${参数.城市}" 的天气数据, 支持的城市: ${Object.keys(天气数据).join(', ')}`,
      }
    return { 结果: '成功', 城市: 参数.城市, ...数据 }
  },
})

// ============================================================
// 工具2: 汇率查询 (模拟数据)
// ============================================================

let 汇率表: Record<string, Record<string, number>> = {
  CNY: { USD: 0.14, JPY: 19.8, EUR: 0.13, GBP: 0.11 },
  USD: { CNY: 7.15, JPY: 141.5, EUR: 0.92, GBP: 0.79 },
  JPY: { CNY: 0.051, USD: 0.0071, EUR: 0.0065, GBP: 0.0056 },
  EUR: { CNY: 7.78, USD: 1.09, JPY: 153.2, GBP: 0.86 },
}

let 汇率查询工具 = 智能体工具.创建({
  名称: 'get_exchange_rate',
  描述: '查询两种货币之间的汇率',
  参数Schema: z.object({
    原始货币: z.string().describe('货币代码, 例如 CNY, USD, JPY, EUR, GBP'),
    目标货币: z.string().describe('货币代码, 例如 CNY, USD, JPY, EUR, GBP'),
  }),
  返回值Schema: z.object({
    结果: z.enum(['成功', '失败']),
    原始货币: z.string().optional(),
    目标货币: z.string().optional(),
    汇率: z.number().optional(),
    错误: z.string().optional(),
  }),
  返回值描述: '返回 { 汇率: number } 表示 1 单位原始货币等于多少目标货币',
  实现: async (参数) => {
    if (参数.原始货币 === 参数.目标货币) return { 结果: '成功', 汇率: 1 }
    let 汇率 = 汇率表[参数.原始货币]?.[参数.目标货币] ?? null
    if (汇率 === null) return { 结果: '失败', 错误: `不支持 ${参数.原始货币} → ${参数.目标货币} 的汇率查询` }
    return { 结果: '成功', 原始货币: 参数.原始货币, 目标货币: 参数.目标货币, 汇率 }
  },
})

// ============================================================
// 工具3: 计算器
// ============================================================

let 计算器工具 = 智能体工具.创建({
  名称: 'calculator',
  描述: '执行数学运算, 支持加减乘除和括号',
  参数Schema: z.object({ 表达式: z.string().describe('数学表达式, 例如 "2 + 3 * 4"') }),
  返回值Schema: z.object({
    结果: z.enum(['成功', '失败']),
    计算结果: z.number().optional(),
    错误: z.string().optional(),
  }),
  返回值描述: '返回 { 计算结果: number }',
  实现: async (参数) => {
    try {
      let 计算结果 = new Function(`return (${参数.表达式})`)() as number
      return { 结果: '成功', 计算结果 }
    } catch {
      return { 结果: '失败', 错误: '无法计算该表达式' }
    }
  },
})

// ============================================================
// 复杂的预期结果 Schema
// ============================================================

let 旅行报告Schema = z.object({
  目的地列表: z.array(
    z.object({
      城市: z.string(),
      天气概况: z.string(),
      适合旅行: z.boolean(),
      不适合原因: z.string().optional().nullable(),
    }),
  ),
  预算: z.object({
    总费用人民币: z.number(),
    费用明细: z.array(z.object({ 项目: z.string(), 金额: z.number(), 货币: z.string() })),
  }),
  推荐城市: z.string(),
  推荐理由: z.string(),
})

// ============================================================
// 创建智能体
// ============================================================

let agent = new 智能体({
  工具列表: [天气查询工具, 汇率查询工具, 计算器工具],
  系统提示词: [
    '你是一个旅行规划助手。',
    '你可以查询天气、汇率和做数学计算来帮助用户规划旅行。',
    '请务必使用工具获取实际数据, 不要编造天气和汇率数据。',
  ].join('\n'),
  最大校验重试次数: 3,
  最大循环轮次: 15,
  请求AI时间间隔ms: 5000,
})

// ============================================================
// 事件回调
// ============================================================

let 事件处理 = async (事件: 智能体事件): Promise<void> => {
  switch (事件.类型) {
    case 'AI文本片段':
      process.stdout.write(事件.内容)
      break
    case '工具调用开始':
      console.log(`\n🔧 调用工具: ${事件.工具名称}`, JSON.stringify(事件.参数))
      break
    case '工具调用结果':
      console.log(`✅ 工具结果:`, JSON.stringify(事件.结果), `(${String(事件.耗时ms)}ms)`)
      break
    case '工具调用失败':
      console.log(`❌ 工具失败: ${事件.工具名称} - ${事件.错误信息}`)
      break
    case '校验失败':
      console.log(`\n⚠️ 校验失败 (${String(事件.当前次数)}/${String(事件.最大次数)}): ${事件.错误信息}`)
      break
    case '最终结果':
      console.log('\n📦 最终结果:', JSON.stringify(事件.结果, null, 2))
      break
    case '流程信息':
      console.log(`\n💬 ${事件.内容}`)
      break
    case '错误':
      console.error(`\n❌ 错误: ${事件.错误信息}`)
      break
    case '原始请求配置':
      console.log(`\n⚙️ 调试 - 原始请求配置:`, JSON.stringify(事件.配置, null, 2))
      break
    case '原始AI返回':
      console.log(
        `\n⚙️ 调试 - 原始AI返回数据:`,
        JSON.stringify({ 完整文本: 事件.完整文本, 工具调用列表: 事件.工具调用列表 }, null, 2),
      )
      break
  }
}

// ============================================================
// 运行测试
// ============================================================

let 运行测试 = async (): Promise<void> => {
  let openai客户端 = 创建客户端()

  console.log('='.repeat(60))
  console.log('智能体多工具测试 — 旅行规划助手')
  console.log(`模型: ${model}  |  API: ${baseURL}`)
  console.log('='.repeat(60))

  let 命令 = [
    '我想去东京和巴黎旅行, 帮我做一个对比报告:',
    '1. 查询这两个城市的天气, 判断是否适合旅行(温度20-30度且非雨天算适合)',
    '2. 假设东京花费 50000 日元, 巴黎花费 300 欧元, 帮我算算折合人民币分别是多少, 以及总费用',
    '3. 综合天气和费用, 推荐一个更适合的城市',
  ].join('\n')

  console.log(`\n📝 用户命令:\n${命令}\n`)

  try {
    let 结果 = await agent.对话({
      命令,
      预期结果Schema: 旅行报告Schema,
      预期结果描述: '旅行对比报告, 包含每个城市的天气评估、费用预算明细(人民币)、和最终推荐',
      回调: 事件处理,
      openai客户端,
      模型名称: model,
    })

    console.log('\n' + '='.repeat(60))
    console.log('最终返回值:')
    console.log(JSON.stringify(结果, null, 2))
    console.log('='.repeat(60))
  } catch (error) {
    console.error('\n执行失败:', error instanceof Error ? error.message : String(error))
  }
}

await 运行测试()
