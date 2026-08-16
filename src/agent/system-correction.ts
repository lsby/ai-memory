import type { 智能体消息类型 } from './types'

/**
 * 向消息列表中追加一条系统纠正的 user 消息。
 * 直接推进纯净的错误信息，不在 content 中拼接任何人工前缀，
 * 保持发送给大模型的 Prompt 纯净无污染。
 */
export let 追加系统纠正消息 = (消息列表: 智能体消息类型[], 助手文本: string | null, 纠正内容: string): void => {
  if (助手文本 !== null && 助手文本.trim() !== '') {
    消息列表.push({ role: 'assistant', content: 助手文本 })
  }

  let 纠正消息: 智能体消息类型 = { role: 'user', content: 纠正内容, isSystemCorrection: true }
  消息列表.push(纠正消息)
}
