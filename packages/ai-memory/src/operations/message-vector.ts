import type { 智能体消息类型 } from '@lsby/ai-agent'
import { 获取向量 } from '../tools/get-vector'
import type { 内部带记忆的智能体配置 } from '../types'

function 转为向量文本(消息: 智能体消息类型): string {
  let { 持久化消息id: _持久化消息id, ...消息内容 } = 消息
  return typeof 消息内容.content === 'string' ? 消息内容.content : JSON.stringify(消息内容)
}

export async function 生成查询向量(配置: 内部带记忆的智能体配置, 查询内容: string): Promise<number[] | null> {
  let 结果 = await 获取向量(配置.向量模型, 查询内容)
  switch (结果.类型) {
    case '成功':
      if (结果.向量.length === 0) throw new Error('查询向量不能为空')
      return 结果.向量
    case '无模型':
      return null
    case '失败':
      throw new Error(`查询向量化失败: ${结果.错误信息}`)
  }
}

export async function 生成消息向量(
  配置: 内部带记忆的智能体配置,
  消息列表: 智能体消息类型[],
): Promise<Array<number[] | null>> {
  if (配置.博闻强记模式 === false || 配置.向量模型.类型 === '无') return 消息列表.map(() => null)
  let 向量列表: Array<number[] | null> = []
  for (let 消息 of 消息列表) {
    let 结果 = await 获取向量(配置.向量模型, 转为向量文本(消息))
    switch (结果.类型) {
      case '成功':
        if (结果.向量.length === 0) throw new Error('新消息向量化失败: 向量不能为空')
        向量列表.push(结果.向量)
        break
      case '失败':
        throw new Error(`新消息向量化失败: ${结果.错误信息}`)
      case '无模型':
        向量列表.push(null)
        break
    }
  }
  return 向量列表
}
