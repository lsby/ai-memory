import type { LocomoQA } from '../locomo-bridge'

export type GrowthQuestion = LocomoQA & {
  globalIndex: number
}

export type QuestionAnalysisResult = {
  problemCategory: string
  recalledHeuristics: string
  actionPlan: string
}

export type EvaluationQuestionRecord = {
  questionIndex: number
  question: string
  category: number
  goldAnswer: string
  studentAnswer: string
  isCorrect: boolean
  teacherReasoning: string
  recalledHeuristics: string
  actionPlan: string
  elapsedMs: number
}

export type EvaluationSummary = {
  dbPath: string
  evaluatedAt: string
  totalQuestions: number
  correctCount: number
  accuracyPercent: number
  categoryStats: Record<number, { total: number; correct: number; accuracyPercent: number }>
  records: EvaluationQuestionRecord[]
}

export type TeachingRoundRecord = {
  round: number
  questionIndex: number
  category: number
  question: string
  goldAnswer: string
  studentAnswer: string
  isCorrect: boolean
  teacherReasoning: string
  recalledHeuristics: string
  actionPlan: string
  diagnosis: string
  generalizedHeuristic: string
  memoryCountBefore: number
  memoryCountAfter: number
}
