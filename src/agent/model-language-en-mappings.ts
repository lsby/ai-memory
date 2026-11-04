export let 英文字段映射: Record<string, string> = {
  结果: 'status',
  信息: 'message',
  消息: 'commit_message',
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
  过滤内容: 'filters',
  过滤内容模式: 'filter_mode',
  会话id: 'conversation_id',
  消息id: 'message_id',
  记忆id: 'memory_id',
  角色: 'role',
  上下文消息数: 'context_count',
  时间范围: 'time_range',
  基准: 'base_time',
  开始相对天数: 'start_relative_days',
  结束相对天数: 'end_relative_days',
  关键词过滤: 'keyword_filter',
  标签过滤: 'tag_filter',
  内容过滤正则表达式: 'content_regex',
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

export let 英文描述映射: Record<string, string> = {
  // conversation-search.ts
  限定当前会话谱系中的某个会话: 'Limit search to a specific conversation within the current conversation lineage',
  精确限定一条消息: 'Pinpoint an exact single message',
  限定与某条记忆创建过程相关的消息: 'Limit search to messages involved in creating a specific memory',
  按消息角色过滤: 'Filter by message role',
  只对消息的文本内容执行正则过滤: 'Regular expression filter applied strictly to the message text content',
  对向量检索结果施加的精确过滤条件: 'Precise filtering criteria applied to vector search results',
  '必填的自然语言查询，用于生成查询向量并按语义相似度召回消息':
    'Required natural-language query used to generate query vectors and recall messages by semantic similarity',
  '为每条命中消息附带谱系顺序中前后各多少条消息，默认5':
    'Number of contextual messages before and after each hit in chronological order, default 5',

  // search-parameters.ts
  '多个过滤条件的组合方式。“与”要求全部满足，“或”要求至少满足一个；默认为“与”':
    'Combination logic for multiple filters. "and" requires all to match, "or" requires at least one; defaults to "and"',
  '相对时间的计算基准，可传 ISO 日期或时间；不填时使用当前时间':
    'Base reference timestamp for relative time calculation (ISO date/time); defaults to current time if omitted',
  '开始时间等于基准减去该天数，包含此边界':
    'Start time equals base time minus this number of days (inclusive boundary)',
  '结束时间等于基准减去该天数，不包含此边界':
    'End time equals base time minus this number of days (exclusive boundary)',
  '按创建时间过滤；所有相对天数均以同一个基准计算':
    'Filter by creation time; all relative days are computed from the same base reference',

  // graph-rag.ts
  逐项精确匹配记忆表的关键词数组: 'Match keywords in the memory keyword list item by item',
  逐项精确匹配记忆表的标签数组: 'Match tags in the memory tag list item by item',
  '必填的自然语言查询，仅用于生成查询向量并按语义相似度召回记忆':
    'Required natural-language vector query used to recall memories by semantic similarity',

  // solve.ts
  说明为什么要执行这次记忆变更: 'Explain why this memory change is needed',

  // dynamic-tools.ts
  '符合规范的纯 JavaScript 代码字符串': 'Standard compliant pure JavaScript code string',
  '用于冒烟测试的参数 JSON 字符串，必须符合工具定义的参数结构':
    'JSON string of arguments for smoke testing, matching the tool parameter schema',
  '工具的 ID 或名称': 'ID or name of the tool',
  '要更新的工具的 ID 或名称': 'ID or name of the tool to update',
  新的工具代码: 'New tool code',
  '用于冒烟测试的参数 JSON 字符串': 'JSON string of arguments for smoke testing',
  '要删除的工具的 ID 或名称': 'ID or name of the tool to remove',
  要调用的动态工具的名称: 'Name of the dynamic tool to call',
  '传给工具的参数，JSON 字符串格式': 'Arguments passed to the tool, in JSON string format',

  // execute-code.ts
  '要执行的纯 JavaScript 代码字符串，必须包含 return 语句以返回结果。例如: "return 1 + 1;"':
    'Pure JavaScript code string to execute; must include a return statement. E.g.: "return 1 + 1;"',
  '如果代码正常返回，这是将结果序列化后的字符串形式。':
    'Serialized string representation of the returned result if executed successfully.',
  '如果代码执行抛出异常，这是异常的详细信息。': 'Detailed exception message if code execution throws an error.',

  // level-0, 1, 2 memories
  核心法则的内容: 'Content of the core rule',
  '相关关键词提取，用于构建知识图谱': 'Relevant keywords extracted to build the knowledge graph',
  '元数据标签，用于分类和描述（例如 "系统设定"、"事实" 等）':
    'Metadata tags for categorization and description (e.g. "system_setting", "fact")',
  修改后的内容: 'Updated content',
  修改后的关键词列表: 'Updated keywords list',
  修改后的标签列表: 'Updated tags list',
  记忆的内容: 'Content of the memory',
  '相关关键词提取，将依据这些关键词自动构建记忆关联图谱':
    'Keywords extracted to automatically build the memory association graph',
  '元数据标签，用于分类和描述（例如 "临时猜想"、"置信度:80%" 等）':
    'Metadata tags for categorization and description (e.g. "hypothesis", "confidence:80%")',
  '0.0 到 100.0 的浮点数，代表重要程度。分数越低越容易被挤出工作区。':
    'Float from 0.0 to 100.0 representing importance. Lower scores are more easily demoted from working memory.',
  '重新评估这在当前任务的重要度 (0.0 - 100.0)': 'Reassessed importance for the current task (0.0 - 100.0)',
  '作为长期记忆保存的潜力评分 (0.0 - 100.0)': 'Potential importance score as long-term memory (0.0 - 100.0)',
  '元数据标签，用于分类和描述（例如 "经验总结"、"可复用" 等）':
    'Metadata tags for categorization and description (e.g. "experience_summary", "reusable")',
  '0.0 到 100.0 的浮点数，代表这条长期经验的重要度和潜力。':
    'Float from 0.0 to 100.0 representing importance and potential of this long-term memory.',

  // keyword & tag
  '需要修改关键词的记忆 ID': 'Memory ID whose keywords are to be modified',
  需要追加的关键词列表: 'List of keywords to append',
  需要移除的关键词列表: 'List of keywords to remove',
  覆盖后的新关键词列表: 'New list of keywords to overwrite with',
  '需要修改标签的记忆 ID': 'Memory ID whose tags are to be modified',
  需要追加的标签列表: 'List of tags to append',
  需要移除的标签列表: 'List of tags to remove',
  覆盖后的新标签列表: 'New list of tags to overwrite with',

  // deep-deduction
  '你希望这个子智能体扮演什么角色（例如: "严谨的数据分析师"）。':
    'The role for the subagent to adopt (e.g. "rigorous data analyst").',
  '需要子智能体去验证的具体猜想或需要解决的问题。': 'Specific hypothesis to verify or problem to solve.',
  '提取出对该任务有用的背景信息，提供给子智能体。在开启纯净模式时，子智能体没有任何记忆，所有需要它知道的信息都必须通过这里传入。':
    'Contextual background information provided to the subagent. In clean mode, the subagent has no memories, so all required context must be passed here.',
  '如果为 true（建议），子智能体将是一个完全空白的纯净环境（无记忆），并且底层系统人设会被彻底替换为专家设定，从而获得最高级别的推演纯净度。如果为 false，子智能体会获得你当前所有记忆的快照副本，并完全继承你的基础人设，"专家设定"只会作为一条强制记忆注入，适合需要大量历史上下文的推演。':
    'If true (recommended), subagent runs in a blank environment without memories, replacing system persona with expert role. If false, subagent inherits memory snapshots and persona.',
  '子智能体得出的结论或报告。': 'Conclusion or report produced by the subagent.',
}

export let 英文工具描述: Record<string, () => string> = {
  execute_code: (): string =>
    'Execute pure JavaScript experiments, calculations, or data validations in a strictly isolated sandbox. The sandbox does not support require, filesystem access, or network requests; code executes within an async function, can use await, and MUST return results via a return statement.',
  deep_deduction: (): string =>
    'Launch an isolated expert-level subagent to deeply verify complex hypotheses. An optional clean mode determines whether to inherit historical context or start in a pure slate.',
  add_level_0_memory: (): string =>
    'Add a permanently effective core rule or persona memory without capacity limits. Use with extreme caution.',
  edit_level_0_memory: (): string => 'Modify the content, keywords, and tags of an existing core rule.',
  remove_level_0_memory: (): string => 'Remove an unneeded core rule from the current memory state.',
  add_level_1_memory: (): string =>
    'Add current-task focus and key clues into capacity-limited working memory. When full, lower-scoring memories are automatically demoted.',
  edit_level_1_memory: (): string => 'Modify the content, keywords, tags, and score of an existing working memory.',
  remove_level_1_memory: (): string => 'Remove an item from the current working memory state instead of demoting it.',
  add_level_2_memory: (): string =>
    'Directly store durable rules, experiences, or theoretical guidelines into automatically recalled long-term memory.',
  demote_memory: (): string => 'Demote a working memory to long-term memory and reassess its importance score.',
  promote_memory: (): string => 'Promote a long-term memory back to working memory and reassess its importance score.',
  extend_memory: (): string =>
    'Search long-term memory using natural-language vector similarity, optionally filter by relative time, keywords, tags, or a regex over memory content, and traverse related concepts along the memory graph. Filters use AND by default and may use OR.',
  append_memory_keywords: (): string =>
    'Append keywords to a specified memory and rebuild memory graph connections accordingly.',
  remove_memory_keywords: (): string =>
    'Remove keywords from a specified memory and rebuild memory graph connections accordingly.',
  overwrite_memory_keywords: (): string =>
    'Overwrite the keyword list of a specified memory and rebuild memory graph connections accordingly.',
  append_memory_tags: (): string =>
    'Append metadata tags to a specified memory for categorization and state description.',
  remove_memory_tags: (): string => 'Remove tags from a specified memory.',
  overwrite_memory_tags: (): string => 'Overwrite the tag list of a specified memory.',
  create_dynamic_tool: (): string =>
    'Create and persist a JavaScript tool. The code must declare `tool = { name, description, parametersSchema, returnSchema, execute }`, where both schemas are object JSON Schemas and `execute` is an async function. The sandbox has no network, file-system, import, or require access. Provide smoke-test arguments; the tool is stored only after the test passes.',
  view_dynamic_tool_code: (): string => 'Read the complete source of an existing dynamic tool.',
  update_dynamic_tool: (): string => 'Update a dynamic tool after a smoke test succeeds.',
  remove_dynamic_tool: (): string => 'Remove a dynamic tool from the current tool state.',
  call_dynamic_tool: (): string => 'Call an existing dynamic tool with JSON arguments.',
}
