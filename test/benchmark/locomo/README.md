# LoCoMo Benchmark 评测套件 (for @lsby/ai-memory)

基于 Snap Research 的 [LoCoMo (Long-term Conversational Memory)](https://github.com/snap-research/locomo) 基准测试集，专门用于评估 `@lsby/ai-memory` 在超长程、多会话社交对话场景下的长程记忆沉淀、图谱延伸检索（Graph RAG）、时序推断及防幻觉能力。

## 目录结构

```text
test/benchmark/locomo/
├── data/
│   └── locomo10.json       # 官方 10 组超长多会话数据集 (CC BY-NC 4.0)
├── types.ts                # TypeScript 类型定义
├── loader.ts               # 数据集加载与会话解析器
├── runner.ts               # 测试执行器（驱动“带记忆的智能体”提取与作答）
├── judge.ts                # LLM-as-a-Judge 自动阅卷评分器
├── run-sample.ts           # 评测启动入口脚本
└── README.md               # 使用说明文档
```

## 运行前准备

### 1. 启动本地模型服务
确保本地模型服务（如 Ollama、vLLM 或 LM Studio 驱动的 GPT-OSS 20B / Qwen2.5 等）已启动，且支持 OpenAI 兼容接口。

### 2. 设置环境变量（可选）
脚本支持以下环境变量配置：

| 环境变量名 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `AI_BASE_URL` | `http://localhost:11434/v1` | 被测模型的 API 地址 |
| `AI_KEY` | `local` | 被测模型的 API Key |
| `AI_MODEL` | `gpt-oss-20b` | 被测模型名称 |
| `JUDGE_BASE_URL` | 同 `AI_BASE_URL` | 裁判模型的 API 地址（建议配置更聪明的模型，如 DeepSeek/GPT-4o-mini） |
| `JUDGE_API_KEY` | 同 `AI_KEY` | 裁判模型的 API Key |
| `JUDGE_MODEL` | 同 `AI_MODEL` | 裁判模型名称 |
| `LOCOMO_SAMPLE_INDEX` | `0` | 测试的 Conversation 样本索引（0~9） |
| `LOCOMO_MAX_SESSIONS` | `全量` | 限制灌入的会话数量（用于快速冒烟测试，如 `3`） |
| `LOCOMO_MAX_QA` | `全量` | 限制测试的问题数量（用于快速冒烟测试，如 `5`） |
| `VERBOSE` | `0` | 设为 `1` 时输出详细的智能体内部工具调用日志 |

## 快速开始

### 冒烟测试（推荐首次运行，只跑 2 个 Session 和 3 道题）

PowerShell 终端执行：

```powershell
$env:AI_BASE_URL="http://localhost:11434/v1"
$env:AI_MODEL="gpt-oss-20b"
$env:LOCOMO_MAX_SESSIONS="2"
$env:LOCOMO_MAX_QA="3"
$env:VERBOSE="1"
pnpm tsx test/benchmark/locomo/run-sample.ts
```

### 完整单样本评测（包含该样本的所有 Session 与近 200 道 QA）

```powershell
$env:AI_BASE_URL="http://localhost:11434/v1"
$env:AI_MODEL="gpt-oss-20b"
pnpm tsx test/benchmark/locomo/run-sample.ts
```

## 输出产物

评测完成后，结果文件将自动保存在 `test/benchmark/locomo/output/` 目录下：
* `predictions-sample-{i}.json`：智能体针对每道题生成的原始回忆回答与对应标准答案。
* `evaluation-sample-{i}.json`：裁判模型出具的详细评判原因、标签以及各题型（Multi-hop, Temporal, Single-hop, Adversarial）的得分率统计。
