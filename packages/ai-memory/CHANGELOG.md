# @lsby/ai-memory

## 0.6.12

### Patch Changes

- 1bb55cc: 新增回合选项「本轮临时消息」：调用方每回合可传几段文字，只在这一回合发给模型（作为 user 消息放在用户命令之后，工具调用循环里每次请求位置不变），不进入返回的消息列表、新增上下文和存库内容，不影响前缀判断，下一回合不传就消失。ai-memory 透传该选项并补充文档。
- Updated dependencies [1bb55cc]
  - @lsby/ai-agent@0.1.3

## 0.6.11

### Patch Changes

- 8310dd3: 新增流式事件「工具调用参数片段」：模型生成函数调用参数时，边生成边通过回调给出本块片段和已累积的参数全文，调用方可以不等参数传完就拿到内容。ai-memory 的交互日志对该事件只透传、不落库。
- Updated dependencies [8310dd3]
  - @lsby/ai-agent@0.1.2

## 0.6.10

### Patch Changes

- 将 @lsby/ai-agent 的最低依赖版本提升至 0.1.1，确保使用更新后的智能体逻辑。
