import * as Transformers from '@huggingface/transformers'
import type OpenAI from 'openai'
import { 智能体事件 } from '../../agent/types'
import type { 获取向量结果 } from '../agent-memory-types'

type 本地向量提取器类型 = (
  文本: string,
  选项: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array }>

let 本地向量提取器缓存 = new Map<string, Promise<本地向量提取器类型>>()

function 获取本地模型缓存键(模型名称: string, 下载缓存目录: string | undefined): string {
  return JSON.stringify([模型名称, 下载缓存目录 ?? null])
}

async function 获取本地向量提取器(
  模型名称: string,
  下载缓存目录: string | undefined,
  回调?: (事件: 智能体事件) => Promise<void>,
): Promise<本地向量提取器类型> {
  let 缓存键 = 获取本地模型缓存键(模型名称, 下载缓存目录)
  let 已缓存提取器 = 本地向量提取器缓存.get(缓存键)
  if (已缓存提取器 !== undefined) return await 已缓存提取器

  let 初始化任务 = (async (): Promise<本地向量提取器类型> => {
    if (下载缓存目录 !== undefined) {
      Transformers.env.cacheDir = 下载缓存目录
    }
    if (回调 !== undefined) {
      await 回调({
        类型: '流程信息',
        内容: `[系统加载] 正在初始化本地向量模型: ${模型名称}... (首次运行可能需要下载几十MB)`,
      })
    } else {
      console.log(`[系统加载] 正在初始化本地向量模型: ${模型名称}...`)
    }
    let 提取管线 = await Transformers.pipeline('feature-extraction', 模型名称, { dtype: 'fp32' })
    if (回调 !== undefined) {
      await 回调({ 类型: '流程信息', 内容: `[系统加载] 本地向量模型加载完成` })
    }
    return async (文本, 选项): Promise<{ data: Float32Array }> => {
      let 输出: unknown = await 提取管线(文本, 选项)
      if (typeof 输出 !== 'object' || 输出 === null || !('data' in 输出) || !(输出.data instanceof Float32Array)) {
        throw new Error('本地向量模型返回了不符合预期的结果')
      }
      return { data: 输出.data }
    }
  })()
  本地向量提取器缓存.set(缓存键, 初始化任务)
  try {
    return await 初始化任务
  } catch (错误: unknown) {
    本地向量提取器缓存.delete(缓存键)
    throw 错误
  }
}

export async function 获取向量(
  向量模型配置:
    | { 类型: '在线'; openai客户端: OpenAI; 模型名称: string }
    | {
        类型: '本地'
        模型名称?:
          | 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
          | 'Xenova/jina-embeddings-v2-base-zh'
          | 'Xenova/bge-base-zh-v1.5'
          | 'Xenova/bge-m3'
          | (string & {})
        下载缓存目录?: string
      }
    | { 类型: '无' },
  内容: string,
  回调?: (事件: 智能体事件) => Promise<void>,
): Promise<获取向量结果> {
  if (向量模型配置.类型 === '无') return { 类型: '无模型' }

  if (向量模型配置.类型 === '本地') {
    try {
      let 模型名称 = 向量模型配置.模型名称 ?? 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
      let 提取器 = await 获取本地向量提取器(模型名称, 向量模型配置.下载缓存目录, 回调)
      let 输出 = await 提取器(内容, { pooling: 'mean', normalize: true })
      return { 类型: '成功', 向量: Array.from(输出.data) }
    } catch (错误) {
      let 错误信息 = `本地获取向量失败: ${String(错误)}`
      if (回调 !== undefined) {
        await 回调({ 类型: '错误', 错误信息 })
      } else {
        console.error(`⚠️ ${错误信息}`)
      }
      return { 类型: '失败', 错误信息 }
    }
  }

  try {
    let 模型 = 向量模型配置.模型名称
    let 响应 = await 向量模型配置.openai客户端.embeddings.create({ model: 模型, input: 内容 })
    let 向量数据 = 响应.data[0]?.embedding
    if (向量数据 === undefined) {
      let 错误信息 = `在线向量API返回数据为空`
      if (回调 !== undefined) {
        await 回调({ 类型: '错误', 错误信息 })
      }
      return { 类型: '失败', 错误信息 }
    }
    return { 类型: '成功', 向量: 向量数据 }
  } catch (错误) {
    let 错误信息 = `获取外部向量失败: ${String(错误)}`
    if (回调 !== undefined) {
      await 回调({ 类型: '错误', 错误信息 })
    } else {
      console.error(`⚠️ ${错误信息}`)
    }
    return { 类型: '失败', 错误信息 }
  }
}
