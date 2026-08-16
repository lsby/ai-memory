import { z } from 'zod'

export let 记忆智能体WebSocket事件Schema = z.union([
  z.object({ type: z.literal('log'), message: z.string() }),
  z.object({
    type: z.literal('search_hit'),
    data: z.object({ nodes: z.array(z.object({ id: z.string(), x: z.number(), y: z.number() })) }),
  }),
  z.object({ type: z.literal('search_link'), data: z.object({ source: z.string(), target: z.string() }) }),
  z.object({ type: z.literal('reply_chunk'), text: z.string() }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({ type: z.literal('done'), memoryUsed: z.array(z.string()) }),
])

export type 记忆智能体WebSocket事件 = z.infer<typeof 记忆智能体WebSocket事件Schema>

export let 记忆智能体WebSocket中断Schema = z.object({ type: z.enum(['interrupt']) })
export type 记忆智能体WebSocket中断 = z.infer<typeof 记忆智能体WebSocket中断Schema>
