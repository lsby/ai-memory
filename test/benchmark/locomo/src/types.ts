import type { 模型审计汇总 } from '../../../../src/agent/types'

export interface LocomoTurn {
  speaker: string
  dia_id: string
  text: string
  img_url?: string | undefined
  blip_caption?: string | undefined
}

export interface LocomoParsedSession {
  sessionId: number
  dateTime: string
  turns: LocomoTurn[]
}

export interface LocomoQA {
  question: string
  answer: string | number
  evidence: string[]
  category: number
}

export interface LocomoParsedSample {
  sampleId: string
  speakerA: string
  speakerB: string
  sessions: LocomoParsedSession[]
  qa: LocomoQA[]
}

export interface LocomoQAResult {
  questionIndex: number
  question: string
  category: number
  goldAnswer: string
  predictedAnswer: string
  evidence: string[]
  elapsedMs?: number | undefined
}

export interface LocomoEvaluationResult {
  questionIndex: number
  category: number
  question: string
  goldAnswer: string
  predictedAnswer: string
  reasoning: string
  isCorrect: boolean
}

export interface LocomoBenchmarkTiming {
  ingestTimeMs: number
  reorganizeTimeMs?: number | undefined
  answerTimeMs: number
  judgeTimeMs: number
  totalTimeMs: number
  avgSessionTimeMs: number
  avgQATimeMs: number
}

export interface LocomoAuditStats {
  modelAudit: 模型审计汇总
  memoryStats: {
    total: number
    level0: number
    level1: number
    level2: number
  }
}

export interface LocomoBenchmarkSummary {
  configName?: string | undefined
  note?: string | undefined
  fromDb?: string | undefined
  reorganizeRounds?: number | undefined
  totalQuestions: number
  correctCount: number
  accuracy: number
  timing?: LocomoBenchmarkTiming | undefined
  audit?: LocomoAuditStats | undefined
  byCategory: Record<
    number,
    {
      total: number
      correct: number
      accuracy: number
    }
  >
}
