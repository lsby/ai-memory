import OpenAI from 'openai'
import type { 智能体事件 } from '../../src/agent/types'

// 集成测试使用的模型配置。运行测试前请按本地环境修改这里。
export let apiKey = process.env['AI_KEY'] ?? ''
export let baseURL = process.env['AI_BASE_URL'] ?? ''
export let model = process.env['AI_MODEL'] ?? ''

export function 检查环境变量(): void {
  if (apiKey === '' || baseURL === '' || model === '') {
    console.error('请设置环境变量: AI_KEY, AI_BASE_URL, AI_MODEL')
    process.exit(1)
  }
}

export function 创建客户端(): OpenAI {
  return new OpenAI({ apiKey, baseURL })
}

export let 事件处理 = async (事件: 智能体事件): Promise<void> => {
  switch (事件.类型) {
    case 'AI文本片段': {
      process.stdout.write(事件.内容)
      break
    }
    case '工具调用开始': {
      console.log(`\n🔧 调用工具: ${事件.工具名称}`, JSON.stringify(事件.参数, null, 2))
      break
    }
    case '工具调用结果': {
      console.log(`✅ 工具结果:`, JSON.stringify(事件.结果), `(${String(事件.耗时ms)}ms)`)
      break
    }
    case '工具调用失败': {
      console.log(`❌ 工具失败: ${事件.工具名称} - ${事件.错误信息}`)
      break
    }
    case '校验失败': {
      console.log(`\n⚠️ 校验失败 (${String(事件.当前次数)}/${String(事件.最大次数)}): ${事件.错误信息}`)
      break
    }
    case '最终结果': {
      console.log('\n📦 最终结果:', JSON.stringify(事件.结果, null, 2))
      break
    }
    case '流程信息': {
      console.log(`\n💬 ${事件.内容}`)
      break
    }
    case '错误': {
      console.error(`\n❌ 错误: ${事件.错误信息}`)
      break
    }
    case '原始请求配置':
    case '原始AI返回': {
      break
    }
  }
}

export function 打印分隔线(标题: string): void {
  console.log('\n' + '='.repeat(60))
  console.log(标题)
  console.log('='.repeat(60))
}
