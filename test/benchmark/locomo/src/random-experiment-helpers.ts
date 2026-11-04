import type { LocomoParsedSample } from './types'

export interface ExperimentCliOptions {
  configName?: string | undefined
  sourceDbDir?: string | undefined
  poolSize: number
  offset: number
  totalRounds: number
  note?: string | undefined
}

export function parseCliArgs(): ExperimentCliOptions {
  let args = process.argv.slice(2)
  let configName: string | undefined = undefined
  let sourceDbDir: string | undefined = undefined
  let poolSize = 10
  let offset = 0
  let totalRounds = 50
  let note: string | undefined = undefined

  for (let i = 0; i < args.length; i++) {
    let arg = args[i]
    if (arg === undefined) continue

    if (arg.startsWith('--from-db=')) {
      sourceDbDir = arg.slice('--from-db='.length).trim()
    } else if (arg === '--from-db' && args[i + 1] !== undefined) {
      sourceDbDir = args[i + 1]?.trim()
      i++
    } else if (arg.startsWith('--pool=')) {
      poolSize = Number(arg.slice('--pool='.length).trim())
    } else if (arg === '--pool' && args[i + 1] !== undefined) {
      poolSize = Number(args[i + 1]?.trim())
      i++
    } else if (arg.startsWith('--rounds=')) {
      totalRounds = Number(arg.slice('--rounds='.length).trim())
    } else if (arg === '--rounds' && args[i + 1] !== undefined) {
      totalRounds = Number(args[i + 1]?.trim())
      i++
    } else if (arg.startsWith('--offset=')) {
      offset = Number(arg.slice('--offset='.length).trim())
    } else if (arg === '--offset' && args[i + 1] !== undefined) {
      offset = Number(args[i + 1]?.trim())
      i++
    } else if (arg.startsWith('--note=')) {
      note = arg.slice('--note='.length).trim()
    } else if (arg.startsWith('-') === false && configName === undefined) {
      configName = arg.trim()
    }
  }

  return { configName, sourceDbDir, poolSize, offset, totalRounds, note }
}

export function buildEvidenceIndex(
  sample: LocomoParsedSample,
): Map<string, { speaker: string; text: string; dateTime: string; sessionId: number }> {
  let map = new Map<string, { speaker: string; text: string; dateTime: string; sessionId: number }>()
  for (let session of sample.sessions) {
    for (let turn of session.turns) {
      map.set(turn.dia_id, {
        speaker: turn.speaker,
        text: turn.text,
        dateTime: session.dateTime,
        sessionId: session.sessionId,
      })
    }
  }
  return map
}

export interface QuestionStats {
  questionIndex: number
  question: string
  goldAnswer: string
  category: number
  attempts: number
  correct: number
  history: boolean[]
}

export interface RoundRecord {
  round: number
  questionIndex: number
  poolIndex: number
  question: string
  category: number
  goldAnswer: string
  recalledHeuristic?: string
  studentAnswer: string
  isCorrect: boolean
  judgeReasoning: string
  studentReflection: string
  heuristicPersisted: boolean
  elapsedMs: number
}
