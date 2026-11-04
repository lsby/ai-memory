export function buildAnalysisPrompt(question: string): string {
  return [
    `Question to Solve: ${question}`,
    'Instructions for Question Analysis & Theory Activation:',
    '- Identify the question type (e.g. relative date calculation, speaker attribution, career/qualification details, relationship inference, event timing).',
    '- Call `search_memories` with natural-language contents to search Level 2 long-term memory for applicable heuristics, lessons, or guidelines.',
    '- Summarize the recalled heuristics and formulate your strategic action plan for solving this question.',
  ].join('\n')
}

export function buildQueryPrompt(question: string, recalledRule: string, actionPlan: string): string {
  let activeRuleSection =
    recalledRule !== 'None' && recalledRule.trim() !== ''
      ? recalledRule
      : '- No specific prior rule matched. Follow standard verification procedures.'
  let planSection =
    actionPlan !== '' && actionPlan.trim() !== ''
      ? actionPlan
      : '- Search conversation messages for evidence and verify facts directly.'

  return [
    `Question: ${question}`,
    '',
    '--- Active Guidelines Recalled from Long-Term Memory ---',
    activeRuleSection,
    '',
    '--- Planned Search & Reasoning Strategy ---',
    planSection,
    '',
    'Instructions for Investigation & Answering:',
    '- Execute your strategy using `search_conversation_messages` to locate the exact conversation text.',
    '- If resolving relative dates, calculate exact dates with `date_calculator` anchored to the session timestamp.',
    '- State the direct, concise factual answer strictly based on the verifiable dialogue evidence.',
  ].join('\n')
}

export function buildFeedbackPrompt(params: {
  question: string
  studentAnswer: string
  isCorrect: boolean
  teacherReasoning: string
  goldAnswer: string
  evidenceText: string
}): string {
  let referenceAnswer =
    params.goldAnswer.trim() === ''
      ? '(This event/fact was never mentioned or occurred; no record exists in conversation)'
      : params.goldAnswer

  return [
    '## Teacher Feedback and Scientific Reflection (Hypothesis - Experiment - Reflection - Adjustment)',
    `Question: ${params.question}`,
    `Your Answer: ${params.studentAnswer}`,
    `Grading Result: ${params.isCorrect ? '✅ CORRECT' : '❌ INCORRECT'}`,
    '',
    'Teacher Analysis & Explanation:',
    params.teacherReasoning,
    '',
    'Reference Gold Answer:',
    referenceAnswer,
    '',
    'Source Dialogue Clue / Evidence Location:',
    params.evidenceText,
    '',
    '--- Scientific Methodology & Experience Distillation Guidelines ---',
    '1. Anti-Pattern Warning: STRICTLY FORBIDDEN to memorize or record the specific question or answer (e.g., "Caroline is single") into memory. Isolated facts cannot generalize to new questions and pollute memory.',
    '2. Scientific Investigation:',
    '   - Trace & Experiment: If not already certain, use `search_conversation_messages` to examine the cited dialogue evidence and understand why it was missed or how it was framed.',
    '   - Reflection & Diagnosis: Analyze why you missed it initially:',
    '     * Vocabulary / Semantic Gap: Did the question use formal terms while conversations used informal expressions?',
    '     * Speaker Attribution: Did you confuse who spoke vs who was spoken to? How to verify the subject of the action?',
    '     * Temporal Reference: Did you take a session header timestamp literally instead of calculating relative dates using date_calculator?',
    '     * Premature Surrender: Did you give up after one failed keyword search instead of expanding synonyms?',
    '3. Theory Construction & Memory Persistence:',
    '   - Synthesize a general, reusable reasoning rule, search tactic, or verification heuristic.',
    '   - Call `add_level_2_memory` to commit this general heuristic to Level 2 memory with an importance score (e.g. 90-99) and natural associative clues, so you can retrieve it later via `search_memories`.',
    '   - If this exact heuristic is already present in your memory and verified, you do not need to add duplicate entries.',
    '',
    'Return your root cause diagnosis and generalized heuristic.',
  ].join('\n')
}
