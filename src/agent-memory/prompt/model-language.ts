import { zodToJsonSchema } from 'zod-to-json-schema'
import { 智能体工具 } from '../../agent/types'

let 字段映射: Record<string, string> = {
  结果: 'status',
  错误信息: 'error',
  内容: 'content',
  关键词: 'keywords',
  标签: 'tags',
  评分: 'score',
  新内容: 'new_content',
  新关键词: 'new_keywords',
  新标签: 'new_tags',
  新评分: 'new_score',
  关键词列表: 'keywords',
  标签列表: 'tags',
  最新状态: 'current_state',
  查询内容: 'query',
  目标关键词: 'target_keywords',
  发散起点数: 'seed_count',
  直接返回数: 'result_count',
  最大扩展跳数: 'max_hops',
  最小关联阈值: 'min_relation_score',
  正则表达式过滤: 'regex_filter',
  时间范围: 'time_range',
  开始相对天数: 'start_relative_days',
  结束相对天数: 'end_relative_days',
  搜索结果_完整记忆: 'memory_results',
  搜索结果_发散关键词: 'related_keywords',
  工具标识: 'tool_ref',
  工具名称: 'tool_name',
  名称: 'name',
  描述: 'description',
  代码: 'code',
  新代码: 'new_code',
  测试参数_json: 'test_arguments_json',
  测试执行输出: 'test_output',
  执行输出: 'output',
  日志输出: 'logs',
  运行结果: 'value',
  推演任务: 'task',
  专家设定: 'expert_role',
  先验知识: 'prior_knowledge',
  纯净模式: 'clean_mode',
  推演结论: 'conclusion',
  结论: 'conclusion',
  置信度: 'confidence',
  拦截提示: 'interception_notice',
}

let 工具英文描述: Record<string, string> = {
  execute_code: 'Run JavaScript in a strictly isolated sandbox for calculations and data validation.',
  deep_deduction: 'Run an isolated expert reasoning process to test a complex hypothesis.',
  add_level_0_memory: 'Add a core rule or persona memory. Use with extreme care.',
  edit_level_0_memory: 'Edit an existing core rule or persona memory.',
  remove_level_0_memory: 'Remove a core rule from the current memory state.',
  add_level_1_memory: 'Add important current-task information to working memory.',
  edit_level_1_memory: 'Edit an existing working memory.',
  remove_level_1_memory: 'Remove an item from the current working-memory state.',
  add_level_2_memory: 'Store a durable rule, experience, or theory in long-term memory.',
  demote_memory: 'Move a working memory to long-term memory and reassess its score.',
  promote_memory: 'Move a long-term memory into working memory and reassess its score.',
  extend_memory: 'Search and traverse related long-term memories and concepts.',
  append_memory_keywords: 'Append graph-indexing keywords to a memory.',
  remove_memory_keywords: 'Remove graph-indexing keywords from a memory.',
  overwrite_memory_keywords: 'Replace all graph-indexing keywords on a memory.',
  append_memory_tags: 'Append metadata tags to a memory.',
  remove_memory_tags: 'Remove metadata tags from a memory.',
  overwrite_memory_tags: 'Replace all metadata tags on a memory.',
  create_dynamic_tool: 'Create a persistent JavaScript tool after a smoke test succeeds.',
  view_dynamic_tool_code: 'Read the complete source of an existing dynamic tool.',
  update_dynamic_tool: 'Update a dynamic tool after a smoke test succeeds.',
  remove_dynamic_tool: 'Remove a dynamic tool from the current tool state.',
  call_dynamic_tool: 'Call an existing dynamic tool with JSON arguments.',
}

function 转换键(键: string, 方向: '对模型' | '对内部'): string {
  if (方向 === '对模型') return 字段映射[键] ?? 键
  return Object.entries(字段映射).find(([, 英文]) => 英文 === 键)?.[0] ?? 键
}

function 转换值(值: unknown, 方向: '对模型' | '对内部'): unknown {
  if (Array.isArray(值)) return 值.map((项) => 转换值(项, 方向))
  if (值 !== null && typeof 值 === 'object') {
    return Object.fromEntries(Object.entries(值).map(([键, 项]) => [转换键(键, 方向), 转换值(项, 方向)]))
  }
  if (方向 === '对模型' && 值 === '成功') return 'success'
  if (方向 === '对模型' && 值 === '失败') return 'failure'
  if (方向 === '对内部' && 值 === 'success') return '成功'
  if (方向 === '对内部' && 值 === 'failure') return '失败'
  return 值
}

function 转换Schema(值: unknown): unknown {
  if (Array.isArray(值)) return 值.map(转换Schema)
  if (值 === null || typeof 值 !== 'object') return 值
  let 结果: Record<string, unknown> = {}
  for (let [键, 项] of Object.entries(值)) {
    if (键 === 'description') continue
    if (键 === 'properties' && 项 !== null && typeof 项 === 'object') {
      结果[键] = Object.fromEntries(
        Object.entries(项).map(([字段, 定义]) => [转换键(字段, '对模型'), 转换Schema(定义)]),
      )
    } else if (键 === 'required' && Array.isArray(项)) {
      结果[键] = 项.map((字段) => (typeof 字段 === 'string' ? 转换键(字段, '对模型') : 字段))
    } else if (键 === 'enum' && Array.isArray(项)) {
      结果[键] = 项.map((枚举值) => 转换值(枚举值, '对模型'))
    } else {
      结果[键] = 转换Schema(项)
    }
  }
  return 结果
}

export function 本地化记忆工具(工具: 智能体工具, 模型语言: 'zh-CN' | 'en-US'): 智能体工具 {
  if (模型语言 === 'zh-CN') return 工具
  let schema = 转换Schema(zodToJsonSchema(工具.参数Schema, { target: 'openAi' }))
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema))
    throw new Error('工具 JSON Schema 不是对象')
  return 智能体工具.创建模型适配(工具, {
    描述: 工具英文描述[工具.名称] ?? `Use the ${工具.名称} tool.`,
    参数JSONSchema: schema as Record<string, unknown>,
    解析参数: (参数): Record<string, unknown> => {
      let 内部参数 = 转换值(参数, '对内部') as Record<string, unknown>
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
    转换返回值: (返回值): unknown => 转换值(返回值, '对模型'),
    返回值描述: undefined,
  })
}
