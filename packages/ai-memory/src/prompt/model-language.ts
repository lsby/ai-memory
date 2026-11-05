import { 智能体工具 } from '@lsby/ai-agent'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { 模型语言包 } from '../model-language'

let 内部字段名 = [
  '结果',
  '信息',
  '消息',
  '错误信息',
  '内容',
  '线索',
  '评分',
  '新内容',
  '新线索',
  '新评分',
  '线索列表',
  '最新状态',
  '查询内容',
  '过滤内容',
  '过滤内容模式',
  '会话id',
  '消息id',
  '记忆id',
  '记忆提交id',
  '角色',
  '等级',
  '相关度',
  '创建时间',
  '相关消息',
  '关系',
  '消息列表',
  '上下文消息数',
  '时间范围',
  '开始时间',
  '结束时间',
  '内容过滤正则表达式',
  '直接联想到的记忆',
  '完整记忆',
  '完整技能',
  '匹配的线索',
  '相关记忆',
  '相关技能',
  '闪现出的线索',
  '完整记忆数量',
  '完整技能数量',
  '线索来源数量',
  '记忆数量',
  '技能数量',
  '技能标识',
  '技能名称',
  '工具标识',
  '工具名称',
  '名称',
  '描述',
  '代码',
  '新代码',
  '测试参数_json',
  '测试执行输出',
  '执行输出',
  '日志输出',
  '运行结果',
  '推演任务',
  '专家设定',
  '先验知识',
  '纯净模式',
  '推演结论',
  '结论',
  '置信度',
  '重组完成',
  '拦截提示',
]

function 转换键(键: string, 方向: '对模型' | '对内部', 模型语言包: 模型语言包): string {
  if (方向 === '对模型') return 模型语言包.模型字段名(键)
  return 内部字段名.find((内部名) => 模型语言包.模型字段名(内部名) === 键) ?? 键
}

let 枚举值字段 = new Set(['结果', '过滤内容模式', '等级', '关系'])
let 内部枚举值列表 = ['成功', '失败', 'and', 'or', '零级', '一级', '二级', '未知', '新增']

export function 转换值(
  值: unknown,
  方向: '对模型' | '对内部',
  模型语言包: 模型语言包,
  内部字段?: string | undefined,
): unknown {
  if (Array.isArray(值)) return 值.map((项) => 转换值(项, 方向, 模型语言包, 内部字段))
  if (值 !== null && typeof 值 === 'object') {
    let 条目 = Object.entries(值)
    if (方向 === '对内部') {
      条目 = 条目.filter(([_键, 项]) => 项 !== null && 项 !== undefined)
    }
    return Object.fromEntries(
      条目.map(([键, 项]) => {
        let 转换后键 = 转换键(键, 方向, 模型语言包)
        let 当前内部字段 = 方向 === '对模型' ? 键 : 转换后键
        return [转换后键, 转换值(项, 方向, 模型语言包, 当前内部字段)]
      }),
    )
  }
  if (typeof 值 !== 'string' || 内部字段 === undefined || 枚举值字段.has(内部字段) === false) return 值
  if (方向 === '对模型') return 模型语言包.模型枚举值(值)
  for (let 内部枚举值 of 内部枚举值列表) {
    if (值 === 模型语言包.模型枚举值(内部枚举值)) return 内部枚举值
  }
  return 值
}

export function 转换Schema(值: unknown, 模型语言包: 模型语言包, 保留描述: boolean): unknown {
  if (Array.isArray(值)) return 值.map((项) => 转换Schema(项, 模型语言包, 保留描述))
  if (值 === null || typeof 值 !== 'object') return 值
  let 结果: Record<string, unknown> = {}
  for (let [键, 项] of Object.entries(值)) {
    if (键 === 'description') {
      if (保留描述 === false) continue
      if (typeof 项 === 'string') {
        结果[键] = 模型语言包.模型字段描述(项)
        continue
      }
    }
    if (键 === 'properties' && 项 !== null && typeof 项 === 'object') {
      结果[键] = Object.fromEntries(
        Object.entries(项).map(([字段, 定义]) => [
          转换键(字段, '对模型', 模型语言包),
          转换Schema(定义, 模型语言包, 保留描述),
        ]),
      )
    } else if (键 === 'required' && Array.isArray(项)) {
      结果[键] = 项.map((字段) => (typeof 字段 === 'string' ? 转换键(字段, '对模型', 模型语言包) : 字段))
    } else if (键 === 'enum' && Array.isArray(项)) {
      结果[键] = 项.map((枚举值) => (typeof 枚举值 === 'string' ? 模型语言包.模型枚举值(枚举值) : 枚举值))
    } else if (键 === 'default' && typeof 项 === 'string') {
      结果[键] = 模型语言包.模型枚举值(项)
    } else {
      结果[键] = 转换Schema(项, 模型语言包, 保留描述)
    }
  }
  return 结果
}

export function 本地化记忆工具(工具: 智能体工具, 模型语言包: 模型语言包): 智能体工具 {
  let 是否联想查询 = ['search_memories', 'search_clues', 'search_skills'].includes(工具.名称)
  let 原始Schema = 是否联想查询
    ? zodToJsonSchema(工具.参数Schema)
    : zodToJsonSchema(工具.参数Schema, { target: 'openAi' })
  let schema = 转换Schema(原始Schema, 模型语言包, 是否联想查询)
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema))
    throw new Error('工具 JSON Schema 不是对象')
  return 智能体工具.创建模型适配(工具, {
    描述: 模型语言包.记忆工具描述(工具.名称, 工具.描述),
    参数JSONSchema: schema as Record<string, unknown>,
    解析参数: (参数): Record<string, unknown> => 转换值(参数, '对内部', 模型语言包) as Record<string, unknown>,
    转换返回值: (返回值): unknown => 转换值(返回值, '对模型', 模型语言包),
    返回值描述: undefined,
  })
}
