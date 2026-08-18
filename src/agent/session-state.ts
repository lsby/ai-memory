import { z } from 'zod'
import { 智能体消息Schema, type 智能体消息类型 } from './types'

export let 智能体状态Schema = z.object({
  格式版本: z.literal(2),
  会话标识: z.string().optional(),
  消息历史: z.array(智能体消息Schema),
})

export function 复制消息列表(消息列表: 智能体消息类型[]): 智能体消息类型[] {
  return z.array(智能体消息Schema).parse(消息列表)
}

export function 提取可见消息(消息列表: 智能体消息类型[]): 智能体消息类型[] {
  return 复制消息列表(
    消息列表.filter(
      (消息) => 消息.role !== 'user' || (消息.isSystemCorrection !== true && 消息.isSystemInjection !== true),
    ),
  )
}
