import type { 智能体回调, 智能体消息类型, 模型请求上下文 } from '../types'

export function 创建模型请求回调(回调: 智能体回调, 上下文: 模型请求上下文): 智能体回调 {
  return async (事件): Promise<void> => {
    if (事件.类型 === '工具调用开始' || 事件.类型 === '工具调用结果' || 事件.类型 === '工具调用失败') {
      await 回调({
        ...事件,
        模型请求id: 上下文.id,
        模型请求序号: 上下文.序号,
        前缀id: 上下文.前缀id,
      })
      return
    }
    await 回调(事件)
  }
}

export function 创建模型响应记录器(选项: {
  回调: 智能体回调
  上下文: 模型请求上下文
  消息列表: 智能体消息类型[]
  消息起点: number
  读取工具调用数量: () => number
}): (状态: '完成' | '中断' | '空响应') => Promise<void> {
  let 是否已记录 = false
  return async (状态): Promise<void> => {
    if (是否已记录 === true) return
    let 响应消息 = 选项.消息列表.slice(选项.消息起点).find((消息) => 消息.role === 'assistant')
    await 选项.回调({
      类型: '模型响应完成',
      模型请求id: 选项.上下文.id,
      模型请求序号: 选项.上下文.序号,
      前缀id: 选项.上下文.前缀id,
      状态,
      ...(响应消息?.持久化消息id !== undefined ? { 响应消息id: 响应消息.持久化消息id } : {}),
      工具调用数量: 选项.读取工具调用数量(),
    })
    是否已记录 = true
  }
}
