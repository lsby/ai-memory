import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dateCalculatorTool } from '../locomo/src/date-calculator'
import { LocomoJudge } from '../locomo/src/judge'
import { loadLocomoSamples } from '../locomo/src/loader'
import type { LocomoParsedSample, LocomoParsedSession, LocomoQA, LocomoTurn } from '../locomo/src/types'

let __dirname = path.dirname(fileURLToPath(import.meta.url))

export { dateCalculatorTool, loadLocomoSamples, LocomoJudge }
export type { LocomoParsedSample, LocomoParsedSession, LocomoQA, LocomoTurn }

export function getLocomoDataPath(): string {
  return path.resolve(__dirname, '../locomo/data/locomo10.json')
}
