import { zodToJsonSchema } from 'zod-to-json-schema'
import type { 模型语言包 } from '../../agent/model-language'
import { 智能体工具 } from '../../agent/types'

let 内部字段名 = [
  '结果',
  '信息',
  '错误信息',
  '内容',
  '关键词',
  '标签',
  '评分',
  '新内容',
  '新关键词',
  '新标签',
  '新评分',
  '关键词列表',
  '标签列表',
  '最新状态',
  '查询内容',
  '目标关键词',
  '发散起点数',
  '直接返回数',
  '最大扩展跳数',
  '最小关联阈值',
  '正则表达式过滤',
  '时间范围',
  '开始相对天数',
  '结束相对天数',
  '搜索结果_完整记忆',
  '搜索结果_发散关键词',
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

function 转换值(值: unknown, 方向: '对模型' | '对内部', 模型语言包: 模型语言包): unknown {
  if (Array.isArray(值)) return 值.map((项) => 转换值(项, 方向, 模型语言包))
  if (值 !== null && typeof 值 === 'object') {
    return Object.fromEntries(
      Object.entries(值).map(([键, 项]) => [转换键(键, 方向, 模型语言包), 转换值(项, 方向, 模型语言包)]),
    )
  }
  if (方向 === '对模型' && typeof 值 === 'string') return 模型语言包.模型枚举值(值)
  if (方向 === '对内部' && 值 === 模型语言包.模型枚举值('成功')) return '成功'
  if (方向 === '对内部' && 值 === 模型语言包.模型枚举值('失败')) return '失败'
  return 值
}

function 转换Schema(值: unknown, 模型语言包: 模型语言包): unknown {
  if (Array.isArray(值)) return 值.map((项) => 转换Schema(项, 模型语言包))
  if (值 === null || typeof 值 !== 'object') return 值
  let 结果: Record<string, unknown> = {}
  for (let [键, 项] of Object.entries(值)) {
    if (键 === 'description') continue
    if (键 === 'properties' && 项 !== null && typeof 项 === 'object') {
      结果[键] = Object.fromEntries(
        Object.entries(项).map(([字段, 定义]) => [转换键(字段, '对模型', 模型语言包), 转换Schema(定义, 模型语言包)]),
      )
    } else if (键 === 'required' && Array.isArray(项)) {
      结果[键] = 项.map((字段) => (typeof 字段 === 'string' ? 转换键(字段, '对模型', 模型语言包) : 字段))
    } else if (键 === 'enum' && Array.isArray(项)) {
      结果[键] = 项.map((枚举值) => 转换值(枚举值, '对模型', 模型语言包))
    } else {
      结果[键] = 转换Schema(项, 模型语言包)
    }
  }
  return 结果
}

export function 本地化记忆工具(工具: 智能体工具, 模型语言包: 模型语言包): 智能体工具 {
  let schema = 转换Schema(zodToJsonSchema(工具.参数Schema, { target: 'openAi' }), 模型语言包)
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema))
    throw new Error('工具 JSON Schema 不是对象')
  return 智能体工具.创建模型适配(工具, {
    描述: 模型语言包.记忆工具描述(工具.名称, 工具.描述),
    参数JSONSchema: schema as Record<string, unknown>,
    解析参数: (参数): Record<string, unknown> => {
      let 内部参数 = 转换值(参数, '对内部', 模型语言包) as Record<string, unknown>
      if (工具.名称.endsWith('_memory_keywords') && 内部参数['关键词'] !== undefined) {
        内部参数['关键词列表'] = 内部参数['关键词']
        delete 内部参数['关键词']
      }
      if (工具.名称.endsWith('_memory_tags') && 内部参数['标签'] !== undefined) {
        内部参数['标签列表'] = 内部参数['标签']
        delete 内部参数['标签']
      }
      return 内部参数
    },
    转换返回值: (返回值): unknown => 转换值(返回值, '对模型', 模型语言包),
    返回值描述: undefined,
  })
}
