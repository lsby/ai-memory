# @lsby/ai-memory

## 0.6.11

### Patch Changes

- 8310dd3: 新增流式事件「工具调用参数片段」：模型生成函数调用参数时，边生成边通过回调给出本块片段和已累积的参数全文，调用方可以不等参数传完就拿到内容。ai-memory 的交互日志对该事件只透传、不落库。
- Updated dependencies [8310dd3]
  - @lsby/ai-agent@0.1.2

## 0.6.10

### Patch Changes

- 将 @lsby/ai-agent 的最低依赖版本提升至 0.1.1，确保使用更新后的智能体逻辑。
