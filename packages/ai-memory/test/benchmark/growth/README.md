# 智能体成长与经验演化基准 (Growth Benchmark)

本目录独立承载 `@lsby/ai-memory` 的**认知自演化与教学经验沉淀（Teacher-Student Tutoring & Growth Evolution）**流程。

与作为客观测试集的 `locomo` 形成对称设计：

- **`locomo` (测试者)**：负责只读作答与客观评测。支持传入 `--from-db=<path>`，输出包含测分报告与执行数据库副本。
- **`growth` (培育者)**：负责师生教学与经验反思。支持传入 `--from-db=<path>`，输出包含沉淀了二级思维法则的进化后数据库副本。

---

## 核心设计规范

无论 `locomo` 还是 `growth`，均遵循统一的生命周期标准：

1. **统一可选参数**：`--from-db=<path>` 或 `--db=<path>`（可省略）。
2. **安全隔离复制**：
   - 若提供预置数据库：自动执行安全深拷贝至新时间戳目录 `output/<timestamp>-sample-X/db`，绝不污染源库。
   - 若未提供：自动从原始长程对话（Sample 会话）摄取初始事实记忆与消息链。
3. **自包含工件输出**：
   在 `output/<timestamp>-sample-X/` 下统一产生：
   - `db/`：包含完整记忆、线索与交互日志表（可供审计交互细节）的 SQLite/PGlite 数据库。
   - `commit.txt`：当前代码 Git Commit 哈希。
   - `note.txt`：可选的运行说明备注。
   - `REPORT.md` / `trajectory.json`：评测得分报告或教学演化轨迹。

---

## 使用指南

### 1. 运行教学演化流程 (Growth)

```bash
# 模式 A：从头冷启动教学 20 轮（自动从对话建立底座）
pnpm tsx test/benchmark/growth/index.ts --rounds=20 --note="冷启动教学实验"

# 模式 B：基于已有基础库（例如 locomo 之前灌好的库）进行 20 轮教学
pnpm tsx test/benchmark/growth/index.ts --from-db=test/benchmark/locomo/output/xxxx/db --rounds=20
```

### 2. 0 Token 记忆透视镜 (Inspect)

秒级查看任意数据库中长出的二级规则、理论与线索池：

```bash
pnpm tsx test/benchmark/growth/inspect.ts --db=test/benchmark/growth/output/xxxx/db
```

### 3. 用 LoCoMo 验收成长前后的能力变化

```bash
# 测冷启动基线 (Baseline)
pnpm tsx test/benchmark/locomo/index.ts

# 测成长进化后的数据库 (Post-Growth Evaluation)
pnpm tsx test/benchmark/locomo/index.ts --from-db=test/benchmark/growth/output/xxxx/db
```
