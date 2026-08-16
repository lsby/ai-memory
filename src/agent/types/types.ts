import { z } from 'zod'

export let 通用智能体WebSocket事件Schema = z.object({
  type: z.enum([
    'text',
    'toolCallStart',
    'toolCallResult',
    'toolCallError',
    'validateFail',
    'agentError',
    'agentComplete',
    'initState',
  ]),
  data: z.string(),
})

export type 通用智能体WebSocket事件 = z.infer<typeof 通用智能体WebSocket事件Schema>

export let 通用智能体WebSocket中断Schema = z.object({ type: z.enum(['interrupt', 'attach']) })
export type 通用智能体WebSocket中断 = z.infer<typeof 通用智能体WebSocket中断Schema>
