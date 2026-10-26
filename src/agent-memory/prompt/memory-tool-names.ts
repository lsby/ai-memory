/**
 * 带记忆的智能体挂给模型的记忆专用工具名。
 * 用在 记忆工具筛选 和 记忆提示词(函数形式) 里, 调用方不用手写字符串。
 * 注意: 深度推演 同时受 禁用深度推演 控制, 两者任一关闭就不挂。
 */
export let 记忆工具名 = {
  执行代码: 'execute_code',
  深度推演: 'deep_deduction',
  添加零级记忆: 'add_level_0_memory',
  修改零级记忆: 'edit_level_0_memory',
  移除零级记忆: 'remove_level_0_memory',
  添加一级记忆: 'add_level_1_memory',
  修改一级记忆: 'edit_level_1_memory',
  移除一级记忆: 'remove_level_1_memory',
  添加二级记忆: 'add_level_2_memory',
  降级记忆为二级: 'demote_memory',
  捞起记忆到一级: 'promote_memory',
  回忆延伸: 'extend_memory',
  追加记忆关键词: 'append_memory_keywords',
  移除记忆关键词: 'remove_memory_keywords',
  覆盖记忆关键词: 'overwrite_memory_keywords',
  追加记忆标签: 'append_memory_tags',
  移除记忆标签: 'remove_memory_tags',
  覆盖记忆标签: 'overwrite_memory_tags',
  创建动态工具: 'create_dynamic_tool',
  查看动态工具代码: 'view_dynamic_tool_code',
  更新动态工具: 'update_dynamic_tool',
  移除动态工具: 'remove_dynamic_tool',
  调用动态工具: 'call_dynamic_tool',
} as const

export type 记忆工具名类型 = (typeof 记忆工具名)[keyof typeof 记忆工具名]

/** 全部记忆工具名, 顺序和挂给模型的顺序一致 */
export let 全部记忆工具名: readonly 记忆工具名类型[] = Object.values(记忆工具名)
