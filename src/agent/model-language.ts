import { 生成中文默认记忆提示词, 生成英文默认记忆提示词 } from './default-memory-prompts'

export type 模型语言包 = {
  工具调用格式标题: () => string
  工具调用格式说明: () => string
  可用工具标题: () => string
  可用工具说明: () => string
  参数形状标题: () => string
  返回值标题: () => string
  最终结果标题: () => string
  最终结果说明: (提交函数名: string) => string
  最终结果格式: (描述: string, schema: string) => string
  提交结果工具描述: (描述: string) => string
  当前时间: (时间: string) => string
  路径: (路径: string) => string
  后置验证失败: (错误: string) => string
  无结构化数据: (提交函数名: string) => string
  空回复: () => string
  工具已中断: () => string
  工具参数无法解析: (参数: string) => string
  未知工具: (名称: string) => string
  工具参数不正确: (错误: string) => string
  工具返回截断: () => string
  多次提交结果: (提交函数名: string) => string
  提交结果已中断: () => string
  提交结果不可混用: (提交函数名: string) => string
  提交结果参数无法解析: (函数名: string, 参数: string) => string
  提交结果成功: () => string
  提交结果格式错误: (错误: string, 提交函数名: string) => string
  模型字段名: (内部字段名: string) => string
  模型枚举值: (内部值: string) => string
  记忆工具描述: (工具名: string, 默认描述: string) => string
  默认记忆提示词: (启用工具名: readonly string[]) => string
  当前零级记忆标题: () => string
  当前一级记忆标题: () => string
  无记忆: () => string
  关键词名称: () => string
  评分名称: () => string
  记录于名称: () => string
  刚刚: () => string
  分钟前: (数量: number) => string
  小时前: (数量: number) => string
  天前: (数量: number) => string
  月前: (数量: number) => string
  自动召回记忆标题: () => string
  自动召回记忆说明: () => string
  自动召回相关概念: (关键词: string[]) => string
  当前记忆状态: (内容: string) => string
  自动召回动态工具标题: () => string
  自动召回动态工具说明: () => string
  未提供: () => string
  参数Schema名称: () => string
  返回值Schema名称: () => string
  相似度名称: () => string
  私有反思: (内容: string) => string
  会话反思: (内容: string) => string
  压缩要求: (目标字符数: number) => string
  压缩会话标题: () => string
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
  深度推演先验标记: () => { 关键词: string; 标签: string }
  深度推演专家标记: () => { 关键词: string; 标签: string }
  记忆完整状态: (数据: {
    等级: '零级' | '一级' | '二级'
    id: string
    内容: string
    关键词: string[]
    标签: string[]
    评分?: number | undefined
  }) => string
  记忆已移除: (等级: '零级' | '一级', id: string) => string
  记忆已降级: (id: string, 评分: number) => string
  记忆已捞起: (id: string, 评分: number) => string
  记忆关键词状态: (id: string, 关键词: string[]) => string
  记忆标签状态: (id: string, 标签: string[]) => string
  找不到记忆: (id: string) => string
  动态工具参数JSON错误: (字段名: string) => string
  动态工具代码校验失败: (错误: string) => string
  动态工具名称已存在: (名称: string) => string
  动态工具冒烟测试失败: (错误: string) => string
  未找到动态工具: (标识类型: '标识' | '名称', 值: string) => string
  动态工具新代码校验失败: (错误: string) => string
  动态工具更新名称冲突: (名称: string) => string
  动态工具执行出错: (错误: string) => string
  动态工具定义错误: (
    问题: '缺少变量' | '名称' | '描述' | '参数Schema' | '参数Schema形状' | '返回值Schema' | '返回值Schema形状' | '实现',
  ) => string
  动态工具Schema校验失败: (位置: '输入参数' | '返回值', 错误: string) => string
  动态工具执行超时: (毫秒: number) => string
  动态工具编译执行出错: (错误: string) => string
  代码执行超时: (毫秒: number) => string
  代码执行输出: (日志: string[], 返回值: unknown) => string
}

let 英文字段映射: Record<string, string> = {
  结果: 'status',
  信息: 'message',
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
  重组完成: 'completed',
  拦截提示: 'interception_notice',
}

let 中文工具描述: Record<string, () => string> = {
  execute_code: (): string =>
    '在严格隔离的 JavaScript 沙盒中执行纯 JavaScript 实验、计算或数据验证。沙盒不支持 require、文件读写或网络请求；代码运行在 async function 中，可以使用 await，并应通过 return 返回结果。',
  deep_deduction: (): string =>
    '启动一个隔离的专家级子智能体，深度验证复杂猜想。可选择纯净模式，以决定是否继承历史上下文。',
  add_level_0_memory: (): string => '添加一条永久生效且不受容量限制的核心法则或人设。请极度谨慎使用。',
  edit_level_0_memory: (): string => '修改已有核心法则的内容、关键词和标签。',
  remove_level_0_memory: (): string => '从当前记忆状态移除一条不再需要的核心法则。',
  add_level_1_memory: (): string => '把当前任务的重点放入有容量限制的工作记忆。容量满载时会自动降级最低分记忆。',
  edit_level_1_memory: (): string => '修改已有工作记忆的内容、关键词、标签和评分。',
  remove_level_1_memory: (): string => '从当前工作记忆状态移除一条记忆，而不是将它降级。',
  add_level_2_memory: (): string => '将规律、经验或长期理论直接存入可自动召回的长期记忆。',
  demote_memory: (): string => '将一条工作记忆转移到长期记忆，并重新评估评分。',
  promote_memory: (): string => '将一条长期记忆捞回工作记忆，并重新评估重要度。',
  extend_memory: (): string =>
    '通过语义检索和记忆图谱查找相关长期记忆与关联概念。可限制时间、扩展跳数、关联阈值和正则过滤。',
  append_memory_keywords: (): string => '向指定记忆追加关键词，并据此重建记忆图谱关联。',
  remove_memory_keywords: (): string => '从指定记忆移除关键词，并据此重建记忆图谱关联。',
  overwrite_memory_keywords: (): string => '覆盖指定记忆的关键词列表，并据此重建记忆图谱关联。',
  append_memory_tags: (): string => '向指定记忆追加只用于分类和描述元数据的标签。',
  remove_memory_tags: (): string => '从指定记忆移除标签。',
  overwrite_memory_tags: (): string => '覆盖指定记忆的标签列表。',
  create_dynamic_tool: (): string =>
    '创建并持久化 JavaScript 动态工具。代码必须声明 `tool = { name, description, parametersSchema, returnSchema, execute }`；两个 Schema 都必须是 object 类型的标准 JSON Schema，`execute` 必须是 async function。沙盒不能访问网络、文件系统、import 或 require。还必须提供测试参数，只有冒烟测试通过后才会保存。',
  view_dynamic_tool_code: (): string => '读取已有动态工具的完整源代码，以便排查或修改。',
  update_dynamic_tool: (): string => '更新已有动态工具；新代码通过冒烟测试后才会替换当前版本。',
  remove_dynamic_tool: (): string => '从当前工具状态移除不再需要的动态工具。',
  call_dynamic_tool: (): string => '按名称调用已有动态工具，并传入 JSON 格式的参数字符串。',
}

let 英文工具描述: Record<string, () => string> = {
  execute_code: (): string => 'Run JavaScript in a strictly isolated sandbox for calculations and data validation.',
  deep_deduction: (): string => 'Run an isolated expert reasoning process to test a complex hypothesis.',
  add_level_0_memory: (): string => 'Add a core rule or persona memory. Use with extreme care.',
  edit_level_0_memory: (): string => 'Edit an existing core rule or persona memory.',
  remove_level_0_memory: (): string => 'Remove a core rule from the current memory state.',
  add_level_1_memory: (): string => 'Add important current-task information to working memory.',
  edit_level_1_memory: (): string => 'Edit an existing working memory.',
  remove_level_1_memory: (): string => 'Remove an item from the current working-memory state.',
  add_level_2_memory: (): string => 'Store a durable rule, experience, or theory in long-term memory.',
  demote_memory: (): string => 'Move a working memory to long-term memory and reassess its score.',
  promote_memory: (): string => 'Move a long-term memory into working memory and reassess its score.',
  extend_memory: (): string => 'Search and traverse related long-term memories and concepts.',
  append_memory_keywords: (): string => 'Append graph-indexing keywords to a memory.',
  remove_memory_keywords: (): string => 'Remove graph-indexing keywords from a memory.',
  overwrite_memory_keywords: (): string => 'Replace all graph-indexing keywords on a memory.',
  append_memory_tags: (): string => 'Append metadata tags to a memory.',
  remove_memory_tags: (): string => 'Remove metadata tags from a memory.',
  overwrite_memory_tags: (): string => 'Replace all metadata tags on a memory.',
  create_dynamic_tool: (): string =>
    'Create and persist a JavaScript tool. The code must declare `tool = { name, description, parametersSchema, returnSchema, execute }`, where both schemas are object JSON Schemas and `execute` is an async function. The sandbox has no network, file-system, import, or require access. Provide smoke-test arguments; the tool is stored only after the test passes.',
  view_dynamic_tool_code: (): string => 'Read the complete source of an existing dynamic tool.',
  update_dynamic_tool: (): string => 'Update a dynamic tool after a smoke test succeeds.',
  remove_dynamic_tool: (): string => 'Remove a dynamic tool from the current tool state.',
  call_dynamic_tool: (): string => 'Call an existing dynamic tool with JSON arguments.',
}

export let 中文模型语言包: 模型语言包 = {
  工具调用格式标题: (): string => '## 工具调用格式说明',
  工具调用格式说明: (): string =>
    '你需要使用以下特定的 JSON 格式来发起工具调用。\n每次调用工具时, 请**仅**输出一个符合以下格式的 JSON 代码块 (不要有任何前后解释文本):\n```json\n{"type": "function", "function": { "name": "工具名称", "arguments": {"参数名": "参数值"}}}\n```',
  可用工具标题: (): string => '## 可用工具',
  可用工具说明: (): string =>
    '你可以随时调用以下工具来获取信息或执行操作, 在获取足够信息后再提交最终结果。如果单次回复发起多个工具调用，系统会按返回顺序依次执行，后一个工具可以依赖前一个工具产生的外部状态。',
  参数形状标题: (): string => '参数形状',
  返回值标题: (): string => '返回值',
  最终结果标题: (): string => '## 最终结果',
  最终结果说明: (名称): string => `注意: 完成任务后, **请不要直接输出文本结果**, 而是调用 ${名称} 工具提交最终结果。`,
  最终结果格式: (描述, schema): string =>
    `\n预期结果描述: ${描述}\n最终结果参数形状 (JSON Schema):\n\`\`\`json\n${schema}\n\`\`\``,
  提交结果工具描述: (描述): string => `提交最终结果。${描述}`,
  当前时间: (时间): string => `[当前时间: ${时间}]`,
  路径: (路径): string => `路径 [${路径}]`,
  后置验证失败: (错误): string => `你提交的结果未通过后置验证:\n${错误}\n请根据以上错误信息修正后重新提交。`,
  无结构化数据: (名称): string =>
    `你的回复中没有包含有效的结构化数据。请使用 ${名称} 函数调用来提交你的最终结果, 或在回复中包含一个 JSON 代码块, 内容以 \`{"type": "function", "function": {"name":\` 开头, 格式需要符合预期结果的 Schema。`,
  空回复: (): string => '你的回复是空的, 请重新回答。',
  工具已中断: (): string => '操作已中断，工具未执行',
  工具参数无法解析: (参数): string => `参数解析失败: ${参数}`,
  未知工具: (名称): string => `未知工具: ${名称}`,
  工具参数不正确: (错误): string => `工具参数不正确: ${错误}`,
  工具返回截断: (): string => '\n... (因长度限制被截断)',
  多次提交结果: (名称): string => `单次回复只能调用一次 ${名称}。请根据已执行的工具结果重新提交一份唯一的最终结果。`,
  提交结果已中断: (): string => '操作已中断，最终结果未提交',
  提交结果不可混用: (名称): string =>
    `请不要将 ${名称} 与其他普通工具混合调用。已为您执行了其他工具调用，请先查看它们的结果，然后再单独调用 ${名称} 提交最终结果。`,
  提交结果参数无法解析: (名称, 参数): string => `解析函数 ${名称} 的参数失败: ${参数}`,
  提交结果成功: (): string => '结果提交成功',
  提交结果格式错误: (错误, 名称): string => `提交的数据不符合预期格式:\n${错误}\n\n请修复后重新调用 ${名称}`,
  模型字段名: (名称): string => 名称,
  模型枚举值: (值): string => 值,
  记忆工具描述: (名称, 默认描述): string => 中文工具描述[名称]?.() ?? 默认描述,
  默认记忆提示词: (启用工具名): string => 生成中文默认记忆提示词(启用工具名),
  当前零级记忆标题: (): string => '### 当前零级记忆 (核心法则)',
  当前一级记忆标题: (): string => '### 当前一级记忆 (重点关注的工作上下文)',
  无记忆: (): string => '- 无',
  关键词名称: (): string => '关键词',
  评分名称: (): string => '评分',
  记录于名称: (): string => '记录于',
  刚刚: (): string => '刚刚',
  分钟前: (数量): string => `${String(数量)}分钟前`,
  小时前: (数量): string => `${String(数量)}小时前`,
  天前: (数量): string => `${String(数量)}天前`,
  月前: (数量): string => `${String(数量)}个月前`,
  自动召回记忆标题: (): string => '### 本轮自动召回的二级记忆',
  自动召回记忆说明: (): string => '以下长期记忆可能与当前任务有关：',
  自动召回相关概念: (关键词): string =>
    `相关概念: [${关键词.join(', ')}]\n这些只是较弱的关联；在读取准确记忆前，不要把它们归属于当前对象。`,
  当前记忆状态: (内容): string =>
    `### 本轮最新记忆状态\n以下是当前完整状态，如果与历史中更早的记忆状态冲突，以本条为准。\n\n${内容}`,
  自动召回动态工具标题: (): string => '### 自动召回的动态工具',
  自动召回动态工具说明: (): string => '系统召回了以下可能相关的工具。如需使用，请调用 `call_dynamic_tool`。',
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
  深度推演先验标记: (): { 关键词: string; 标签: string } => ({ 关键词: '先验知识', 标签: '前置知识' }),
  深度推演专家标记: (): { 关键词: string; 标签: string } => ({ 关键词: '角色设定', 标签: '系统设定' }),
  记忆完整状态: (数据): string =>
    `[${数据.等级}记忆 ID: ${数据.id}]${数据.评分 === undefined ? '' : ` (评分: ${String(数据.评分)})`} 内容: ${数据.内容} (关键词: ${数据.关键词.join(', ')}, 标签: ${数据.标签.join(', ')})`,
  记忆已移除: (等级, id): string => `[${等级}记忆 ID: ${id}] 已从当前状态移除`,
  记忆已降级: (id, 评分): string => `[记忆 ID: ${id}] 已成功降级为二级长期记忆 (新评分: ${String(评分)})`,
  记忆已捞起: (id, 评分): string => `[记忆 ID: ${id}] 已成功捞回至一级工作记忆区 (新评分: ${String(评分)})`,
  记忆关键词状态: (id, 关键词): string => `[记忆 ID: ${id}] 最新关键词列表: ${关键词.join(', ')}`,
  记忆标签状态: (id, 标签): string => `[记忆 ID: ${id}] 最新标签列表: ${标签.join(', ')}`,
  找不到记忆: (id): string => `找不到指定 ID (${id}) 的记忆。`,
  动态工具参数JSON错误: (字段): string =>
    `参数格式错误：${字段} 不是合法的 JSON 字符串，且自动修复失败。请检查格式后重试。`,
  动态工具代码校验失败: (错误): string => `代码校验失败: ${错误}`,
  动态工具名称已存在: (名称): string => `名称「${名称}」已存在，请使用其他名称或更新已有工具`,
  动态工具冒烟测试失败: (错误): string => `冒烟测试失败: ${错误}`,
  未找到动态工具: (类型, 值): string => `未找到${类型}为「${值}」的动态工具`,
  动态工具新代码校验失败: (错误): string => `新代码校验失败: ${错误}`,
  动态工具更新名称冲突: (名称): string => `更新失败: 新代码中的名称「${名称}」已被其他工具占用`,
  动态工具执行出错: (错误): string => `执行出错: ${错误}`,
  动态工具定义错误: (问题): string => {
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
  动态工具Schema校验失败: (位置, 错误): string => `${位置} 不符合 JSON Schema: ${错误}`,
  动态工具执行超时: (毫秒): string => `动态工具执行超时（${String(毫秒)}ms）`,
  动态工具编译执行出错: (错误): string => `代码编译/执行出错: ${错误}`,
  代码执行超时: (毫秒): string => `代码执行超时（${String(毫秒)}ms）`,
  代码执行输出: (日志, 返回值): string => {
    let 日志文本 = 日志.length > 0 ? `【Console 输出】:\n${日志.join('\n')}\n\n` : ''
    let 返回值文本 = typeof 返回值 === 'object' ? JSON.stringify(返回值, null, 2) : String(返回值)
    return `${日志文本}【Return 结果】:\n${返回值文本}`
  },
}

export let 英文模型语言包: 模型语言包 = {
  ...中文模型语言包,
  工具调用格式标题: (): string => '## Tool call format',
  工具调用格式说明: (): string =>
    'Use the following JSON format to call a tool.\nOutput only one JSON code block in this exact shape, with no surrounding explanation:\n```json\n{"type": "function", "function": { "name": "tool_name", "arguments": {"parameter": "value"}}}\n```',
  可用工具标题: (): string => '## Available tools',
  可用工具说明: (): string =>
    'Use these tools whenever needed. Gather enough information before submitting the final result. Multiple calls in one response execute in order, so later calls may depend on earlier side effects.',
  参数形状标题: (): string => 'Parameters',
  返回值标题: (): string => 'Returns',
  最终结果标题: (): string => '## Final result',
  最终结果说明: (名称): string =>
    `When the task is complete, do not answer with plain text. Call ${名称} to submit the final result.`,
  最终结果格式: (描述, schema): string =>
    `\nExpected result: ${描述}\nFinal result parameters (JSON Schema):\n\`\`\`json\n${schema}\n\`\`\``,
  提交结果工具描述: (描述): string => `Submit the final result. ${描述}`,
  当前时间: (时间): string => `[Current time: ${时间}]`,
  路径: (路径): string => `Path [${路径}]`,
  后置验证失败: (错误): string =>
    `Your result failed post-validation:\n${错误}\nCorrect the result and submit it again.`,
  无结构化数据: (名称): string =>
    `Your response did not contain valid structured data. Submit the final result by calling ${名称}, or include a JSON code block beginning with \`{"type": "function", "function": {"name":\` that matches the expected schema.`,
  空回复: (): string => 'Your response was empty. Try again.',
  工具已中断: (): string => 'Operation aborted; tool not executed.',
  工具参数无法解析: (参数): string => `Could not parse arguments: ${参数}`,
  未知工具: (名称): string => `Unknown tool: ${名称}`,
  工具参数不正确: (错误): string => `Invalid tool arguments: ${错误}`,
  工具返回截断: (): string => '\n... (truncated by length limit)',
  多次提交结果: (名称): string =>
    `Only one ${名称} call is allowed per response. Submit one final result after reviewing the completed tool calls.`,
  提交结果已中断: (): string => 'Operation aborted; the final result was not submitted.',
  提交结果不可混用: (名称): string =>
    `Do not mix ${名称} with ordinary tool calls. Review their results, then call ${名称} separately.`,
  提交结果参数无法解析: (名称, 参数): string => `Could not parse arguments for ${名称}: ${参数}`,
  提交结果成功: (): string => 'Final result submitted successfully.',
  提交结果格式错误: (错误, 名称): string =>
    `Submitted data does not match the expected format:\n${错误}\n\nFix it and call ${名称} again.`,
  模型字段名: (名称): string => 英文字段映射[名称] ?? 名称,
  模型枚举值: (值): string => (值 === '成功' ? 'success' : 值 === '失败' ? 'failure' : 值),
  记忆工具描述: (名称, _默认描述): string => 英文工具描述[名称]?.() ?? `Use the ${名称} tool.`,
  默认记忆提示词: (启用工具名): string => 生成英文默认记忆提示词(启用工具名),
  当前零级记忆标题: (): string => '### Current level 0 memories (core rules)',
  当前一级记忆标题: (): string => '### Current level 1 memories (working context)',
  无记忆: (): string => '- None',
  关键词名称: (): string => 'keywords',
  评分名称: (): string => 'score',
  记录于名称: (): string => 'recorded at ',
  刚刚: (): string => 'just now',
  分钟前: (数量): string => `${String(数量)} minutes ago`,
  小时前: (数量): string => `${String(数量)} hours ago`,
  天前: (数量): string => `${String(数量)} days ago`,
  月前: (数量): string => `${String(数量)} months ago`,
  自动召回记忆标题: (): string => '### Automatically recalled long-term memories',
  自动召回记忆说明: (): string => 'The following long-term memories may be relevant:',
  自动召回相关概念: (关键词): string =>
    `Related concepts: [${关键词.join(', ')}]\nThese are weak associations. Do not attribute them to the current subject without reading the exact memory.`,
  当前记忆状态: (内容): string =>
    `### Current memory state\nThis is the complete current state. If it conflicts with an older memory-state message, use this one.\n\n${内容}`,
  自动召回动态工具标题: (): string => '### Automatically recalled dynamic tools',
  自动召回动态工具说明: (): string => 'The following tools may be relevant. Use `call_dynamic_tool` to run one.',
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
  深度推演先验标记: (): { 关键词: string; 标签: string } => ({ 关键词: 'prior knowledge', 标签: 'prior knowledge' }),
  深度推演专家标记: (): { 关键词: string; 标签: string } => ({ 关键词: 'expert role', 标签: 'system role' }),
  记忆完整状态: (数据): string =>
    `[${数据.等级 === '零级' ? 'Level 0' : 数据.等级 === '一级' ? 'Level 1' : 'Level 2'} memory ID: ${数据.id}]${数据.评分 === undefined ? '' : ` (score: ${String(数据.评分)})`} content: ${数据.内容} (keywords: ${数据.关键词.join(', ')}, tags: ${数据.标签.join(', ')})`,
  记忆已移除: (等级, id): string =>
    `[${等级 === '零级' ? 'Level 0' : 'Level 1'} memory ID: ${id}] removed from the current state`,
  记忆已降级: (id, 评分): string => `[Memory ID: ${id}] moved to level 2 long-term memory (new score: ${String(评分)})`,
  记忆已捞起: (id, 评分): string => `[Memory ID: ${id}] moved to level 1 working memory (new score: ${String(评分)})`,
  记忆关键词状态: (id, 关键词): string => `[Memory ID: ${id}] current keywords: ${关键词.join(', ')}`,
  记忆标签状态: (id, 标签): string => `[Memory ID: ${id}] current tags: ${标签.join(', ')}`,
  找不到记忆: (id): string => `Memory ID ${id} was not found.`,
  动态工具参数JSON错误: (字段): string => `${字段} is not valid JSON and could not be repaired. Fix it and try again.`,
  动态工具代码校验失败: (错误): string => `Code validation failed: ${错误}`,
  动态工具名称已存在: (名称): string =>
    `The name "${名称}" already exists. Use another name or update the existing tool.`,
  动态工具冒烟测试失败: (错误): string => `Smoke test failed: ${错误}`,
  未找到动态工具: (类型, 值): string =>
    `No dynamic tool was found with ${类型 === '标识' ? 'reference' : 'name'} "${值}".`,
  动态工具新代码校验失败: (错误): string => `New code validation failed: ${错误}`,
  动态工具更新名称冲突: (名称): string => `Update failed because the name "${名称}" is already used by another tool.`,
  动态工具执行出错: (错误): string => `Execution failed: ${错误}`,
  动态工具定义错误: (问题): string => {
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
  动态工具Schema校验失败: (位置, 错误): string =>
    `${位置 === '输入参数' ? 'Input arguments' : 'Return value'} do not match the JSON Schema: ${错误}`,
  动态工具执行超时: (毫秒): string => `Dynamic tool execution timed out after ${String(毫秒)} ms.`,
  动态工具编译执行出错: (错误): string => `Code compilation or execution failed: ${错误}`,
  代码执行超时: (毫秒): string => `Code execution timed out after ${String(毫秒)} ms.`,
  代码执行输出: (日志, 返回值): string => {
    let 日志文本 = 日志.length > 0 ? `Console output:\n${日志.join('\n')}\n\n` : ''
    let 返回值文本 = typeof 返回值 === 'object' ? JSON.stringify(返回值, null, 2) : String(返回值)
    return `${日志文本}Return value:\n${返回值文本}`
  },
}
