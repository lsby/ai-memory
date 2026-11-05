import {
  中文模型语言包 as 中文基础模型语言包,
  英文模型语言包 as 英文基础模型语言包,
  type 基础模型语言包,
} from '../agent/model-language'
import { 英文工具描述 } from '../agent/model-language-en-mappings'
import { 生成中文默认记忆提示词, 生成英文默认记忆提示词 } from './prompt/default-memory-prompts'

export type 记忆模型语言包 = 基础模型语言包 & {
  记忆工具描述: (工具名: string, 默认描述: string) => string
  默认记忆提示词: (启用工具名: readonly string[]) => string
  当前零级记忆标题: () => string
  当前一级记忆标题: () => string
  无记忆: () => string
  线索名称: () => string
  评分名称: () => string
  记录于名称: () => string
  刚刚: () => string
  分钟前: (数量: number) => string
  小时前: (数量: number) => string
  天前: (数量: number) => string
  月前: (数量: number) => string
  自动召回记忆标题: () => string
  自动召回记忆说明: () => string
  自动召回线索: (线索: string[]) => string
  当前记忆状态: (内容: string) => string
  自动召回技能标题: () => string
  自动召回技能说明: () => string
  未提供: () => string
  参数Schema名称: () => string
  返回值Schema名称: () => string
  相似度名称: () => string
  私有反思: (内容: string) => string
  会话反思: (内容: string) => string
  压缩要求: (目标字符数: number) => string
  压缩会话标题: () => string
  博闻强记提示词?: (() => string) | undefined
  博闻强记消息搜索工具描述?: (() => string) | undefined
  博闻强记上游会话?: ((会话id: string) => string) | undefined
  历史工具描述: () => string
  无当前会话: () => string
  无可读历史: () => string
  历史不在谱系: () => string
  记忆重组命令: (概念: string[]) => string
  记忆重组结果描述: () => string
  深度推演命令: (任务: string) => string
  深度推演结果描述: () => string
  深度推演异常退出: (原因: string) => string
  深度推演无结论: () => string
  深度推演结论: (置信度: number, 结论: string) => string
  深度推演先验标记: () => { 线索: string[] }
  深度推演专家标记: () => { 线索: string[] }
  记忆完整状态: (数据: {
    等级: '零级' | '一级' | '二级'
    id: string
    内容: string
    线索: string[]
    评分?: number | undefined
  }) => string
  记忆已移除: (等级: '零级' | '一级', id: string) => string
  记忆已降级: (id: string, 评分: number) => string
  记忆已捞起: (id: string, 评分: number) => string
  记忆线索状态: (id: string, 线索: string[]) => string
  找不到记忆: (id: string) => string
  技能参数JSON错误: (字段名: string) => string
  技能代码校验失败: (错误: string) => string
  技能名称已存在: (名称: string) => string
  技能冒烟测试失败: (错误: string) => string
  未找到技能: (标识类型: '标识' | '名称', 值: string) => string
  技能新代码校验失败: (错误: string) => string
  技能更新名称冲突: (名称: string) => string
  技能执行出错: (错误: string) => string
  技能定义错误: (
    问题: '缺少变量' | '名称' | '描述' | '参数Schema' | '参数Schema形状' | '返回值Schema' | '返回值Schema形状' | '实现',
  ) => string
  技能Schema校验失败: (位置: '输入参数' | '返回值', 错误: string) => string
  技能执行超时: (毫秒: number) => string
  技能编译执行出错: (错误: string) => string
  代码执行超时: (毫秒: number) => string
  代码执行输出: (日志: string[], 返回值: unknown) => string
}

/** @deprecated 请使用 记忆模型语言包。保留此别名以兼容现有公共 API。 */
export type 模型语言包 = 记忆模型语言包

let 中文工具描述: Record<string, () => string> = {
  execute_code: (): string =>
    '在严格隔离的 JavaScript 沙盒中执行纯 JavaScript 实验、计算或数据验证。沙盒不支持 require、文件读写或网络请求；代码运行在 async function 中，可以使用 await，并应通过 return 返回结果。',
  deep_deduction: (): string =>
    '启动一个隔离的专家级子智能体，深度验证复杂猜想。可选择纯净模式，以决定是否继承历史上下文。',
  add_level_0_memory: (): string => '添加一条永久生效且不受容量限制的核心法则或人设。请极度谨慎使用。',
  edit_level_0_memory: (): string => '修改已有核心法则的内容和线索。',
  remove_level_0_memory: (): string => '从当前记忆状态移除一条不再需要的核心法则。',
  add_level_1_memory: (): string => '把当前任务的重点放入有容量限制的工作记忆。容量满载时会自动降级最低分记忆。',
  edit_level_1_memory: (): string => '修改已有工作记忆的内容、线索和评分。',
  remove_level_1_memory: (): string => '从当前工作记忆状态移除一条记忆，而不是将它降级。',
  add_level_2_memory: (): string => '将规律、经验或长期理论直接存入可自动召回的长期记忆。',
  demote_memory: (): string => '将一条工作记忆转移到长期记忆，并重新评估评分。',
  promote_memory: (): string => '将一条长期记忆捞回工作记忆，并重新评估重要度。',
  search_memories: (): string => '用一个或多个自然语言内容联想长期记忆，返回少量完整记忆和更多闪现线索。',
  search_clues: (): string => '用一个或多个自然语言内容联想线索，并返回与这些线索相关的记忆和技能。',
  search_skills: (): string => '用一个或多个自然语言内容联想技能，返回少量完整技能信息和更多闪现线索。',
  append_memory_clues: (): string => '向指定记忆追加联想线索。',
  remove_memory_clues: (): string => '从指定记忆移除联想线索。',
  overwrite_memory_clues: (): string => '覆盖指定记忆的联想线索。',
  create_skill: (): string =>
    '创建并持久化 JavaScript 技能。代码必须声明 `skill = { name, description, parametersSchema, returnSchema, execute }`；两个 Schema 都必须是 object 类型的标准 JSON Schema，`execute` 必须是 async function。还需提供自然语言线索和测试参数，只有冒烟测试通过后才会保存。',
  view_skill_code: (): string => '读取已有技能的完整源代码，以便排查或修改。',
  update_skill: (): string => '更新已有技能；新代码通过冒烟测试后才会替换当前版本。',
  remove_skill: (): string => '从当前技能状态移除不再需要的技能。',
  execute_skill: (): string => '按名称调用已有技能，并传入 JSON 格式的参数字符串。',
}

export let 中文模型语言包: 记忆模型语言包 = {
  ...中文基础模型语言包,
  记忆工具描述: (名称, 默认描述): string => 中文工具描述[名称]?.() ?? 默认描述,
  默认记忆提示词: (启用工具名): string => 生成中文默认记忆提示词(启用工具名),
  当前零级记忆标题: (): string => '### 当前零级记忆 (核心法则)',
  当前一级记忆标题: (): string => '### 当前一级记忆 (重点关注的工作上下文)',
  无记忆: (): string => '- 无',
  线索名称: (): string => '线索',
  评分名称: (): string => '评分',
  记录于名称: (): string => '记录于',
  刚刚: (): string => '刚刚',
  分钟前: (数量): string => `${String(数量)}分钟前`,
  小时前: (数量): string => `${String(数量)}小时前`,
  天前: (数量): string => `${String(数量)}天前`,
  月前: (数量): string => `${String(数量)}个月前`,
  自动召回记忆标题: (): string => '### 本轮自动召回的二级记忆',
  自动召回记忆说明: (): string => '以下长期记忆可能与当前任务有关：',
  自动召回线索: (线索): string =>
    `闪现出的线索: [${线索.join(', ')}]\n这些只是联想线索；在读取准确记忆前，不要把它们归属于当前对象。`,
  当前记忆状态: (内容): string =>
    `### 本轮最新记忆状态\n以下是当前完整状态，如果与历史中更早的记忆状态冲突，以本条为准。\n\n${内容}`,
  自动召回技能标题: (): string => '### 自动召回的技能',
  自动召回技能说明: (): string => '系统召回了以下可能相关的技能。如需使用，请调用 `execute_skill`。',
  未提供: (): string => '未提供',
  参数Schema名称: (): string => '参数Schema',
  返回值Schema名称: (): string => '返回值Schema',
  相似度名称: (): string => '相似度',
  私有反思: (内容): string =>
    `[系统事件:私有反思] 你刚才经历了以下事件或产生了以下思绪：\n${内容}\n请自主决定是否需要使用工具，并在反思结束后返回期望的结果。本轮反思不会写入对话历史。`,
  会话反思: (内容): string =>
    `[系统事件:会话反思] 你刚才经历了以下事件或产生了以下思绪：\n${内容}\n请自主决定是否需要使用工具，并在反思结束后返回期望的结果。本轮反思会写入对话历史。`,
  压缩要求: (数量): string =>
    `将下面的对话压缩为不超过 ${String(数量)} 个字符的摘要。保留决定、约束、未完成事项、精确标识符和重要事实。只返回摘要。`,
  压缩会话标题: (): string => '压缩会话',
  博闻强记提示词: (): string =>
    '## 博闻强记模式\n你可以使用 `search_conversation_messages` 搜索当前会话及其压缩前驱链的原始消息，但不能访问其他会话或分支。`search_memories` 直接命中的记忆可能附带与新增记忆相关的消息 ID，可用消息搜索工具查看原文。',
  博闻强记消息搜索工具描述: (): string =>
    '使用必填的自然语言查询对当前会话谱系中的消息进行向量检索，再按会话、消息、记忆来源、角色、相对时间或消息内容正则表达式过滤。过滤条件默认全部满足，也可选择任一满足；默认附带每条命中消息前后各5条上下文。命中数由系统配置限制。',
  博闻强记上游会话: (会话id): string => `[博闻强记] 当前会话由上游会话 ${会话id} 压缩而来。`,
  历史工具描述: (): string =>
    '读取当前会话谱系中的原始消息。摘要代替早期上下文后，使用 previous_conversation 查看准确原文。',
  无当前会话: (): string => '当前没有持久化会话',
  无可读历史: (): string => '当前会话没有可读取的历史消息',
  历史不在谱系: (): string => '目标消息不在当前会话谱系中',
  记忆重组命令: (概念): string =>
    `记忆重组任务：分析这些概念之间有证据支持的联系：[${概念.join(', ')}]。先检索相关记忆；不要强行关联。只有发现有价值的新规律时才保存新的一级记忆。`,
  记忆重组结果描述: (): string => '包含 重组完成 字段的 JSON',
  深度推演命令: (任务): string =>
    `你的核心任务是：\n${任务}\n请验证猜想或解决问题，并在必要时使用工具实验验证，最后返回详细结论。`,
  深度推演结果描述: (): string => '包含最终结论和置信度的 JSON',
  深度推演异常退出: (原因): string => `子智能体因 [${原因}] 非正常退出。`,
  深度推演无结论: (): string => '子智能体未能返回结论。',
  深度推演结论: (置信度, 结论): string => `置信度: ${String(置信度)}%\n结论内容:\n${结论}`,
  深度推演先验标记: (): { 线索: string[] } => ({ 线索: ['先验知识', '前置知识'] }),
  深度推演专家标记: (): { 线索: string[] } => ({ 线索: ['角色设定', '系统设定'] }),
  记忆完整状态: (数据): string =>
    `[${数据.等级}记忆 ID: ${数据.id}]${数据.评分 === undefined ? '' : ` (评分: ${String(数据.评分)})`} 内容: ${数据.内容} (线索: ${数据.线索.join(', ')})`,
  记忆已移除: (等级, id): string => `[${等级}记忆 ID: ${id}] 已从当前状态移除`,
  记忆已降级: (id, 评分): string => `[记忆 ID: ${id}] 已成功降级为二级长期记忆 (新评分: ${String(评分)})`,
  记忆已捞起: (id, 评分): string => `[记忆 ID: ${id}] 已成功捞回至一级工作记忆区 (新评分: ${String(评分)})`,
  记忆线索状态: (id, 线索): string => `[记忆 ID: ${id}] 最新线索: ${线索.join(', ')}`,
  找不到记忆: (id): string => `找不到指定 ID (${id}) 的记忆。`,
  技能参数JSON错误: (字段): string =>
    `参数格式错误：${字段} 不是合法的 JSON 字符串，且自动修复失败。请检查格式后重试。`,
  技能代码校验失败: (错误): string => `代码校验失败: ${错误}`,
  技能名称已存在: (名称): string => `名称「${名称}」已存在，请使用其他名称或更新已有技能`,
  技能冒烟测试失败: (错误): string => `冒烟测试失败: ${错误}`,
  未找到技能: (类型, 值): string => `未找到${类型}为「${值}」的技能`,
  技能新代码校验失败: (错误): string => `新代码校验失败: ${错误}`,
  技能更新名称冲突: (名称): string => `更新失败: 新代码中的名称「${名称}」已被其他技能占用`,
  技能执行出错: (错误): string => `执行出错: ${错误}`,
  技能定义错误: (问题): string => {
    let 文案 = {
      缺少变量: '代码中必须声明一个名为 `tool` 的变量',
      名称: '`tool` 必须包含非空的 `name` 字段 (string)',
      描述: '`tool` 必须包含非空的 `description` 字段 (string)',
      参数Schema: '`tool` 必须包含 `parametersSchema` 字段 (object)',
      参数Schema形状: '`parametersSchema` 必须是标准的 JSON Schema，且 type 必须为 object，必须包含 properties',
      返回值Schema: '`tool` 必须包含 `returnSchema` 字段 (object)',
      返回值Schema形状: '`returnSchema` 必须是标准的 JSON Schema，且 type 必须为 object，必须包含 properties',
      实现: '`tool` 必须包含 `execute` 字段 (function)',
    }
    return 文案[问题]
  },
  技能Schema校验失败: (位置, 错误): string => `${位置} 不符合 JSON Schema: ${错误}`,
  技能执行超时: (毫秒): string => `技能执行超时（${String(毫秒)}ms）`,
  技能编译执行出错: (错误): string => `代码编译/执行出错: ${错误}`,
  代码执行超时: (毫秒): string => `代码执行超时（${String(毫秒)}ms）`,
  代码执行输出: (日志, 返回值): string => {
    let 日志文本 = 日志.length > 0 ? `【Console 输出】:\n${日志.join('\n')}\n\n` : ''
    let 返回值文本 = typeof 返回值 === 'object' ? JSON.stringify(返回值, null, 2) : String(返回值)
    return `${日志文本}【Return 结果】:\n${返回值文本}`
  },
}

export let 英文模型语言包: 记忆模型语言包 = {
  ...英文基础模型语言包,
  记忆工具描述: (名称, _默认描述): string => 英文工具描述[名称]?.() ?? `Use the ${名称} tool.`,
  默认记忆提示词: (启用工具名): string => 生成英文默认记忆提示词(启用工具名),
  当前零级记忆标题: (): string => '### Current level 0 memories (core rules)',
  当前一级记忆标题: (): string => '### Current level 1 memories (working context)',
  无记忆: (): string => '- None',
  线索名称: (): string => 'clues',
  评分名称: (): string => 'score',
  记录于名称: (): string => 'recorded at ',
  刚刚: (): string => 'just now',
  分钟前: (数量): string => `${String(数量)} minutes ago`,
  小时前: (数量): string => `${String(数量)} hours ago`,
  天前: (数量): string => `${String(数量)} days ago`,
  月前: (数量): string => `${String(数量)} months ago`,
  自动召回记忆标题: (): string => '### Automatically recalled long-term memories',
  自动召回记忆说明: (): string => 'The following long-term memories may be relevant:',
  自动召回线索: (线索): string =>
    `Flashed clues: [${线索.join(', ')}]\nThese are associative clues. Do not attribute them to the current subject without reading the exact memory.`,
  当前记忆状态: (内容): string =>
    `### Current memory state\nThis is the complete current state. If it conflicts with an older memory-state message, use this one.\n\n${内容}`,
  自动召回技能标题: (): string => '### Automatically recalled skills',
  自动召回技能说明: (): string => 'The following skills may be relevant. Use `execute_skill` to run one.',
  未提供: (): string => 'not provided',
  参数Schema名称: (): string => 'parameter schema',
  返回值Schema名称: (): string => 'return schema',
  相似度名称: (): string => 'similarity',
  私有反思: (内容): string =>
    `[System event: private reflection] You just experienced or considered the following:\n${内容}\nDecide whether tools are needed, then return the expected result. This reflection will not be written to conversation history.`,
  会话反思: (内容): string =>
    `[System event: conversation reflection] You just experienced or considered the following:\n${内容}\nDecide whether tools are needed, then return the expected result. This reflection will be written to conversation history.`,
  压缩要求: (数量): string =>
    `Summarize the conversation below in at most ${String(数量)} characters. Preserve decisions, constraints, unresolved work, exact identifiers, and important facts. Return only the summary.`,
  压缩会话标题: (): string => 'Compressed conversation',
  博闻强记提示词: (): string =>
    '## Funes mode\nYou may use `search_conversation_messages` to search exact original messages from the current conversation and its compressed ancestor lineage, but never from unrelated conversations or sibling branches. Direct hits returned by `search_memories` may include message IDs related to the creation of that memory; use the message-search tool to inspect the original text.',
  博闻强记消息搜索工具描述: (): string =>
    'Search the current conversation lineage using a required natural-language vector query, then filter by conversation, message, memory origin, role, absolute time range, or a regex over message content. Filters use "and" by default and may use "or". Five messages before and after each hit are included by default. The configured hit limit cannot be raised.',
  博闻强记上游会话: (会话id): string =>
    `[Funes mode] The current conversation was compressed from upstream conversation ${会话id}.`,
  历史工具描述: (): string =>
    'Read exact original messages from the current conversation lineage. Use previous_conversation after a summary has replaced earlier context.',
  无当前会话: (): string => 'There is no current persisted conversation.',
  无可读历史: (): string => 'The current conversation has no readable history for this source.',
  历史不在谱系: (): string => 'The requested message is outside the current conversation lineage.',
  记忆重组命令: (概念): string =>
    `Memory reorganization task: analyze evidence-backed relationships among these concepts: [${概念.join(', ')}]. Search related memories first and do not force connections. Save a new level 1 memory only when a valuable general rule is found.`,
  记忆重组结果描述: (): string => 'JSON containing a completed boolean field.',
  深度推演命令: (任务): string =>
    `Your core task is:\n${任务}\nTest hypotheses or solve the problem. Use tools for experiments when needed, then return a detailed conclusion.`,
  深度推演结果描述: (): string => 'JSON containing the final conclusion and confidence.',
  深度推演异常退出: (原因): string => `The child agent exited abnormally because of: ${原因}.`,
  深度推演无结论: (): string => 'The child agent did not return a conclusion.',
  深度推演结论: (置信度, 结论): string => `Confidence: ${String(置信度)}%\nConclusion:\n${结论}`,
  深度推演先验标记: (): { 线索: string[] } => ({ 线索: ['prior knowledge'] }),
  深度推演专家标记: (): { 线索: string[] } => ({ 线索: ['expert role', 'system role'] }),
  记忆完整状态: (数据): string =>
    `[${数据.等级 === '零级' ? 'Level 0' : 数据.等级 === '一级' ? 'Level 1' : 'Level 2'} memory ID: ${数据.id}]${数据.评分 === undefined ? '' : ` (score: ${String(数据.评分)})`} content: ${数据.内容} (clues: ${数据.线索.join(', ')})`,
  记忆已移除: (等级, id): string =>
    `[${等级 === '零级' ? 'Level 0' : 'Level 1'} memory ID: ${id}] removed from the current state`,
  记忆已降级: (id, 评分): string => `[Memory ID: ${id}] moved to level 2 long-term memory (new score: ${String(评分)})`,
  记忆已捞起: (id, 评分): string => `[Memory ID: ${id}] moved to level 1 working memory (new score: ${String(评分)})`,
  记忆线索状态: (id, 线索): string => `[Memory ID: ${id}] current clues: ${线索.join(', ')}`,
  找不到记忆: (id): string => `Memory ID ${id} was not found.`,
  技能参数JSON错误: (字段): string => `${字段} is not valid JSON and could not be repaired. Fix it and try again.`,
  技能代码校验失败: (错误): string => `Code validation failed: ${错误}`,
  技能名称已存在: (名称): string => `The name "${名称}" already exists. Use another name or update the existing tool.`,
  技能冒烟测试失败: (错误): string => `Smoke test failed: ${错误}`,
  未找到技能: (类型, 值): string => `No skill was found with ${类型 === '标识' ? 'reference' : 'name'} "${值}".`,
  技能新代码校验失败: (错误): string => `New code validation failed: ${错误}`,
  技能更新名称冲突: (名称): string => `Update failed because the name "${名称}" is already used by another tool.`,
  技能执行出错: (错误): string => `Execution failed: ${错误}`,
  技能定义错误: (问题): string => {
    let 文案 = {
      缺少变量: 'The code must declare a variable named tool.',
      名称: 'The tool must have a non-empty name field (string).',
      描述: 'The tool must have a non-empty description field (string).',
      参数Schema: 'The tool must have a parametersSchema field (object).',
      参数Schema形状: 'parametersSchema must be a JSON Schema object with type "object" and a properties field.',
      返回值Schema: 'The tool must have a returnSchema field (object).',
      返回值Schema形状: 'returnSchema must be a JSON Schema object with type "object" and a properties field.',
      实现: 'The tool must have an execute field (function).',
    }
    return 文案[问题]
  },
  技能Schema校验失败: (位置, 错误): string =>
    `${位置 === '输入参数' ? 'Input arguments' : 'Return value'} do not match the JSON Schema: ${错误}`,
  技能执行超时: (毫秒): string => `Skill execution timed out after ${String(毫秒)} ms.`,
  技能编译执行出错: (错误): string => `Code compilation or execution failed: ${错误}`,
  代码执行超时: (毫秒): string => `Code execution timed out after ${String(毫秒)} ms.`,
  代码执行输出: (日志, 返回值): string => {
    let 日志文本 = 日志.length > 0 ? `Console output:\n${日志.join('\n')}\n\n` : ''
    let 返回值文本 = typeof 返回值 === 'object' ? JSON.stringify(返回值, null, 2) : String(返回值)
    return `${日志文本}Return value:\n${返回值文本}`
  },
}
