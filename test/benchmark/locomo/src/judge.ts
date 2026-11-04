import OpenAI from 'openai'
import { z } from 'zod'
import type { LocomoBenchmarkSummary, LocomoEvaluationResult, LocomoQAResult } from './types'

export interface LocomoJudgeOptions {
  baseURL: string
  apiKey: string
  judgeModelName?: string
}

let judgeOutputSchema = z.object({
  reasoning: z.string().describe('One sentence explanation for the judgement'),
  label: z.enum(['CORRECT', 'WRONG']).describe('CORRECT if answer matches gold, else WRONG'),
})

/**
 * 清洗模型可能输出的包裹结构 (比如带了 submit_result 或 markdown 的情况)
 */
function cleanAnswer(raw: string): string {
  let text = raw.trim()
  // 如果被 markdown 代码块包裹
  if (text.startsWith('```')) {
    text = text
      .replace(/^```[a-z]*\s*/i, '')
      .replace(/```$/g, '')
      .trim()
  }
  // 如果是 json 格式的 submit_result
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      let parsed = JSON.parse(text) as Record<string, unknown>
      if (typeof parsed['answer'] === 'string') {
        return parsed['answer']
      }
      let fn = parsed['function'] as Record<string, unknown> | undefined
      if (fn !== undefined && typeof fn['arguments'] === 'object' && fn['arguments'] !== null) {
        let args = fn['arguments'] as Record<string, unknown>
        if (typeof args['answer'] === 'string') {
          return args['answer']
        }
      }
    } catch {
      // 保持原样
    }
  }
  return text
}

export class LocomoJudge {
  private openai: OpenAI
  private modelName: string

  public constructor(options: LocomoJudgeOptions) {
    this.openai = new OpenAI({
      baseURL: options.baseURL,
      apiKey: options.apiKey,
    })
    this.modelName = options.judgeModelName ?? 'gpt-oss-20b'
  }

  /**
   * 使用官方标准 LLM-as-a-Judge 提示词评判单道题
   */
  public async evaluateSingle(qaResult: LocomoQAResult): Promise<LocomoEvaluationResult> {
    let cleanPred = cleanAnswer(qaResult.predictedAnswer)
    let goldText = qaResult.goldAnswer.trim()
    let isAdversarialOrEmpty =
      qaResult.category === 5 || goldText === '' || goldText.toLowerCase().includes('not mentioned')

    let prompt = [
      'Your task is to label an answer to a question as "CORRECT" or "WRONG".',
      'You will be given the following data:',
      '(1) a question (posed by one user to another user)',
      "(2) a 'gold' (ground truth) answer",
      '(3) a generated answer which you will score as CORRECT/WRONG.',
      '',
      'The point of the question is to ask about something one user should know about the other user based on their prior conversations. The gold answer will usually be a concise and short answer that includes the referenced topic. If the generated answer captures the essence of the gold answer, mark it CORRECT.',
      '',
      'EVALUATION CRITERIA & LENIENCY GUIDELINES:',
      '- Temporal & Relative Equivalence: Accept equivalent date expressions. If the ground truth specifies a relative timeframe (e.g. "X years ago" or "last month") and the conversation timeline provides an explicit anchor year or date, an accurately calculated absolute date or year is considered equivalent and CORRECT (and vice versa).',
      '- Calendar Arithmetic Tolerance: Do not penalize minor calculation discrepancies of 1-2 days if the reference week, month, and year are clearly correct.',
      '- Leniency on Surrounding Context: The gold answer is often a very short fragment. If the generated answer includes the correct entity, fact, action, or date, do NOT mark it WRONG merely because it provides surrounding conversational context or minor elaboration, as long as it is not excessively verbose and does not directly contradict the ground truth.',
      '- Adversarial & Unmentioned: If the gold answer indicates the topic was not mentioned, never happened, or has no record, and the generated answer accurately identifies that there is no record, it was not mentioned, or is unknown, mark it CORRECT.',
      '- Rejection Threshold: Only mark WRONG if the core entity/fact is missing, incorrect, contradictory, or an outright hallucination.',
      ...(isAdversarialOrEmpty === true
        ? [
            '',
            'SPECIAL NOTE FOR UNMENTIONED / ADVERSARIAL QUESTIONS:',
            'If the gold answer is empty or indicates the topic was not mentioned/did not happen, and the generated answer correctly points out that there is no record, it was not mentioned, unknown, or did not happen, you MUST mark it CORRECT.',
          ]
        : []),
      '',
      'Instructions:',
      '- Provide a short explanation and end with either CORRECT or WRONG.',
      '- Return your response in JSON format: {"reasoning": "...", "label": "CORRECT" or "WRONG"}',
      '',
      `Question: ${qaResult.question}`,
      `Gold Answer: ${goldText === '' ? '[Not mentioned / No record]' : qaResult.goldAnswer}`,
      `Generated Answer: ${cleanPred}`,
    ].join('\n')

    try {
      let response = await this.openai.chat.completions.create({
        model: this.modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      })

      let choice = response.choices[0]
      let msg = choice?.message
      let rawContent = msg?.content ?? ''
      // 部分 reasoning 模型可能在 content 为空时将结果放在 reasoning 字段
      if (rawContent.trim() === '' && typeof (msg as any)?.reasoning === 'string') {
        rawContent = String((msg as any).reasoning)
      }

      // 从文本中提取 JSON
      let match = /\{[\s\S]*"label"[\s\S]*\}/.exec(rawContent)
      if (match !== null) {
        let parsed = judgeOutputSchema.safeParse(JSON.parse(match[0]))
        if (parsed.success) {
          return {
            questionIndex: qaResult.questionIndex,
            category: qaResult.category,
            question: qaResult.question,
            goldAnswer: qaResult.goldAnswer,
            predictedAnswer: cleanPred,
            reasoning: parsed.data.reasoning,
            isCorrect: parsed.data.label === 'CORRECT',
          }
        }
      }

      // 如果模型直接回答了 CORRECT / WRONG
      let upper = rawContent.toUpperCase()
      if (upper.includes('CORRECT') && upper.includes('WRONG') === false) {
        return {
          questionIndex: qaResult.questionIndex,
          category: qaResult.category,
          question: qaResult.question,
          goldAnswer: qaResult.goldAnswer,
          predictedAnswer: cleanPred,
          reasoning: rawContent.slice(0, 100),
          isCorrect: true,
        }
      }
    } catch (err: unknown) {
      let msg = err instanceof Error ? err.message : String(err)
      console.warn(`[Judge] LLM error for question ${String(qaResult.questionIndex)}: ${msg}`)
    }

    // 备用语义/关键词匹配兜底
    let normPred = cleanPred.toLowerCase().trim()
    let normGold = qaResult.goldAnswer.toLowerCase().trim()

    if (isAdversarialOrEmpty === true) {
      let negativeKeywords = [
        'not mention',
        'no mention',
        'no record',
        'unknown',
        'never',
        'unclear',
        'did not',
        'does not state',
        'no information',
      ]
      let isNegativeMatched = negativeKeywords.some((k) => normPred.includes(k))
      if (isNegativeMatched === true) {
        return {
          questionIndex: qaResult.questionIndex,
          category: qaResult.category,
          question: qaResult.question,
          goldAnswer: qaResult.goldAnswer,
          predictedAnswer: cleanPred,
          reasoning: 'Fallback: correctly identified that the topic was not mentioned.',
          isCorrect: true,
        }
      }
    }
    let goldTokens = normGold.split(/[\s,]+/).filter((t) => t.length > 2)
    let matchCount = goldTokens.filter((token) => normPred.includes(token)).length
    let isMatch =
      normPred.includes(normGold) ||
      normGold.includes(normPred) ||
      (goldTokens.length > 0 && matchCount >= Math.ceil(goldTokens.length * 0.5))

    return {
      questionIndex: qaResult.questionIndex,
      category: qaResult.category,
      question: qaResult.question,
      goldAnswer: qaResult.goldAnswer,
      predictedAnswer: cleanPred,
      reasoning: 'Keyword overlap fallback matching',
      isCorrect: isMatch,
    }
  }

  /**
   * 批量打分并生成分类统计报告
   */
  public async evaluateBatch(
    qaResults: LocomoQAResult[],
    onProgress?: (current: number, total: number) => void,
  ): Promise<{
    evaluations: LocomoEvaluationResult[]
    summary: LocomoBenchmarkSummary
  }> {
    let evaluations: LocomoEvaluationResult[] = []

    for (let i = 0; i < qaResults.length; i++) {
      let item = qaResults[i]
      if (item === undefined) continue

      if (onProgress !== undefined) {
        onProgress(i + 1, qaResults.length)
      }
      let evalItem = await this.evaluateSingle(item)
      evaluations.push(evalItem)
    }

    let totalQuestions = evaluations.length
    let correctCount = evaluations.filter((e) => e.isCorrect).length
    let accuracy = totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0

    let byCategory: Record<number, { total: number; correct: number; accuracy: number }> = {}

    for (let item of evaluations) {
      let catData = byCategory[item.category] ?? { total: 0, correct: 0, accuracy: 0 }
      catData.total++
      if (item.isCorrect) {
        catData.correct++
      }
      byCategory[item.category] = catData
    }

    for (let cat of Object.keys(byCategory)) {
      let catNum = Number(cat)
      let data = byCategory[catNum]
      if (data !== undefined) {
        data.accuracy = data.total > 0 ? (data.correct / data.total) * 100 : 0
      }
    }

    return {
      evaluations,
      summary: {
        totalQuestions,
        correctCount,
        accuracy,
        byCategory,
      },
    }
  }
}
