import type { 对话选项, 智能体消息类型 } from '../../agent/types'
import type { 公开会话, 压缩当前会话选项 } from '../types'
import type { 会话控制器 } from './conversation-controller'

export async function 执行压缩当前会话(
  控制器: 会话控制器,
  模型语言: 'zh-CN' | 'en-US',
  选项: 压缩当前会话选项,
): Promise<公开会话> {
  if (Number.isInteger(选项.目标字符数) === false || 选项.目标字符数 < 1) throw new Error('目标字符数必须是正整数')
  let 当前会话 = await 控制器.读取当前会话()
  if (当前会话.当前消息id === null) throw new Error('当前会话没有可压缩的消息')
  let 历史 = await 控制器.读取会话消息(当前会话.id)
  let 可摘要内容 = 历史
    .filter((消息) => 消息.消息.role !== 'system')
    .map((消息) => {
      let 内容 = 'content' in 消息.消息 ? 消息.消息.content : null
      return { role: 消息.消息.role, content: 内容, message_id: 消息.id }
    })
  let 要求 =
    模型语言 === 'en-US'
      ? `Summarize the conversation below in at most ${String(选项.目标字符数)} characters. Preserve decisions, constraints, unresolved work, exact identifiers, and important facts. Return only the summary.`
      : `将下面的对话压缩为不超过 ${String(选项.目标字符数)} 个字符的摘要。保留决定、约束、未完成事项、精确标识符和重要事实。只返回摘要。`
  let 响应 = await 选项.openai客户端.chat.completions.create({
    model: 选项.模型名称,
    messages: [
      { role: 'system', content: 要求 },
      { role: 'user', content: JSON.stringify(可摘要内容) },
    ],
    stream: false,
  })
  let 摘要 = 响应.choices[0]?.message.content?.trim()
  if (摘要 === undefined || 摘要 === '') throw new Error('摘要模型没有返回文本')
  if (摘要.length > 选项.目标字符数) throw new Error('摘要超过目标字符数，原会话未变更')
  return await 控制器.创建当前压缩派生会话(摘要, 选项.标题)
}

export async function 尝试自动压缩<T extends import('zod').z.ZodType>(
  控制器: 会话控制器,
  模型语言: 'zh-CN' | 'en-US',
  历史: 智能体消息类型[],
  自动压缩: { 触发字符数: number; 目标字符数: number } | undefined,
  选项: 对话选项<T>,
): Promise<void> {
  if (自动压缩 === undefined) return
  let 历史字符数 = 历史.reduce((总数, 消息) => 总数 + JSON.stringify(消息).length, 0)
  if (历史字符数 < 自动压缩.触发字符数) return
  try {
    await 执行压缩当前会话(控制器, 模型语言, {
      openai客户端: 选项.openai客户端,
      模型名称: 选项.模型名称,
      目标字符数: 自动压缩.目标字符数,
    })
  } catch (错误) {
    await 选项.回调({
      类型: '流程信息',
      内容: `自动压缩失败，已保留原会话: ${错误 instanceof Error ? 错误.message : String(错误)}`,
    })
  }
}
