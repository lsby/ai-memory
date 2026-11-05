# @lsby/ai-agent

轻量、无持久记忆依赖的 TypeScript 智能体库，适用于 OpenAI 兼容模型。

```bash
pnpm add @lsby/ai-agent
```

```ts
import { 智能体 } from '@lsby/ai-agent'
```

这个包不依赖 PGlite、pgvector、Transformers、QuickJS 或 Kysely。需要持久化分层记忆时，请安装
[`@lsby/ai-memory`](https://www.npmjs.com/package/@lsby/ai-memory)。

完整文档请参阅[项目仓库](https://github.com/lsby/ai-memory#readme)。
