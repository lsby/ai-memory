import { randomUUID } from 'node:crypto'
import type OpenAI from 'openai'
import { 工具调用引导前缀 } from './constants'
import { 转换为模型消息 } from './message-serialization'
import type { 智能体消息类型, 模型审计汇总, 模型请求审计记录, 累积工具调用 } from './types'

/** 按 Unicode 码点计数，中英文和 emoji 都各算一个字符。 */
export function 统计字符数(文本: string): number {
  return Array.from(文本).length
}

export function 统计模型输入字符数(
  消息列表: 智能体消息类型[],
  工具列表: OpenAI.Chat.Completions.ChatCompletionTool[],
  是否支持函数调用: boolean = true,
  是否使用引导前缀: boolean = true,
): number {
  let 实际消息列表: 智能体消息类型[] = 消息列表
  if (是否支持函数调用 === false && 是否使用引导前缀 !== false) {
    实际消息列表 = [...消息列表, { role: 'assistant', content: 工具调用引导前缀 }]
  }
  let 实际工具列表 = 是否支持函数调用 === false ? [] : 工具列表
  let 请求载荷 = {
    messages: 实际消息列表.map(转换为模型消息),
    ...(实际工具列表.length > 0 ? { tools: 实际工具列表 } : {}),
  }
  return 统计字符数(JSON.stringify(请求载荷))
}

export function 统计模型输出字符数(完整文本: string, 工具调用列表: 累积工具调用[]): number {
  let 返回载荷 = {
    content: 完整文本,
    ...(工具调用列表.length > 0
      ? {
          tool_calls: 工具调用列表.map((调用) => ({ id: 调用.id, name: 调用.名称, arguments: 调用.参数片段 })),
        }
      : {}),
  }
  return 统计字符数(JSON.stringify(返回载荷))
}

function 复制审计记录(记录: 模型请求审计记录): 模型请求审计记录 {
  return { ...记录, 时间: new Date(记录.时间) }
}

export class 模型审计器 {
  private 当前会话标识: string = randomUUID()
  private 当前会话已有模型请求: boolean = false
  private 记录列表: 模型请求审计记录[] = []

  public 读取会话标识(): string {
    return this.当前会话标识
  }

  public 当前会话是否已有请求(): boolean {
    return this.当前会话已有模型请求
  }

  public 切换会话(会话标识?: string, 已有模型请求: boolean = false): void {
    this.当前会话标识 = 会话标识 ?? randomUUID()
    this.当前会话已有模型请求 = 已有模型请求
  }

  public 添加记录(
    是否新建对话: boolean,
    发出字符数: number,
    返回字符数: number,
    更新当前会话状态: boolean,
  ): 模型请求审计记录 {
    let 记录: 模型请求审计记录 = {
      id: randomUUID(),
      会话标识: this.当前会话标识,
      请求序号: this.记录列表.length + 1,
      时间: new Date(),
      缓存判定: 是否新建对话 ? '新建对话' : '复用已有对话',
      发出字符数,
      返回字符数,
    }
    this.记录列表.push(记录)
    if (更新当前会话状态 === true) this.当前会话已有模型请求 = true
    return 复制审计记录(记录)
  }

  public 读取记录(): 模型请求审计记录[] {
    return this.记录列表.map(复制审计记录)
  }

  public 读取汇总(): 模型审计汇总 {
    return {
      模型请求次数: this.记录列表.length,
      新建对话请求次数: this.记录列表.filter((记录) => 记录.缓存判定 === '新建对话').length,
      缓存复用请求次数: this.记录列表.filter((记录) => 记录.缓存判定 === '复用已有对话').length,
      发出字符数: this.记录列表.reduce((总数, 记录) => 总数 + 记录.发出字符数, 0),
      返回字符数: this.记录列表.reduce((总数, 记录) => 总数 + 记录.返回字符数, 0),
    }
  }

  public 清空记录(): void {
    this.记录列表 = []
  }
}
