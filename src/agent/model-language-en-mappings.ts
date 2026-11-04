export let 英文字段映射: Record<string, string> = {
  结果: 'status',
  信息: 'message',
  消息: 'commit_message',
  错误信息: 'error',
  内容: 'content',
  线索: 'clues',
  评分: 'score',
  新内容: 'new_content',
  新线索: 'new_clues',
  新评分: 'new_score',
  线索列表: 'clues',
  最新状态: 'current_state',
  查询内容: 'query',
  过滤内容: 'filters',
  过滤内容模式: 'filter_mode',
  会话id: 'conversation_id',
  消息id: 'message_id',
  记忆id: 'memory_id',
  记忆提交id: 'memory_commit_id',
  角色: 'role',
  等级: 'level',
  相关度: 'relevance',
  综合: 'overall',
  重叠: 'overlap',
  相似: 'similarity',
  创建时间: 'created_at',
  相关消息: 'related_messages',
  关系: 'relation',
  消息列表: 'messages',
  上下文消息数: 'context_count',
  时间范围: 'time_range',
  开始时间: 'start_time',
  结束时间: 'end_time',
  内容过滤正则表达式: 'content_regex',
  直接联想到的记忆: 'recalled_memories',
  完整记忆: 'complete_memories',
  完整技能: 'complete_skills',
  匹配的线索: 'matched_clues',
  相关记忆: 'related_memories',
  相关技能: 'related_skills',
  闪现出的线索: 'flashing_clues',
  完整记忆数量: 'complete_memory_count',
  完整技能数量: 'complete_skill_count',
  线索来源数量: 'clue_source_count',
  记忆数量: 'memory_count',
  技能数量: 'skill_count',
  技能标识: 'skill_ref',
  技能名称: 'skill_name',
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
  用于联想的一个或多个自然语言内容: 'One or more natural-language contents used for association',
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
  '多个过滤条件的组合方式。"and" 要求全部满足，"or" 要求至少满足一个；默认为 "and"':
    'Combination logic for multiple filters. "and" requires all to match, "or" requires at least one; defaults to "and"',
  '创建时间下界，可传 ISO 日期或时间，包含此边界': 'Absolute creation-time lower bound as an ISO date/time (inclusive)',
  '创建时间上界，可传 ISO 日期或时间，不包含此边界':
    'Absolute creation-time upper bound as an ISO date/time (exclusive)',
  '按绝对创建时间过滤；开始时间包含边界，结束时间不包含边界':
    'Filter by absolute creation time; the start boundary is inclusive and the end boundary is exclusive',

  // graph-rag.ts
  当前想到的一个或多个自然语言内容: 'One or more natural-language thoughts to recall from',
  当前想到的一个或多个自然语言线索: 'One or more natural-language clues to follow',
  内容和线索至少提供一项: 'Provide at least one thought or clue',
  '未配置可用的向量模型，无法联想记忆': 'No usable vector model is configured for memory recall',

  // solve.ts
  说明为什么要执行这次记忆变更: 'Explain why this memory change is needed',

  // skills.ts
  '符合规范的纯 JavaScript 代码字符串': 'Standard compliant pure JavaScript code string',
  '用于冒烟测试的参数 JSON 字符串，必须符合工具定义的参数结构':
    'JSON string of arguments for smoke testing, matching the tool parameter schema',
  '工具的 ID 或名称': 'ID or name of the tool',
  '要更新的工具的 ID 或名称': 'ID or name of the tool to update',
  新的工具代码: 'New tool code',
  '用于冒烟测试的参数 JSON 字符串': 'JSON string of arguments for smoke testing',
  '要删除的工具的 ID 或名称': 'ID or name of the tool to remove',
  要调用的技能的名称: 'Name of the skill to call',
  '传给工具的参数，JSON 字符串格式': 'Arguments passed to the tool, in JSON string format',

  // execute-code.ts
  '要执行的纯 JavaScript 代码字符串，必须包含 return 语句以返回结果。例如: "return 1 + 1;"':
    'Pure JavaScript code string to execute; must include a return statement. E.g.: "return 1 + 1;"',
  '如果代码正常返回，这是将结果序列化后的字符串形式。':
    'Serialized string representation of the returned result if executed successfully.',
  '如果代码执行抛出异常，这是异常的详细信息。': 'Detailed exception message if code execution throws an error.',

  // level-0, 1, 2 memories
  核心法则的内容: 'Content of the core rule',
  未来可能用于联想到这条记忆的自然语言线索: 'Natural-language clues that may help recall this memory in the future',
  修改后的内容: 'Updated content',
  修改后的线索列表: 'Updated clue list',
  记忆的内容: 'Content of the memory',
  '0.0 到 100.0 的浮点数，代表重要程度。分数越低越容易被挤出工作区。':
    'Float from 0.0 to 100.0 representing importance. Lower scores are more easily demoted from working memory.',
  '重新评估这在当前任务的重要度 (0.0 - 100.0)': 'Reassessed importance for the current task (0.0 - 100.0)',
  '作为长期记忆保存的潜力评分 (0.0 - 100.0)': 'Potential importance score as long-term memory (0.0 - 100.0)',
  '0.0 到 100.0 的浮点数，代表这条长期经验的重要度和潜力。':
    'Float from 0.0 to 100.0 representing importance and potential of this long-term memory.',

  // clues
  '需要修改线索的记忆 ID': 'Memory ID whose clues are to be modified',
  需要追加的线索: 'Clues to append',
  需要移除的线索: 'Clues to remove',
  覆盖后的线索: 'New clue list to overwrite with',

  // deep-deduction
  '你希望这个子智能体扮演什么角色（例如: "严谨的数据分析师"）。':
    'The role for the subagent to adopt (e.g. "rigorous data analyst").',
  '需要子智能体去验证的具体猜想或需要解决的问题。': 'Specific hypothesis to verify or problem to solve.',
  '提取出对该任务有用的背景信息，提供给子智能体。在开启纯净模式时，子智能体没有任何记忆，所有需要它知道的信息都必须通过这里传入。':
    'Contextual background information provided to the subagent. In clean mode, the subagent has no memories, so all required context must be passed here.',
  '如果为 true（建议），子智能体将是一个完全空白的纯净环境（无记忆），并且底层系统人设会被彻底替换为专家设定，从而获得最高级别的推演纯净度。如果为 false，子智能体会获得你当前所有记忆的快照副本，并完全继承你的基础人设，"专家设定"只会作为一条强制记忆注入，适合需要大量历史上下文的推演。':
    'If true (recommended), the subagent runs in a completely blank environment without memories, and its underlying system persona is fully replaced by the expert role for maximum reasoning purity. If false, the subagent receives a snapshot of all current memories and fully inherits the base persona; the expert role is injected only as a mandatory memory, which is suitable for reasoning that requires substantial historical context.',
  '子智能体得出的结论或报告。': 'Conclusion or report produced by the subagent.',
}

export let 英文枚举值映射: Record<string, string> = {
  成功: 'success',
  失败: 'failure',
  与: 'and',
  或: 'or',
  零级: 'level_0',
  一级: 'level_1',
  二级: 'level_2',
  未知: 'unknown',
  新增: 'created',
}

export let 英文工具描述: Record<string, () => string> = {
  execute_code: (): string =>
    'Execute pure JavaScript experiments, calculations, or data validations in a strictly isolated sandbox. The sandbox does not support require, filesystem access, or network requests; code executes within an async function, can use await, and MUST return results via a return statement.',
  deep_deduction: (): string =>
    'Launch an isolated expert-level subagent to deeply verify complex hypotheses. An optional clean mode determines whether to inherit historical context or start in a pure slate.',
  add_level_0_memory: (): string =>
    'Add a permanently effective core rule or persona memory without capacity limits. Use with extreme caution.',
  edit_level_0_memory: (): string => 'Modify the content and associative clues of an existing core rule.',
  remove_level_0_memory: (): string => 'Remove an unneeded core rule from the current memory state.',
  add_level_1_memory: (): string =>
    'Add current-task focus and key clues into capacity-limited working memory. When full, lower-scoring memories are automatically demoted.',
  edit_level_1_memory: (): string => 'Modify the content, associative clues, and score of an existing working memory.',
  remove_level_1_memory: (): string => 'Remove an item from the current working memory state instead of demoting it.',
  add_level_2_memory: (): string =>
    'Directly store durable rules, experiences, or theoretical guidelines into automatically recalled long-term memory.',
  demote_memory: (): string => 'Demote a working memory to long-term memory and reassess its importance score.',
  promote_memory: (): string => 'Promote a long-term memory back to working memory and reassess its importance score.',
  search_memories: (): string =>
    'Associate from natural-language contents and return a few complete memories plus broader flashing clues.',
  search_clues: (): string => 'Associate clues from natural-language contents and return related memories and skills.',
  search_skills: (): string =>
    'Associate from natural-language contents and return a few complete skills plus broader flashing clues.',
  append_memory_clues: (): string => 'Append associative clues to a specified memory.',
  remove_memory_clues: (): string => 'Remove associative clues from a specified memory.',
  overwrite_memory_clues: (): string => 'Overwrite the associative clues of a specified memory.',
  create_skill: (): string =>
    'Create and persist a JavaScript skill. The code must declare `skill = { name, description, parametersSchema, returnSchema, execute }`. Provide natural-language clues and smoke-test arguments; the skill is stored only after the test passes.',
  view_skill_code: (): string => 'Read the complete source of an existing skill.',
  update_skill: (): string => 'Update a skill after a smoke test succeeds.',
  remove_skill: (): string => 'Remove a skill from the current skill state.',
  execute_skill: (): string => 'Call an existing skill with JSON arguments.',
}
