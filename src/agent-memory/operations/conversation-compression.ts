import { sql } from 'kysely'
import type OpenAI from 'openai'
import { z } from 'zod'
import type { 模型语言包 } from '../../agent/model-language'
import type { 智能体消息类型 } from '../../agent/types'
import { 统计字符数 } from '../../agent/utils/audit'
import { 校验并复制额外请求参数 } from '../../agent/utils/extra-request-params'
import { 创建事件组id, 记录交互日志 } from '../logger'
import type { 公开会话, 压缩当前会话选项, 带事件组的对话选项, 带记忆的对话选项, 自动压缩配置 } from '../types'
import type { 会话控制器 } from './conversation-controller'

type 压缩入口 = '自动压缩' | '手动压缩'
type 失败原因 = '超时' | '中断' | '其他'

type 内部压缩参数 = {
  入口: 压缩入口
  超时毫秒?: number | undefined
  /** 自动压缩按触发判断用的口径传入; 不传则按持久化的历史消息计算 */
  历史字符数?: number | undefined
}

function 计算历史字符数(消息列表: 智能体消息类型[]): number {
  return 消息列表.reduce((总数, 消息) => 总数 + JSON.stringify(消息).length, 0)
}

function 判定失败原因(调用方信号: AbortSignal | undefined, 超时信号: AbortSignal | undefined): 失败原因 {
  if (调用方信号?.aborted === true) return '中断'
  if (超时信号?.aborted === true) return '超时'
  return '其他'
}

/** 等待任务完成, 但信号到点时立刻放弃等待(即使客户端不认信号), 避免压缩卡死。 */
async function 带信号等待<T>(启动: () => Promise<T>, 信号: AbortSignal | undefined): Promise<T> {
  if (信号 === undefined) return await 启动()
  if (信号.aborted === true) throw 信号.reason
  let 监听: (() => void) | undefined
  let 中止 = new Promise<never>((_解决, 拒绝): void => {
    监听 = (): void => 拒绝(信号.reason)
    信号.addEventListener('abort', 监听, { once: true })
  })
  try {
    return await Promise.race([启动(), 中止])
  } finally {
    if (监听 !== undefined) 信号.removeEventListener('abort', 监听)
  }
}

export async function 执行压缩当前会话(
  控制器: 会话控制器,
  模型语言包: 模型语言包,
  选项: 压缩当前会话选项,
  内部: 内部压缩参数 = { 入口: '手动压缩' },
): Promise<公开会话> {
  if (Number.isInteger(选项.目标字符数) === false || 选项.目标字符数 < 1) throw new Error('目标字符数必须是正整数')
  let 额外请求参数 = 校验并复制额外请求参数(选项.额外请求参数)
  let 事件组id = 创建事件组id(选项.事件组id)
  let 当前会话 = await 控制器.读取当前会话()
  if (当前会话.当前消息id === null) throw new Error('当前会话没有可压缩的消息')
  let 历史 = await 控制器.读取会话消息(当前会话.id)
  let 历史字符数 = 内部.历史字符数 ?? 计算历史字符数(历史.map((消息) => 消息.消息))
  let 数据库 = await 控制器.取数据库查询器()
  let 开始时间 = new Date()
  await 记录交互日志(
    数据库,
    {
      类型: '流程开始',
      开始时间,
      内容: { 入口: 内部.入口, 会话id: 当前会话.id, 历史字符数 },
      上下文消息id: 当前会话.当前消息id,
    },
    事件组id,
  )
  let 超时信号 = 内部.超时毫秒 === undefined ? undefined : AbortSignal.timeout(内部.超时毫秒)
  let 信号列表 = [选项.中断信号, 超时信号].filter((信号): 信号 is AbortSignal => 信号 !== undefined)
  let 请求信号 = 信号列表.length === 0 ? undefined : AbortSignal.any(信号列表)
  try {
    let 可摘要内容 = 历史
      .filter((消息) => 消息.消息.role !== 'system')
      .map((消息) => {
        let 内容 = 'content' in 消息.消息 ? 消息.消息.content : null
        return { role: 消息.消息.role, content: 内容, message_id: 消息.id }
      })
    let 要求 = 模型语言包.压缩要求(选项.目标字符数)
    let 请求消息: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: 要求 },
      { role: 'user', content: JSON.stringify(可摘要内容) },
    ]
    // 额外请求参数放在最前, 库自己管理的字段在它之后写入, 不会被覆盖
    let 请求体: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      ...额外请求参数,
      model: 选项.模型名称,
      messages: 请求消息,
      stream: false,
    }
    let 请求开始 = Date.now()
    let 响应 = await 带信号等待(
      async () =>
        await 选项.openai客户端.chat.completions.create(
          请求体,
          请求信号 === undefined ? undefined : { signal: 请求信号 },
        ),
      请求信号,
    )
    let 摘要 = 响应.choices[0]?.message.content?.trim()
    let 输入token数 = 响应.usage?.prompt_tokens
    let 输出token数 = 响应.usage?.completion_tokens
    let 发出数 = 统计字符数(JSON.stringify(请求消息))
    let 返回数 = 统计字符数(摘要 ?? '')
    let 实际用量 =
      typeof 输入token数 === 'number' && typeof 输出token数 === 'number' ? { 输入token数, 输出token数 } : null
    await 记录交互日志(
      数据库,
      {
        类型: '模型请求审计',
        开始时间: new Date(请求开始),
        耗时ms: Date.now() - 请求开始,
        内容: {
          用途: '会话压缩',
          记录: {
            时间: new Date(请求开始).toISOString(),
            发出字符数: 实际用量 === null ? 发出数 : 实际用量.输入token数,
            返回字符数: 实际用量 === null ? 返回数 : 实际用量.输出token数,
            计量单位: 实际用量 === null ? '字符' : 'token',
          },
        },
        上下文消息id: 当前会话.当前消息id,
      },
      事件组id,
    )
    if (摘要 === undefined || 摘要 === '') throw new Error('摘要模型没有返回文本')
    if (摘要.length > 选项.目标字符数) throw new Error('摘要超过目标字符数，原会话未变更')
    let 派生会话 = await 控制器.创建当前压缩派生会话(摘要, 选项.标题)
    await 记录交互日志(
      数据库,
      {
        类型: '流程结束',
        开始时间,
        耗时ms: Date.now() - 开始时间.getTime(),
        内容: {
          入口: 内部.入口,
          结果: '已压缩',
          会话id: 当前会话.id,
          前驱会话id: 当前会话.id,
          派生会话id: 派生会话.id,
          摘要字符数: 摘要.length,
        },
        ...(派生会话.当前消息id !== null ? { 上下文消息id: 派生会话.当前消息id } : {}),
      },
      事件组id,
    )
    return 派生会话
  } catch (错误) {
    await 记录交互日志(
      数据库,
      {
        类型: '流程异常',
        开始时间,
        耗时ms: Date.now() - 开始时间.getTime(),
        内容: {
          入口: 内部.入口,
          会话id: 当前会话.id,
          历史字符数,
          原因: 判定失败原因(选项.中断信号, 超时信号),
          错误消息: (错误 instanceof Error ? 错误.message : String(错误)).slice(0, 1000),
        },
        上下文消息id: 当前会话.当前消息id,
      },
      事件组id,
    )
    throw 错误
  }
}

/** 对话开头先确定事件组id(调用方传了就用, 没传就生成), 自动压缩和正式那一轮共用这一个 */
export function 确定对话事件组<T extends z.ZodType>(选项: 带记忆的对话选项<T>): 带事件组的对话选项<T> {
  return { ...选项, 事件组id: 创建事件组id(选项.事件组id) }
}

let 失败记录内容Schema = z.object({ 历史字符数: z.number() })

/** 从交互日志推出该会话最近一次(且之后没有压缩成功过的)自动压缩失败时的历史字符数; 没有则返回 null。 */
async function 读取最近自动压缩失败字符数(控制器: 会话控制器, 会话id: string): Promise<number | null> {
  let 数据库 = await 控制器.取数据库查询器()
  let 结果 = await sql<{ 内容: unknown }>`
    SELECT f.内容 FROM 交互日志表 f
    WHERE f.类型 = '流程异常'
      AND f.内容::jsonb ->> '入口' = '自动压缩'
      AND f.内容::jsonb ->> '会话id' = ${会话id}
      AND f.内容::jsonb ->> '原因' <> '中断'
      AND NOT EXISTS (
        SELECT 1 FROM 交互日志表 s
        WHERE s.类型 = '流程结束'
          AND s.内容::jsonb ->> '结果' = '已压缩'
          AND s.内容::jsonb ->> '前驱会话id' = ${会话id}
          AND s.序号 > f.序号
      )
    ORDER BY f.序号 DESC
    LIMIT 1
  `.execute(数据库)
  let 行 = 结果.rows[0]
  if (行 === undefined) return null
  let 内容: unknown = typeof 行.内容 === 'string' ? JSON.parse(行.内容) : 行.内容
  let 解析 = 失败记录内容Schema.safeParse(内容)
  return 解析.success === true ? 解析.data.历史字符数 : null
}

export async function 尝试自动压缩<T extends import('zod').z.ZodType>(
  控制器: 会话控制器,
  模型语言包: 模型语言包,
  历史: 智能体消息类型[],
  配置: { 自动压缩?: 自动压缩配置 | undefined; 额外请求参数?: Record<string, unknown> | undefined },
  选项: 带事件组的对话选项<T>,
): Promise<void> {
  let 自动压缩 = 配置.自动压缩
  if (自动压缩 === undefined) return
  let 事件组id = 创建事件组id(选项.事件组id)
  let 历史字符数 = 计算历史字符数(历史)
  if (历史字符数 < 自动压缩.触发字符数) return
  try {
    let 会话id = 控制器.当前会话id()
    if (自动压缩.失败后冷却字符数 !== undefined && 会话id !== null) {
      let 失败时字符数 = await 读取最近自动压缩失败字符数(控制器, 会话id)
      if (失败时字符数 !== null && 历史字符数 - 失败时字符数 < 自动压缩.失败后冷却字符数) {
        let 说明 = `自动压缩因冷却跳过: 上次失败时历史 ${String(失败时字符数)} 字符, 现在 ${String(历史字符数)} 字符, 增量不足 ${String(自动压缩.失败后冷却字符数)} 字符`
        await 记录交互日志(
          await 控制器.取数据库查询器(),
          { 类型: '流程信息', 开始时间: new Date(), 内容: { 内容: 说明 } },
          事件组id,
        )
        await 选项.回调({ 类型: '流程信息', 内容: 说明 })
        return
      }
    }
    await 执行压缩当前会话(
      控制器,
      模型语言包,
      {
        openai客户端: 选项.openai客户端,
        模型名称: 选项.模型名称,
        目标字符数: 自动压缩.目标字符数,
        额外请求参数: 配置.额外请求参数,
        中断信号: 选项.中断信号,
        事件组id,
      },
      { 入口: '自动压缩', 超时毫秒: 自动压缩.超时毫秒, 历史字符数 },
    )
  } catch (错误) {
    await 选项.回调({
      类型: '流程信息',
      内容: `自动压缩失败，已保留原会话: ${错误 instanceof Error ? 错误.message : String(错误)}`,
    })
  }
}
