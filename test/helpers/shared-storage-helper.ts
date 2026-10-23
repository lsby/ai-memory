import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import OpenAI from 'openai'

export function 创建带向量的PGlite(): PGlite {
  return new PGlite({ extensions: { vector } })
}

/** 超时就报错，用来检测死锁、卡死。 */
export async function 限时<T>(任务: Promise<T>, 毫秒: number, 描述: string): Promise<T> {
  let 定时器: NodeJS.Timeout | undefined
  let 超时 = new Promise<never>((_resolve, reject) => {
    定时器 = setTimeout(() => reject(new Error(`超时(${String(毫秒)}ms)，疑似死锁或卡死: ${描述}`)), 毫秒)
  })
  try {
    return await Promise.race([任务, 超时])
  } finally {
    if (定时器 !== undefined) clearTimeout(定时器)
  }
}

export async function 等待(毫秒: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 毫秒))
}

/** 把文本变成确定的 4 维向量。 */
export function 文本转向量(文本: string): number[] {
  let 总和 = [0, 0, 0, 0]
  for (let i = 0; i < 文本.length; i++) {
    let 下标 = i % 4
    总和[下标] = (总和[下标] ?? 0) + 文本.charCodeAt(i)
  }
  return 总和.map((值) => 值 / (文本.length + 1) / 1000)
}

/** openai SDK 默认要求 base64 编码的向量，这里按同样的格式返回。 */
function 编码向量(向量: number[]): string {
  return Buffer.from(new Float32Array(向量).buffer).toString('base64')
}

export type 假向量请求记录 = { 文本: string; 开始时间: number; 结束时间: number; 句柄被占用: boolean }

/**
 * 假的向量接口：按文本决定延迟。每次请求开始时探测一次 PGlite 是否可用，
 * 如果探测查询 300ms 内没返回，说明此刻有人占着事务/连接，记为“句柄被占用”。
 */
export function 创建假向量客户端(选项: {
  延迟毫秒?: (文本: string) => number
  探测句柄?: PGlite
  记录?: 假向量请求记录[]
}): OpenAI {
  return new OpenAI({
    apiKey: 'test',
    baseURL: 'http://fake-embedding.local/v1',
    maxRetries: 0,
    fetch: async (_地址, 初始化): Promise<Response> => {
      let 请求体: unknown = JSON.parse(String(初始化?.body))
      let 输入 = typeof 请求体 === 'object' && 请求体 !== null && 'input' in 请求体 ? 请求体.input : ''
      let 文本 = typeof 输入 === 'string' ? 输入 : ''
      let 开始时间 = Date.now()
      let 句柄被占用 = false
      if (选项.探测句柄 !== undefined) {
        let 探测结果 = await Promise.race([
          选项.探测句柄.query('SELECT 1').then((): boolean => true),
          等待(300).then((): boolean => false),
        ])
        句柄被占用 = 探测结果 === false
      }
      await 等待(选项.延迟毫秒?.(文本) ?? 0)
      选项.记录?.push({ 文本, 开始时间, 结束时间: Date.now(), 句柄被占用 })
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [{ object: 'embedding', index: 0, embedding: 编码向量(文本转向量(文本)) }],
          model: 'fake',
          usage: { prompt_tokens: 1, total_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    },
  })
}
