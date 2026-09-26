import type { Database } from 'sqlite3'
import type { Prompt } from '../../src/types'
import { getPrompt } from './queries'

// Counts a copy or paste of the prompt. updated_at is not touched: using a prompt is not editing it.
export const recordPromptUsage = async (db: Database, id: number): Promise<Prompt> => {
  await new Promise<void>((resolve, reject) => {
    db.run(
      'UPDATE prompts SET usage_count = usage_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = ?',
      [id],
      function (err) {
        if (err) return reject(err)
        if (this.changes === 0) return reject(new Error('Prompt não encontrado'))
        resolve()
      }
    )
  })
  const prompt = await getPrompt(db, id)
  if (!prompt) throw new Error('Prompt não encontrado')
  return prompt
}
