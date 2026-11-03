import type { z } from 'zod'
import type { 模型语言包 } from '../../agent/model-language'
import type { 内部带记忆的解决问题选项 } from '../types'
import type { 会话控制器 } from './conversation-controller'

/** 在模型当轮上下文中只暴露直接上游会话 ID，原文仍需通过受限的消息搜索工具读取。 */
export async function 准备博闻强记选项<T extends z.ZodType>(
  控制器: 会话控制器,
  模型语言包: 模型语言包,
  选项: 内部带记忆的解决问题选项<T>,
): Promise<内部带记忆的解决问题选项<T>> {
  let 当前会话id = 控制器.当前会话id()
  if (当前会话id === null) return 选项
  let 当前会话 = await 控制器.读取当前会话()
  let 内部注入消息 = [...(选项.内部注入消息 ?? [])]
  if (当前会话.前驱会话id !== null) {
    内部注入消息.push({
      类型: 'recall-context',
      内容: 模型语言包.博闻强记上游会话?.(当前会话.前驱会话id) ?? `[博闻强记] 上游会话 ID: ${当前会话.前驱会话id}`,
      总是追加: true,
    })
  }
  return { ...选项, 当前会话id, 内部注入消息 }
}
