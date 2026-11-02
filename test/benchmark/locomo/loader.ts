import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LocomoParsedSample, LocomoParsedSession, LocomoTurn } from './types'

let __dirname = path.dirname(fileURLToPath(import.meta.url))
let defaultDataPath = path.resolve(__dirname, 'data/locomo10.json')

export function loadLocomoSamples(dataPath: string = defaultDataPath): LocomoParsedSample[] {
  if (fs.existsSync(dataPath) === false) {
    throw new Error(`Locomo dataset file not found at: ${dataPath}`)
  }

  let raw = fs.readFileSync(dataPath, 'utf-8')
  let rawList = JSON.parse(raw) as Array<Record<string, unknown>>

  return rawList.map((item, index) => {
    let conversation = (item['conversation'] ?? {}) as Record<string, unknown>
    let speakerA = String(conversation['speaker_a'] ?? 'User A')
    let speakerB = String(conversation['speaker_b'] ?? 'User B')

    let sessions: LocomoParsedSession[] = []
    let sessionIdx = 1

    while (`session_${String(sessionIdx)}` in conversation) {
      let turnsRaw = conversation[`session_${String(sessionIdx)}`]
      let dateTime = String(conversation[`session_${String(sessionIdx)}_date_time`] ?? '')

      let turns: LocomoTurn[] = Array.isArray(turnsRaw)
        ? (turnsRaw as Array<Record<string, unknown>>).map((t) => ({
            speaker: String(t['speaker'] ?? ''),
            dia_id: String(t['dia_id'] ?? ''),
            text: String(t['text'] ?? ''),
            img_url: typeof t['img_url'] === 'string' ? t['img_url'] : undefined,
            blip_caption: typeof t['blip_caption'] === 'string' ? t['blip_caption'] : undefined,
          }))
        : []

      sessions.push({
        sessionId: sessionIdx,
        dateTime,
        turns,
      })

      sessionIdx++
    }

    let qaRaw = item['qa']

    return {
      sampleId: String(item['sample_id'] ?? `sample_${String(index)}`),
      speakerA,
      speakerB,
      sessions,
      qa: Array.isArray(qaRaw)
        ? (qaRaw as Array<Record<string, unknown>>).map((q) => ({
            question: String(q['question'] ?? ''),
            answer:
              typeof q['answer'] === 'string' || typeof q['answer'] === 'number'
                ? q['answer']
                : String(q['answer'] ?? ''),
            evidence: Array.isArray(q['evidence']) ? (q['evidence'] as unknown[]).map(String) : [],
            category: Number(q['category'] ?? 0),
          }))
        : [],
    }
  })
}
