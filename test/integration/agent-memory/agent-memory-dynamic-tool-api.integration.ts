import { z } from 'zod'
import { 带记忆的智能体 } from '../../../src/agent-memory/agent-memory'
import { model, 事件处理, 创建客户端, 打印分隔线, 检查环境变量 } from '../test-helper'

// ============================================================
// 测试场景: 手动注入动态工具及自动召回能力
//
// 目标:
// 1. 验证通过编程 API `注册动态工具` 直接注入纯代码工具是否生效。
// 2. 验证大模型在没有任何刻意引导的情况下，能否根据系统自动插入的「动态工具召回」上下文，
//    自主发现并调用这个刚刚通过 API 注入的工具。
// ============================================================

async function 运行测试(): Promise<void> {
  检查环境变量()
  let 客户端 = 创建客户端()

  let 智能体 = new 带记忆的智能体({
    系统提示词: '你是一个乐于助人的 AI 助手。',
    工具列表: [], // 初始不包含其他业务工具
    最大循环轮次: 5,
    向量模型: { 类型: '本地' },
    存储: { 模式: '内存' },
    自动检索动态工具数量: 3, // 开启自动召回
  })

  // 必须初始化
  await 智能体.初始化()

  打印分隔线('第一步：通过代码 API 手动注册一个「运费计算器」动态工具')

  let 工具代码 = `
工具 = {
  名称: "calculate_shipping_fee",
  描述: "计算包裹的快递运费。根据物品重量和运输距离进行自动计费。",
  参数Schema: {
    type: "object",
    properties: {
      weight_kg: { type: "number", description: "物品重量(千克)" },
      distance_km: { type: "number", description: "运输距离(千米)" }
    },
    required: ["weight_kg", "distance_km"]
  },
  返回值Schema: {
    type: "object",
    properties: {
      fee: { type: "number", description: "最终运费" }
    },
    required: ["fee"]
  },
  实现: async function(参数) {
    let weight = 参数.weight_kg ?? 参数['重量kg'] ?? 参数.重量;
    let distance = 参数.distance_km ?? 参数['距离km'] ?? 参数.距离;
    // 计费规则：首重1kg内10元，续重每kg 5元(向上取整)
    let baseFee = 10;
    if (weight > 1) {
      baseFee += Math.ceil(weight - 1) * 5;
    }
    // 距离超过1000km，总价加收 20% 的长途费
    if (distance > 1000) {
      baseFee *= 1.2;
    }
    return { fee: Math.round(baseFee * 100) / 100 };
  }
};
`
  // 提供一组测试参数让系统进行沙盒校验
  let 测试参数 = JSON.stringify({ weight_kg: 2.5, distance_km: 1500 })

  let 注册结果 = await 智能体.注册动态工具(工具代码, 测试参数, 事件处理)

  if (注册结果.结果 === '失败') {
    console.error('❌ 工具注册失败:', 注册结果.错误信息)
    return
  }
  console.log('\n🌟 阶段一完成: 编程注入动态工具成功! ID:', 注册结果.id, ' 测试输出:', 注册结果.测试执行输出)

  打印分隔线('第二步：发起提问测试召回，不提示工具名称')

  let 调用结果 = await 智能体.对话({
    命令: '你好，我有一个快递要寄。物品重量大概是 2.5 公斤，目的地距离这里大约 1500 公里。你能帮我算算大概要花多少钱运费吗？',
    预期结果Schema: z.object({
      运费结果: z.number().describe('计算出的最终运费'),
      计算解释: z.string().describe('说明是如何计算出来的'),
    }),
    预期结果描述: '给出精确的运费计算结果',
    回调: 事件处理,
    openai客户端: 客户端,
    模型名称: model,
    当前时间: new Date(),
  })

  console.log('\n🌟 阶段二完成: 测试结果为:', 调用结果.结果)

  await 智能体.销毁()
}

await 运行测试()
