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
