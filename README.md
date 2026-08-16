# AI Memory

`@lsby/ai-memory` 是一个绑定 PGlite / pgvector 的 TypeScript 智能体库，面向 OpenAI-compatible 模型提供结构化工具调用与本地、分层的持久化记忆。

> 当前版本为 `0.x`：公共 API 可能在 `1.0.0` 前调整。运行时要求 Node.js 20 或更高版本。

## 功能

- 基于 Zod 的结构化结果与工具调用校验
- OpenAI-compatible 流式智能体
- PGlite / pgvector 本地记忆存储，支持零级、一级、二级记忆
- 关键词、标签、关联图与向量检索
- 快照和完整状态的导入、导出
- 基于 QuickJS 的动态工具执行

## 安装

```bash
pnpm add @lsby/ai-memory
```

如你的应用需要直接创建 OpenAI 客户端或 Zod Schema，请额外安装 `openai` 和 `zod`。

## 最小示例

```ts
import OpenAI from 'openai'
import { z } from 'zod'
import { 带记忆的智能体, 记忆等级 } from '@lsby/ai-memory'

let 客户端 = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] })
let 智能体实例 = new 带记忆的智能体({
  向量模型: { 类型: '无' },
  存储: { 模式: '内存' },
})

try {
  await 智能体实例.批量注入记忆([
    {
      内容: '用户偏好简洁的中文回答。',
      关键词: ['用户', '偏好'],
      标签: ['偏好'],
      评分: 80,
      等级: 记忆等级.一级,
      创建时间: new Date(),
    },
  ])

  let 回答 = await 智能体实例.对话({
    命令: '用一句话说明你记住了什么。',
    预期结果Schema: z.object({ 回答: z.string() }),
    预期结果描述: '包含回答文本的对象',
    openai客户端: 客户端,
    模型名称: 'gpt-4.1-mini',
    回调: async () => {},
  })

  console.log(回答.结果)
} finally {
  await 智能体实例.销毁()
}
```

## 对话与推演

每个智能体实例维护一段独立的对话历史。`对话()` 会在成功后仅追加本轮消息，不会修改已发送的历史，因此后续请求可复用支持前缀缓存的模型提供商缓存。`推演()` 使用当前对话和记忆进行一次只读临时推理：不会写入对话历史，也不会向模型暴露普通工具或记忆写入工具。

`私有反思()` 会读取当前会话并可更新记忆或工具，但不会将反思过程写入对话历史；适合后台整理与经验沉淀。`会话反思()` 则会将完整反思过程作为一轮普通对话保留在历史中，适合需要后续对话直接引用反思过程的场景。

```ts
await 智能体实例.对话({ 命令: '记住我们正在讨论发布计划。' /* 其余请求参数 */ })
await 智能体实例.推演({ 命令: '临时列出风险，不要改变会话。' /* 其余请求参数 */ })
await 智能体实例.对话({ 命令: '继续讨论下一步。' /* 其余请求参数 */ })

智能体实例.重置对话() // 仅清空本实例的对话历史，不删除持久化记忆
```

## 开发与验证

```bash
pnpm install
pnpm run check:all
pnpm test
pnpm run test:coverage
pnpm run build:all
```

单元测试和 CI 中的模型响应均使用 mock，不会请求外部 AI 服务。可选的手动集成测试需要设置下列环境变量，并会向相应模型服务发起真实请求：

```bash
$env:AI_KEY = '...'
$env:AI_BASE_URL = 'https://.../v1'
$env:AI_MODEL = '...'
pnpm run test:integration
```

## 公共 API

所有受支持的导入均来自包根入口：

```ts
import { 带记忆的智能体, 智能体, 记忆等级, 智能体工具 } from '@lsby/ai-memory'
```

不要依赖 `src/` 下的内部模块路径；它们不属于兼容性承诺的一部分。

## 安全边界

动态工具与代码执行只应处理受信任的模型输出或用户代码。QuickJS 隔离了文件、网络等宿主能力；库会在 5 秒后终止超时的执行，但这不是操作系统级安全沙箱。在生产环境中仍应增加进程隔离、资源配额与调用授权。

## 发布前检查

```bash
pnpm run verify:release
pnpm exec npm pack --dry-run
```

发布前请确认包名、版本、许可证和最终包内容；`pnpm publish` 由 `prepublishOnly` 自动执行完整验证。
