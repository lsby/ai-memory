import path from 'node:path'
import { 中文模型语言包 } from '../agent/model-language'
import { 生成默认记忆提示词 } from './prompt/memory-prompt'
import { 全部记忆工具名, 记忆写工具名集合, 记忆工具名 } from './prompt/memory-tool-names'
import { 校验schema名 } from './storage/connection'
import type { 内部带记忆的智能体配置, 存储配置, 带记忆的智能体选项 } from './types'

export function 构建智能体配置(选项: 带记忆的智能体选项): {
  配置: 内部带记忆的智能体配置
  记忆提示词文本: string
} {
  let { 博闻强记模式: 已提供博闻强记模式, 博闻强记消息搜索数量, ...基础选项 } = 选项
  let 博闻强记模式 = 已提供博闻强记模式 ?? false
  if (博闻强记模式 === true) {
    if (博闻强记消息搜索数量 === undefined) throw new Error('开启博闻强记模式时必须提供 博闻强记消息搜索数量')
    if (Number.isInteger(博闻强记消息搜索数量) === false || 博闻强记消息搜索数量 < 1)
      throw new Error('博闻强记消息搜索数量 必须是正整数')
  } else if (博闻强记消息搜索数量 !== undefined) {
    throw new Error('未开启博闻强记模式时不能提供 博闻强记消息搜索数量')
  }
  let 存储: 存储配置 = 选项.存储 ?? { 模式: '内存' }
  if (存储.模式 === '文件') 存储 = { ...存储, 路径: path.resolve(存储.路径) }
  if (存储.schema !== undefined) 校验schema名(存储.schema)
  if (选项.向量模型?.类型 === '在线' && 选项.向量模型.维度 !== undefined) {
    let 维度 = 选项.向量模型.维度
    if (Number.isInteger(维度) === false || 维度 < 1) throw new Error('向量模型.维度 必须是正整数')
  }
  if (选项.自动压缩 !== undefined) {
    if (Number.isInteger(选项.自动压缩.触发字符数) === false || 选项.自动压缩.触发字符数 < 1)
      throw new Error('自动压缩.触发字符数 必须是正整数')
    if (Number.isInteger(选项.自动压缩.目标字符数) === false || 选项.自动压缩.目标字符数 < 1)
      throw new Error('自动压缩.目标字符数 必须是正整数')
    if (选项.自动压缩.超时毫秒 !== undefined)
      if (Number.isInteger(选项.自动压缩.超时毫秒) === false || 选项.自动压缩.超时毫秒 < 1)
        throw new Error('自动压缩.超时毫秒 必须是正整数')
    if (选项.自动压缩.失败后冷却字符数 !== undefined)
      if (Number.isInteger(选项.自动压缩.失败后冷却字符数) === false || 选项.自动压缩.失败后冷却字符数 < 1)
        throw new Error('自动压缩.失败后冷却字符数 必须是正整数')
    if (选项.自动压缩.目标字符数 >= 选项.自动压缩.触发字符数) throw new Error('自动压缩.目标字符数 必须小于触发字符数')
  }
  let 只读模式 = 选项.只读模式 ?? false
  let 禁用深度推演 = 选项.禁用深度推演 ?? false
  let 筛选 = 选项.记忆工具筛选
  let 启用的记忆工具名 = 全部记忆工具名.filter(
    (名称): boolean =>
      (只读模式 === false || 记忆写工具名集合.has(名称) === false) &&
      (名称 !== 记忆工具名.深度推演 || 禁用深度推演 === false) &&
      (筛选 === undefined || 筛选(名称) === true),
  )
  let 公共配置 = {
    ...基础选项,
    只读模式,
    模型语言包: 选项.模型语言包 ?? 中文模型语言包,
    启用的记忆工具名,
    遗忘豁免: 选项.遗忘豁免 ?? ((): boolean => false),
    一级记忆容量: 选项.一级记忆容量 ?? 10,
    二级记忆遗忘分数阈值: 选项.二级记忆遗忘分数阈值 ?? 10.0,
    二级记忆数量上限: 选项.二级记忆数量上限 ?? 5000,
    二级记忆衰减常数k: 选项.二级记忆衰减常数k ?? 0.05,
    二级记忆访问次数上限: 选项.二级记忆访问次数上限 ?? 10000,
    向量模型: 选项.向量模型 ?? { 类型: '无' },
    自动检索二级记忆数量: 选项.自动检索二级记忆数量 ?? 2,
    自动检索线索数量: 选项.自动检索线索数量 ?? 5,
    自动检索关联数量: 选项.自动检索关联数量 ?? 10,
    自动检索动态工具数量: 选项.自动检索动态工具数量 ?? 3,
    向量召回相似度阈值: 选项.向量召回相似度阈值 ?? 0.6,
    存储,
    禁用深度推演,
  }
  let 配置: 内部带记忆的智能体配置
  if (博闻强记模式 === true) {
    if (博闻强记消息搜索数量 === undefined) throw new Error('开启博闻强记模式时必须提供 博闻强记消息搜索数量')
    配置 = { ...公共配置, 博闻强记模式: true, 博闻强记消息搜索数量: 博闻强记消息搜索数量 }
  } else {
    配置 = { ...公共配置, 博闻强记模式: false }
  }
  let 自定义提示词 = 选项.记忆提示词
  let 记忆提示词文本 =
    自定义提示词 === undefined
      ? 生成默认记忆提示词(启用的记忆工具名, 配置.模型语言包)
      : typeof 自定义提示词 === 'string'
        ? 自定义提示词
        : 自定义提示词([...启用的记忆工具名])
  if (自定义提示词 === undefined && 博闻强记模式 === true) {
    let 博闻强记提示词 = 配置.模型语言包.博闻强记提示词?.() ?? ''
    if (博闻强记提示词 !== '') 记忆提示词文本 += `\n\n${博闻强记提示词}`
  }
  return { 配置, 记忆提示词文本 }
}
