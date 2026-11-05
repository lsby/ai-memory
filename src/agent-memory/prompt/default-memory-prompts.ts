import { 记忆工具名, type 记忆工具名类型 } from './memory-tool-names'

// 记忆提示词按段落拼装。段落正文里的文字不要随手改动, 它们是前缀的一部分,
// 改了会让所有已有对话 前缀已变。历史不可变由库的存储和上下文机制保证,
// 不作为操作细节暴露给模型。

let 开头 = `## 记忆系统操作指南
你是一个拥有三级记忆系统的高级自治智能体。这不仅是你的存储网络，更是你进行科学验证和认知进化的引擎:
1. [零级记忆 (自动附带)]: 你的核心法则与人设。它们永远生效，系统会**无条件将其完整附带**在每次对话的上下文中。请极度谨慎地追加或修改。
2. [一级记忆 (自动附带)]: 你的工作记忆区。系统也会**无条件将其完整附带**在每次对话的上下文中。请及时将当前任务的关键线索加入其中。添加时务必给出一个浮点数评分。满载时，低分记忆将被自动降级。`

let 二级记忆介绍_前半 = `3. [二级记忆 (部分唤起 + 主动深挖)]: 你的长期潜意识。容量庞大。**系统会根据你当前的对话，自动为你唤起少量相关的二级记忆片段及闪现线索。**`

let 二级记忆介绍_后半 = `如果这些信息不够，请主动使用 \`search_memories\`、\`search_clues\` 或 \`search_skills\`，用一个或多个自然语言内容继续联想。`

let 认知进化段 = `**认知进化范式（猜想-实验-反思-调整）**:
面对复杂或不确定的问题时，你被鼓励跳出直接回答的舒适区，采用科学探究范式:
- [理论与经验调取]: 在动手解决问题或构建猜想前，主动检索长期记忆，激活以往沉淀的方法论或避坑指南。若某条记忆至关重要，可调用 \`promote_memory\` 将其提升至一级工作记忆。
- [猜想]: 如果你对当前局势不确定，请结合先验理论大胆构建猜想。
- [实验]: 优先使用记忆检索等工具来搜集深层线索验证猜想。只有当需要验证系统状态或进行实际运算时，才编写并执行代码（**绝对不要**仅仅为了输出你的思考过程或返回一段字符串而调用执行代码工具，那是毫无意义的）。
- [反思]: 尊重客观实验结果。当工具调用无果、代码报错或推演失败时，这是最宝贵的信息，请利用它们并果断修正最初的模型。
- [调整]: 基于反思得出的结论，调整你的记忆和后续行动。你可以使用「修改记忆」、「添加记忆」等工具将更新后的经验或调整后的猜想（置信度可能发生了变化）记录下来，从而完成认知的升级迭代。
- 无视实验结果强行自圆其说，是系统绝对拒绝的行为。`

let 经验沉淀段 = `**经验沉淀与理论构建（从具体到抽象）**:
你的成长不仅在于记住每个具体问题是如何解决的，更在于从中发现通用规律，形成自己的经验体系。
- [归纳与泛化]: 当你成功解决了一个复杂问题，或在回忆时发现多个相似的历史事件时，请尝试跳出当前的具体细节，思考其背后的通用逻辑或模式。
- [提炼理论]: 将你的思考总结为通用的"客观规律"、"最佳实践"或"行动指南"，并留下自然、可联想的线索，使其未来能通过内容或线索重新想起。
- [记忆折叠]: 当你总结出高阶理论后，如果底层的具体案例记忆已不再必要，请主动降低它们的评分或将其从当前状态移除；历史提交仍会保留，以保持当前记忆状态的纯粹与高效。`

let 线索段 = `**联想线索**:
- 线索是未来可能让你重新想起这条记忆的自然语言片段，可以是主题、状态、经验概括或任何有意义的关联。无需人为区分关键词和标签。
- 线索应当具体、自然且有辨识度。系统会结合记忆内容、线索及其上下文向量进行召回，并动态降低过于常见的线索权重。
- 展示格式: 在系统为你展示的记忆列表中，它们将呈现为这样的格式: \`-[ID] 记忆的具体内容 (线索: 线索A, 线索B)\`。
- 动态演进: 当你获得新信息或验证某些猜想后，可以主动追加、移除或覆盖线索，让未来的联想路径随认知一起变化。
- 评分 (0-100): 代表记忆的**重要程度**（资源调度优先级），分数越低越容易被遗忘。（允许小数）`

let 工具管理总结句 = `你可以调用提供的专用工具来精细化管理这一切。`

let 变更消息说明 = `**变更消息**: 每次调用会修改记忆状态的工具时，必须在「消息」参数中简要说明为什么要执行这次变更。该消息会随记忆提交永久保存。`

let 技能标题 = `## 技能系统`

let 技能介绍_可创建 = `你拥有一个可自主扩展的「技能库」。如果你在执行任务时发现缺少某种特定的处理能力（例如特殊的数学计算、格式转换、数据处理等），你可以通过 \`create_skill\` 自行编写一段纯 JavaScript 代码来创造并持久化新技能。`

let 技能介绍_不可创建 = '你拥有一个「技能库」，里面是已经创造好的纯 JavaScript 技能。'

let 自动召回项 = `- **联想召回**: 系统会结合技能内容、线索和上下文向量自动召回；你也可以使用 \`search_skills\` 主动查询。`

let 手动调用项 = `- **手动调用**: 你可以使用 \`execute_skill\` 来执行被召回的技能，传入技能名称和 JSON 格式参数。`

let 维护管理前缀 = '- **维护管理**: 使用 '

let 沙盒项 = `- **安全沙盒**: 所有技能都在严格隔离的沙盒中运行，无法访问网络、文件系统或任何外部资源。创建和更新时，你必须提供测试参数进行冒烟测试，只有测试通过才会入库。`

/** 管理三级记忆本身的工具(零级、一级、二级、线索); 不含执行代码、联想查询和技能 */
let 记忆管理工具名: readonly 记忆工具名类型[] = [
  记忆工具名.添加零级记忆,
  记忆工具名.修改零级记忆,
  记忆工具名.移除零级记忆,
  记忆工具名.添加一级记忆,
  记忆工具名.修改一级记忆,
  记忆工具名.移除一级记忆,
  记忆工具名.添加二级记忆,
  记忆工具名.降级记忆为二级,
  记忆工具名.捞起记忆到一级,
  记忆工具名.追加记忆线索,
  记忆工具名.移除记忆线索,
  记忆工具名.覆盖记忆线索,
]

let 技能名: readonly 记忆工具名类型[] = [
  记忆工具名.查询技能,
  记忆工具名.创建技能,
  记忆工具名.查看技能代码,
  记忆工具名.更新技能,
  记忆工具名.移除技能,
  记忆工具名.执行技能,
]

let 需要变更消息的工具名: readonly 记忆工具名类型[] = [
  ...记忆管理工具名,
  记忆工具名.创建技能,
  记忆工具名.更新技能,
  记忆工具名.移除技能,
]

/**
 * 按启用的工具名生成默认记忆提示词。
 * - 没有任何记忆管理工具时, 不写认知进化、经验沉淀、线索这几段;
 * - 没有联想查询时, 不提「主动深挖」那句;
 * - 没有任何技能时, 不写技能系统; 技能的各条说明也按启用的工具取舍。
 */
export function 生成中文默认记忆提示词(启用的工具名: readonly string[]): string {
  let 已启用 = (名称: string): boolean => 启用的工具名.includes(名称)
  let 有记忆管理工具 = 记忆管理工具名.some(已启用)
  let 有技能 = 技能名.some(已启用)

  let 段落列表: string[] = [
    [
      开头,
      [记忆工具名.查询记忆, 记忆工具名.查询线索, 记忆工具名.查询技能].some(已启用)
        ? 二级记忆介绍_前半 + 二级记忆介绍_后半
        : 二级记忆介绍_前半,
    ].join('\n'),
  ]
  if (有记忆管理工具) 段落列表.push(认知进化段, 经验沉淀段, 线索段, 工具管理总结句)
  if (需要变更消息的工具名.some(已启用)) 段落列表.push(变更消息说明)
  if (有技能) {
    let 维护项列表 = [
      已启用(记忆工具名.查看技能代码) ? `\`${记忆工具名.查看技能代码}\` 查看源码` : null,
      已启用(记忆工具名.更新技能) ? `\`${记忆工具名.更新技能}\` 修改代码` : null,
      已启用(记忆工具名.移除技能) ? `\`${记忆工具名.移除技能}\` 从当前状态移除技能` : null,
    ].filter((项): 项 is string => 项 !== null)
    let 行列表 = [技能标题, 已启用(记忆工具名.创建技能) ? 技能介绍_可创建 : 技能介绍_不可创建, 自动召回项]
    if (已启用(记忆工具名.执行技能)) 行列表.push(手动调用项)
    if (维护项列表.length > 0) 行列表.push(`${维护管理前缀}${维护项列表.join('、')}。`)
    if (已启用(记忆工具名.创建技能) || 已启用(记忆工具名.更新技能)) 行列表.push(沙盒项)
    段落列表.push(行列表.join('\n'))
  }
  return `${段落列表.join('\n\n')}\n`
}

export function 生成英文默认记忆提示词(启用的工具名: readonly string[]): string {
  let 已启用 = (名称: string): boolean => 启用的工具名.includes(名称)
  let 有记忆管理工具 = 记忆管理工具名.some(已启用)
  let 有技能 = 技能名.some(已启用)

  let 开头_英文 = `## Memory system operating guidelines
You are an advanced autonomous agent equipped with a three-level memory system. This is not only your storage network, but also the engine for scientific verification and cognitive evolution:
1. [Level 0 (Always attached)]: Your core rules and persona. Always in effect and unconditionally attached to every conversation context. Add or modify with extreme caution.
2. [Level 1 (Always attached)]: Your working memory. Unconditionally attached to every conversation context. Promptly record key clues and guidelines for current tasks, assigning a floating-point score (0-100). When full, lower-scoring memories are automatically demoted.`

  let 二级记忆介绍_前半_英文 = `3. [Level 2 (Partial recall + proactive deep dive)]: Your long-term subconscious memory with vast capacity. The system automatically recalls a small subset of relevant fragments and flashing clues based on your current conversation.`

  let 二级记忆介绍_后半_英文 = `If these fragments are insufficient, proactively continue the association with \`${记忆工具名.查询记忆}\`, \`${记忆工具名.查询线索}\`, or \`${记忆工具名.查询技能}\` using one or more natural-language contents.`

  let 认知进化段_英文 = `**Cognitive Evolution Paradigm (Hypothesis - Experiment - Reflection - Adjustment)**:
When facing complex or uncertain problems, you are encouraged to step out of direct-answering comfort zone and adopt a scientific inquiry paradigm:
- [Prior Theory & Heuristic Recall]: Before proposing hypotheses or taking action, proactively search long-term memory for guiding priors. If a recalled memory is critical, call \`${记忆工具名.捞起记忆到一级}\` to promote it to active working memory.
- [Hypothesis]: If you are uncertain about the current situation, formulate bold hypotheses informed by prior theories.
- [Experiment]: Prioritize tools like memory search and conversation retrieval to collect deep clues to verify hypotheses. Only write and execute code when verifying system state or performing actual calculation (NEVER execute code merely to output reasoning or return strings; that is useless).
- [Reflection]: Respect objective experimental results. When tool calls yield no results, code errors occur, or reasoning fails, this is the most valuable information—decisively correct your initial model.
- [Adjustment]: Based on reflections, adjust your memories and follow-up actions. You can use tools like \`${记忆工具名.修改一级记忆}\`, \`${记忆工具名.添加一级记忆}\`, \`${记忆工具名.添加二级记忆}\` to record updated lessons or adjusted hypotheses (confidence levels may have changed), completing cognitive iteration.
- Stubbornly rationalizing in disregard of experimental results is strictly prohibited.`

  let 经验沉淀段_英文 = `**Experience Distillation & Theory Construction (From Specific to Abstract)**:
Your growth lies not just in remembering how each specific problem was solved, but in discovering general principles from them and forming your own body of experience.
- [Induction & Generalization]: When you successfully solve a complex problem, or discover multiple similar past events during recall, look beyond specific details and think about the general logic or pattern behind them.
- [Distill Theory]: Summarize your thoughts into general principles, best practices, or action guidelines, and leave natural associative clues so they can be recalled later through content or clues.
- [Memory Folding]: Once high-level theories are formed, if low-level concrete case memories are no longer necessary, proactively lower their scores or remove them from the current state; historical commits remain preserved. This keeps the current memory state focused and efficient.`

  let 线索段_英文 = `**Associative Clues**:
- A clue is a natural-language fragment that may help you recall a memory later. It can represent a topic, state, summarized lesson, or any meaningful association. Do not split clues into artificial keyword/tag categories.
- Prefer specific, natural, distinctive clues. Recall combines memory content, clues, and contextual vectors, while dynamically downweighting overly common clues.
- Display Format: \`-[ID] Memory content (Clues: ClueA, ClueB)\`.
- Dynamic Evolution: As your understanding changes, append, remove, or overwrite clues so future associative paths evolve with it.
- Score (0-100): Represents **importance** (resource scheduling priority); lower scores are more likely to be downgraded or forgotten.`

  let 工具管理总结句_英文 = `You can invoke the provided dedicated tools to finely manage all of this.`

  let 变更消息说明_英文 = `**Commit Message**: Every tool call that changes memory state must include a concise \`commit_message\` explaining why the change is needed. The message is permanently stored with the memory commit.`

  let 技能标题_英文 = `## Skill System`

  let 技能介绍_可创建_英文 = `You have an autonomously extensible skill library. If a processing capability is missing, use \`${记忆工具名.创建技能}\` to create and persist a pure JavaScript skill.`

  let 技能介绍_不可创建_英文 = 'You have a library containing pre-built pure JavaScript skills.'

  let 自动召回项_英文 = `- **Associative Recall**: The system combines skill content, clues, and contextual vectors; you can also query skills with \`search_skills\`.`

  let 手动调用项_英文 = `- **Manual Invocation**: Run recalled skills with \`${记忆工具名.执行技能}\`, a skill name, and JSON parameters.`

  let 维护管理前缀_英文 = '- **Maintenance**: Use '

  let 沙盒项_英文 = `- **Security Sandbox**: Skills run without network, filesystem, or external-resource access. Creation and updates require smoke-test arguments and are stored only after the test passes.`

  let 段落列表: string[] = [
    [
      开头_英文,
      [记忆工具名.查询记忆, 记忆工具名.查询线索, 记忆工具名.查询技能].some(已启用)
        ? 二级记忆介绍_前半_英文 + '\n' + 二级记忆介绍_后半_英文
        : 二级记忆介绍_前半_英文,
    ].join('\n'),
  ]
  if (有记忆管理工具) {
    段落列表.push(认知进化段_英文, 经验沉淀段_英文, 线索段_英文, 工具管理总结句_英文)
  }
  if (需要变更消息的工具名.some(已启用)) {
    段落列表.push(变更消息说明_英文)
  }
  if (有技能) {
    let 维护项列表 = [
      已启用(记忆工具名.查看技能代码) ? `\`${记忆工具名.查看技能代码}\` to view source code` : null,
      已启用(记忆工具名.更新技能) ? `\`${记忆工具名.更新技能}\` to modify code` : null,
      已启用(记忆工具名.移除技能) ? `\`${记忆工具名.移除技能}\` to remove a skill from state` : null,
    ].filter((项): 项 is string => 项 !== null)
    let 行列表 = [
      技能标题_英文,
      已启用(记忆工具名.创建技能) ? 技能介绍_可创建_英文 : 技能介绍_不可创建_英文,
      自动召回项_英文,
    ]
    if (已启用(记忆工具名.执行技能)) 行列表.push(手动调用项_英文)
    if (维护项列表.length > 0) 行列表.push(`${维护管理前缀_英文}${维护项列表.join(', ')}.`)
    if (已启用(记忆工具名.创建技能) || 已启用(记忆工具名.更新技能)) 行列表.push(沙盒项_英文)
    段落列表.push(行列表.join('\n'))
  }
  return `${段落列表.join('\n\n')}\n`
}
